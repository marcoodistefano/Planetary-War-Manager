const fs = require('fs');
const path = require('path');
const topojson = require('topojson-client');
const turf = require('@turf/turf');
const dynamicPathfinder = require('./dynamicPathfinder');

let regionsFeatures = null;

// Load map topologies (only regions are needed now)
function loadGeometries() {
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

// Main calculate function using A*
const calculatePath = async (startLng, startLat, targetName, targetLng, targetLat, multiplier = 1, currentPathInfo = null, matchMultiplier = 1) => {
    // Ottieni il percorso base tramite A* dinamico
    let pathRes = await dynamicPathfinder.findPath(startLng, startLat, targetLng, targetLat, multiplier);
    let pathCoords = pathRes.path || pathRes;
    let pathCost = pathRes.cost || 0;

    // Calcola la distanza effettiva per stimare l'ETA
    let distanceKm = 0;
    if (pathCoords && pathCoords.length > 1) {
        for (let i = 0; i < pathCoords.length - 1; i++) {
            distanceKm += haversineDist(pathCoords[i][0], pathCoords[i][1], pathCoords[i+1][0], pathCoords[i+1][1]);
        }
    }

    const baseSpeed = 50; // km/h
    let etaHours = distanceKm / (baseSpeed * multiplier);

    if (pathCost > 0) {
        // Usa il costo per calcolare il vero tempo (1 cella ~ 11.1km)
        let effectiveDistanceKm = pathCost * 11.1;
        etaHours = effectiveDistanceKm / (baseSpeed * multiplier);
    }

    let etaMs = Math.floor(etaHours * 60 * 60 * 1000);
    
    // Applica il moltiplicatore della partita (es: 60x real time)
    if (matchMultiplier > 0) {
        etaMs = Math.floor(etaMs / matchMultiplier);
    }

    return {
        isValid: true,
        distance: distanceKm,
        etaMs: etaMs > 0 ? etaMs : 1000,
        path: pathCoords
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
        
        if (targetRegion.geometry.type === 'Polygon' || targetRegion.geometry.type === 'MultiPolygon') {
            const lines = turf.polygonToLine(targetRegion);
            const intersections = turf.lineIntersect(pathLine, lines);
            if (intersections.features.length > 0) {
                intersection = intersections.features[0].geometry.coordinates;
            }
        }
        
        if (intersection) {
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

const normalizeName = (name) => {
    return String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
};

// Modificato: non ci basiamo più sui nodi, restituisce le coordinate dal target (se possibile)
function getNodeCoords(name) {
    loadGeometries();
    // Non esiste più un array di nodi fisso. Come fallback cerchiamo il centro della regione
    if (!regionsFeatures) return null;
    const lowerName = normalizeName(name);
    const targetRegion = regionsFeatures.find(f => 
        (f.properties && (normalizeName(f.properties.name) === lowerName || normalizeName(f.properties.ADMIN) === lowerName || normalizeName(f.properties.adm1_code) === lowerName)) ||
        normalizeName(f.id) === lowerName
    );
    if (targetRegion && targetRegion.geometry) {
        try {
            const center = turf.center(targetRegion);
            return center.geometry.coordinates;
        } catch(e) {}
    }
    return null;
}

const getRegionForNode = (nodeName) => {
    loadGeometries();
    if (!regionsFeatures) return null;
    const lowerName = normalizeName(nodeName);
    const targetRegion = regionsFeatures.find(f => 
        (f.properties && (normalizeName(f.properties.name) === lowerName || normalizeName(f.properties.ADMIN) === lowerName || normalizeName(f.properties.adm1_code) === lowerName)) ||
        normalizeName(f.id) === lowerName
    );
    if (targetRegion) {
        return targetRegion.properties?.adm1_code || targetRegion.id;
    }
    return null;
};

const getRegionIdByName = (name) => {
    loadGeometries();
    if (!regionsFeatures) return name;
    const lowerName = normalizeName(name);
    const targetRegion = regionsFeatures.find(f => 
        (f.properties && (normalizeName(f.properties.name) === lowerName || normalizeName(f.properties.ADMIN) === lowerName || normalizeName(f.properties.adm1_code) === lowerName)) ||
        normalizeName(f.id) === lowerName
    );
    if (targetRegion) {
        return targetRegion.properties?.adm1_code || targetRegion.id;
    }
    return name;
};

const calculateCurrentPosition = (path, startTime, etaMs) => {
    if (!path || path.length < 2 || !startTime || !etaMs) return null;
    const now = Date.now();
    const elapsed = now - startTime;
    const progress = Math.max(0, Math.min(1, elapsed / etaMs));
    if (progress >= 1) {
        return { lng: path[path.length - 1][0], lat: path[path.length - 1][1], currentIndex: path.length - 1, elapsed };
    }
    let totalDistance = 0;
    const segmentDistances = [];
    for (let i = 0; i < path.length - 1; i++) {
        const dist = haversineDist(path[i][0], path[i][1], path[i+1][0], path[i+1][1]);
        segmentDistances.push(dist);
        totalDistance += dist;
    }
    const targetDistance = progress * totalDistance;
    let currentDist = 0;
    let currentIndex = 0;
    let segmentProgress = 0;
    for (let i = 0; i < segmentDistances.length; i++) {
        if (currentDist + segmentDistances[i] >= targetDistance || i === segmentDistances.length - 1) {
            currentIndex = i;
            segmentProgress = segmentDistances[i] > 0 ? (targetDistance - currentDist) / segmentDistances[i] : 0;
            break;
        }
        currentDist += segmentDistances[i];
    }
    const p1 = path[currentIndex];
    const p2 = path[currentIndex + 1] || p1;
    const lng = p1[0] + (p2[0] - p1[0]) * segmentProgress;
    const lat = p1[1] + (p2[1] - p1[1]) * segmentProgress;
    return { lng, lat, currentIndex, elapsed };
};

const getArmyLocation = (army) => {
    let coords = null;
    let loc = army.currentLocation;
    if (typeof loc === 'string') {
        const pts = loc.split(',').map(s => parseFloat(s.trim()));
        if (pts.length === 2 && !isNaN(pts[0])) {
            coords = [pts[0], pts[1]];
        } else {
            const coordsFound = getNodeCoords(loc.trim());
            if (coordsFound) coords = coordsFound;
        }
    } else if (loc && loc.x !== undefined) {
        coords = [loc.x, loc.y];
    } else if (Array.isArray(loc) && loc.length >= 2) {
        coords = [loc[0], loc[1]];
    }

    if ((army.status === 'moving' || army.status === 'moving_to_border' || army.status === "Pronto all'attacco" || army.status === "Pronto alla conquista") && army.path && army.path.length > 0 && army.startTime && army.etaMs) {
        const pos = calculateCurrentPosition(army.path, army.startTime, army.etaMs);
        if (pos) {
            coords = [pos.lng, pos.lat];
        }
    }
    return coords;
};

module.exports = { calculatePath, getBorderIntersection, getNodeCoords, getRegionForNode, getRegionIdByName, calculateCurrentPosition, getArmyLocation, haversineDist };
