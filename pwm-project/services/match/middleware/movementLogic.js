const fs = require('fs');
const path = require('path');
const topojson = require('topojson-client');
const redis = require('../../shared/redisClient.js');
const turf = require('@turf/turf');

let archsFeatures = null;
let regionsFeatures = null;
let nodesMap = new Map(); // city_name -> { point: [lng, lat] }

// Load map topologies
function loadGeometries() {
    if (archsFeatures) return;
    const archsFile = path.join(__dirname, '../../../shared/assets/map/archs.json');
    if (fs.existsSync(archsFile)) {
        const topo = JSON.parse(fs.readFileSync(archsFile, 'utf-8'));
        const geojson = topojson.feature(topo, topo.objects.archs);
        archsFeatures = geojson.features;

        // Build nodesMap from the arcs to know coordinates of cities
        for (const feature of archsFeatures) {
            const props = feature.properties;
            if (!feature.geometry) continue;
            const coords = feature.geometry.coordinates;
            if (props.city1 && coords.length > 0) {
                nodesMap.set(props.city1, coords[0]);
            }
            if (props.city2 && coords.length > 0) {
                nodesMap.set(props.city2, coords[coords.length - 1]);
            }
        }
    }
    
    if (!regionsFeatures) {
        const regionsFile = path.join(__dirname, '../../../shared/assets/map/regions.json');
        if (fs.existsSync(regionsFile)) {
            const topo = JSON.parse(fs.readFileSync(regionsFile, 'utf-8'));
            const objectKey = Object.keys(topo.objects)[0];
            const geojson = topojson.feature(topo, topo.objects[objectKey]);
            regionsFeatures = geojson.features;
        }
    }
}

// Distance in km using Haversine
function haversineDist(lon1, lat1, lon2, lat2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Find closest node to a given point
function getClosestNode(lon, lat) {
    let minD = Infinity;
    let closest = null;
    for (const [name, coords] of nodesMap.entries()) {
        const d = haversineDist(lon, lat, coords[0], coords[1]);
        if (d < minD) {
            minD = d;
            closest = name;
        }
    }
    return closest;
}

// Extract path geometry from cityA to cityB
function getEdgeGeometry(cityA, cityB) {
    for (const f of archsFeatures) {
        if (!f.geometry) continue;
        if ((f.properties.city1 === cityA && f.properties.city2 === cityB) ||
            (f.properties.city1 === cityB && f.properties.city2 === cityA)) {
            // Need to ensure the direction is from cityA to cityB
            const coords = f.geometry.coordinates;
            const distA = haversineDist(nodesMap.get(cityA)[0], nodesMap.get(cityA)[1], coords[0][0], coords[0][1]);
            if (distA > 1) { // cityA is not at index 0, so we reverse
                return [...coords].reverse();
            }
            return coords;
        }
    }
    return [nodesMap.get(cityA), nodesMap.get(cityB)]; // Fallback
}

// Main calculate function
const calculatePath = async (startLng, startLat, targetName, targetLng, targetLat, multiplier = 1) => {
    loadGeometries();

    let destNode = targetName;
    if (!nodesMap.has(destNode)) {
        destNode = getClosestNode(targetLng, targetLat);
    }

    let startNode = getClosestNode(startLng, startLat);

    // If start and dest are same node, path is just the node
    if (startNode === destNode) {
        let path = [nodesMap.get(startNode)];
        let distance = 0;

        const distFromStart = haversineDist(startLng, startLat, path[0][0], path[0][1]);
        if (distFromStart > 0.001) {
            path.unshift([startLng, startLat]);
            distance += distFromStart;
        }

        if (targetName === 'OBIETTIVO') {
            const distToEnd = haversineDist(path[path.length - 1][0], path[path.length - 1][1], targetLng, targetLat);
            if (distToEnd > 0.001) {
                path.push([targetLng, targetLat]);
                distance += distToEnd;
            }
        }

        const baseSpeed = 50;
        const etaHours = distance / (baseSpeed * multiplier);
        return {
            isValid: true,
            distance: distance,
            etaMs: Math.floor(etaHours * 60 * 60 * 1000),
            path: path
        };
    }

    // Load routing table for startNode
    const routingRaw = await redis.get(`map_data:routing:${startNode}`);
    if (!routingRaw) {
        console.warn(`Routing table per ${startNode} non trovata in Redis`);
        return { isValid: false, distance: 0, etaMs: 0, path: [] };
    }

    const routingObj = JSON.parse(routingRaw);
    const routeInfo = routingObj[destNode];

    if (!routeInfo) {
        console.warn(`Nessun percorso da ${startNode} a ${destNode}`);
        return { isValid: false, distance: 0, etaMs: 0, path: [] };
    }

    let currentNode = startNode;
    let fullPath = [];
    let totalDist = 0;

    // Traverse the path to build exact geometry
    while (currentNode !== destNode) {
        const raw = await redis.get(`map_data:routing:${currentNode}`);
        if (!raw) break;
        const currentRouting = JSON.parse(raw);
        const nextHop = currentRouting[destNode]?.next_hop;
        
        if (!nextHop) break; // Reached end or no path
        
        const edgeCoords = getEdgeGeometry(currentNode, nextHop);
        if (fullPath.length > 0) {
            fullPath = fullPath.concat(edgeCoords.slice(1));
        } else {
            fullPath = fullPath.concat(edgeCoords);
        }
        
        currentNode = nextHop;
    }

    // Add final coordinate if the destination wasn't exactly a node
    if (targetName === 'OBIETTIVO') {
        fullPath.push([targetLng, targetLat]);
    }

    const baseSpeed = 50; // km/h
    // La distanza di routeInfo.cost è in METRI. Convertiamo in KM:
    let costInKm = routeInfo.cost / 1000;

    // Add initial coordinate if the start wasn't exactly a node
    if (fullPath.length > 0) {
        const distFromStart = haversineDist(startLng, startLat, fullPath[0][0], fullPath[0][1]);
        if (distFromStart > 0.001) {
            fullPath.unshift([startLng, startLat]);
            costInKm += distFromStart;
        }
    }
    
    // Il tempo di percorrenza scala diviso per il moltiplicatore
    const etaHours = costInKm / (baseSpeed * multiplier);
    const etaMs = Math.floor(etaHours * 60 * 60 * 1000);

    return {
        isValid: true,
        distance: costInKm, // Restituiamo i km effettivi invece dei metri

        etaMs: etaMs,
        path: fullPath
    };
};

// Funzione per calcolare il punto di intersezione con il confine del target
const getBorderIntersection = (pathCoords, targetName) => {
    loadGeometries();
    if (!regionsFeatures || pathCoords.length < 2) return null;

    const targetRegion = regionsFeatures.find(f => 
        (f.properties && (f.properties.name === targetName || f.properties.ADMIN === targetName || f.properties.adm1_code === targetName)) ||
        f.id === targetName
    );

    if (!targetRegion) return null;

    try {
        const pathLine = turf.lineString(pathCoords);
        let intersection = null;
        
        // Se il territorio è un Polygon/MultiPolygon, ne prendiamo i bordi
        if (targetRegion.geometry.type === 'Polygon' || targetRegion.geometry.type === 'MultiPolygon') {
            const lines = turf.polygonToLine(targetRegion);
            const intersections = turf.lineIntersect(pathLine, lines);
            if (intersections.features.length > 0) {
                intersection = intersections.features[0].geometry.coordinates;
            }
        }
        
        // Calcola il tempo necessario per raggiungere l'intersezione
        if (intersection) {
            // Tronca il path all'intersezione per calcolare l'ETA parziale
            const sliced = turf.lineSlice(turf.point(pathCoords[0]), turf.point(intersection), pathLine);
            const distToBorder = turf.length(sliced, {units: 'kilometers'});
            return {
                point: intersection,
                distanceToBorder: distToBorder
            };
        }
    } catch (e) {
        console.error("Errore nel calcolo del confine:", e);
    }
    
    return null;
};

// Helper for server to get node coords
function getNodeCoords(name) {
    loadGeometries();
    return nodesMap.get(name) || null;
}

// Aggiunto per mappare una città alla sua regione
const getRegionForNode = (nodeName) => {
    loadGeometries();
    if (!regionsFeatures) return null;
    const coords = nodesMap.get(nodeName);
    if (!coords) return null;

    try {
        const pt = turf.point(coords);
        for (const f of regionsFeatures) {
            if (f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) {
                if (turf.booleanPointInPolygon(pt, f)) {
                    return f.properties.adm1_code || f.id;
                }
            }
        }
    } catch (e) {
        console.error("Errore getRegionForNode:", e);
    }
    return null;
};

module.exports = { calculatePath, getBorderIntersection, getNodeCoords, getRegionForNode };
