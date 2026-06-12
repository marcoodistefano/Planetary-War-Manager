const fs = require('fs');
const path = require('path');
const topojson = require('topojson-client');
const redis = require('../../shared/redisClient.js');

let archsFeatures = null;
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
const calculatePath = async (startLng, startLat, targetName, targetLng, targetLat) => {
    loadGeometries();

    let destNode = targetName;
    if (!nodesMap.has(destNode)) {
        destNode = getClosestNode(targetLng, targetLat);
    }

    let startNode = getClosestNode(startLng, startLat);

    // If start and dest are same node, path is just the node
    if (startNode === destNode) {
        return {
            isValid: true,
            distance: 0,
            etaMs: 0,
            path: [nodesMap.get(startNode)]
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
    const etaHours = routeInfo.cost / baseSpeed;
    const etaMs = Math.floor(etaHours * 60 * 60 * 1000);

    return {
        isValid: true,
        distance: routeInfo.cost,
        etaMs: etaMs,
        path: fullPath
    };
};

module.exports = {
  calculatePath
};
