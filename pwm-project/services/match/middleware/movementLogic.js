const fs = require('fs');
const path = require('path');
const topojson = require('topojson-client');
const turf = require('@turf/turf');
const dynamicPathfinder = require('./dynamicPathfinder');
const redis = require('../../shared/redisClient.js');

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

const getAdjacentRegionIds = async (regionId) => {
    try {
        const adjData = await redis.get('map_data:regions_adjacency');
        if (!adjData) return [regionId];
        const adjacency = JSON.parse(adjData);
        const startEntry = Object.values(adjacency).find(entry => entry.provCode === regionId || entry.id === regionId);
        if (!startEntry) return [regionId];
        const neighborCodes = startEntry.neighbors.map(neighborIndex => adjacency[neighborIndex].provCode || adjacency[neighborIndex].id);
        return [regionId, ...neighborCodes];
    } catch (e) {
        return [regionId];
    }
};

const checkPlayerTransportCapacity = async (player, regionId, domain, rulesObj) => {
    if (!player) return 0;
    const truppeSheet = rulesObj.sheets.find(s => s.name === "Truppe" || s.name === "truppe");
    const truppeLines = truppeSheet ? truppeSheet.lines : [];
    
    const adjacentRegionIds = await getAdjacentRegionIds(regionId);
    let totalCapacity = 0;
    
    for (const army of Object.values(player.armate || {})) {
        let armyRegionId = null;
        let armyLoc = army.currentLocation;
        if (armyLoc && typeof armyLoc === 'string') {
            if (armyLoc.includes(',')) {
                const pts = armyLoc.split(',').map(s => parseFloat(s.trim()));
                if (pts.length === 2 && !isNaN(pts[0])) {
                    armyRegionId = getRegionAtCoords(pts[0], pts[1]);
                }
            } else {
                armyRegionId = getRegionForNode(armyLoc);
            }
        } else if (armyLoc && armyLoc.x !== undefined) {
            armyRegionId = getRegionAtCoords(armyLoc.x, armyLoc.y);
        } else if (Array.isArray(armyLoc) && armyLoc.length >= 2) {
            armyRegionId = getRegionAtCoords(armyLoc[0], armyLoc[1]);
        }
        
        if (armyRegionId && adjacentRegionIds.includes(armyRegionId)) {
            for (const [unitId, qty] of Object.entries(army.composition || {})) {
                const uRule = truppeLines.find(line => line.id_truppa === unitId);
                if (uRule && uRule.dominio === domain && uRule.peso_trasportabile > 0) {
                    totalCapacity += qty * uRule.peso_trasportabile;
                }
            }
        }
    }
    return totalCapacity;
};

// Main calculate function using A*
const calculatePath = async (startLng, startLat, targetName, targetLng, targetLat, multiplier = 1, currentPathInfo = null, matchMultiplier = 1, player = null, waypoints = []) => {
    const rulesRawBase64 = await redis.get("assets:game_rules.json");
    let rulesObj = null;
    if (rulesRawBase64) {
        rulesObj = JSON.parse(Buffer.from(rulesRawBase64, 'base64').toString('utf8'));
    }

    const baseSpeed = 50; // km/h

    console.log(`[PATH_DEBUG] calculatePath startLng: ${startLng}, startLat: ${startLat}, targetLng: ${targetLng}, targetLat: ${targetLat}, waypoints:`, waypoints);
    if (waypoints && waypoints.length > 0) {
        let combinedCoords = [];
        let combinedCost = 0;
        let combinedDistance = 0;
        let combinedEtaMs = 0;
        let isValid = true;

        const points = [[startLng, startLat], ...waypoints, [targetLng, targetLat]];
        for (let i = 0; i < points.length - 1; i++) {
            const segStart = points[i];
            const segEnd = points[i+1];
            
            let segPathRes = await dynamicPathfinder.findPath(segStart[0], segStart[1], segEnd[0], segEnd[1], multiplier);
            if (segPathRes.isValid) {
                if (combinedCoords.length > 0) {
                    combinedCoords = combinedCoords.concat(segPathRes.path.slice(1));
                } else {
                    combinedCoords = combinedCoords.concat(segPathRes.path);
                }
                combinedCost += segPathRes.cost;
                
                let segmentDistance = 0;
                for (let j = 0; j < segPathRes.path.length - 1; j++) {
                    segmentDistance += haversineDist(segPathRes.path[j][0], segPathRes.path[j][1], segPathRes.path[j+1][0], segPathRes.path[j+1][1]);
                }
                combinedDistance += segmentDistance;
                
                let segEtaMs = segmentDistance / (baseSpeed * multiplier) * 60 * 60 * 1000;
                if (segPathRes.cost > 0) {
                    segEtaMs = (segPathRes.cost * 11.1) / (baseSpeed * multiplier) * 60 * 60 * 1000;
                }
                combinedEtaMs += segEtaMs;
            } else {
                const startRegionId = getRegionAtCoords(segStart[0], segStart[1]);
                const endRegionId = getRegionAtCoords(segEnd[0], segEnd[1]);
                
                const hasStartPort = player && player.strutture && player.strutture.some(s => s.status === 'built' && s.structureId.startsWith('porto_t') && s.regionId === startRegionId);
                const hasEndPort = player && player.strutture && player.strutture.some(s => s.status === 'built' && s.structureId.startsWith('porto_t') && s.regionId === endRegionId);
                
                const hasStartAirport = player && player.strutture && player.strutture.some(s => s.status === 'built' && s.structureId.startsWith('aeroporto_t') && s.regionId === startRegionId);
                const hasEndAirport = player && player.strutture && player.strutture.some(s => s.status === 'built' && s.structureId.startsWith('aeroporto_t') && s.regionId === endRegionId);
                
                let isTransitValid = false;
                let transitSpeed = baseSpeed;
                
                if (hasStartPort && hasEndPort) {
                    const capacity = await checkPlayerTransportCapacity(player, startRegionId, 2, rulesObj);
                    if (capacity > 0) {
                        isTransitValid = true;
                        transitSpeed = 25;
                    }
                } else if (hasStartAirport && hasEndAirport) {
                    const capacity = await checkPlayerTransportCapacity(player, startRegionId, 0, rulesObj);
                    if (capacity > 0) {
                        isTransitValid = true;
                        transitSpeed = 150;
                    }
                }
                
                if (isTransitValid) {
                    if (combinedCoords.length > 0) {
                        combinedCoords.push(segEnd);
                    } else {
                        combinedCoords.push(segStart, segEnd);
                    }
                    const segDist = haversineDist(segStart[0], segStart[1], segEnd[0], segEnd[1]);
                    combinedDistance += segDist;
                    const segEtaMs = segDist / transitSpeed * 60 * 60 * 1000;
                    combinedEtaMs += segEtaMs;
                } else {
                    isValid = false;
                    if (combinedCoords.length > 0) {
                        combinedCoords.push(segEnd);
                    } else {
                        combinedCoords.push(segStart, segEnd);
                    }
                    const segDist = haversineDist(segStart[0], segStart[1], segEnd[0], segEnd[1]);
                    combinedDistance += segDist;
                    combinedEtaMs += segDist / baseSpeed * 60 * 60 * 1000;
                }
            }
        }

        if (matchMultiplier > 0) {
            combinedEtaMs = Math.floor(combinedEtaMs / matchMultiplier);
        }

        return {
            isValid,
            distance: combinedDistance,
            etaMs: combinedEtaMs > 0 ? combinedEtaMs : 1000,
            path: combinedCoords,
            cost: combinedCost
        };
    }

    // Ottieni il percorso base tramite A* dinamico
    let pathRes = await dynamicPathfinder.findPath(startLng, startLat, targetLng, targetLat, multiplier);
    let pathCoords = pathRes.path || pathRes;
    let pathCost = pathRes.cost || 0;

    // Se A* fallisce e c'è il player, tenta l'instradamento automatico hub-to-hub
    if (!pathRes.isValid && player && rulesObj) {
        const ports = [];
        const airports = [];
        if (player.strutture) {
            for (const s of player.strutture) {
                if (s.status === 'built') {
                    const coords = getNodeCoords(s.regionId);
                    if (coords) {
                        if (s.structureId.startsWith('porto_t')) {
                            ports.push({ id: s.id, regionId: s.regionId, coords, type: 'port' });
                        } else if (s.structureId.startsWith('aeroporto_t')) {
                            airports.push({ id: s.id, regionId: s.regionId, coords, type: 'airport' });
                        }
                    }
                }
            }
        }

        const originPorts = [];
        const originAirports = [];
        const destPorts = [];
        const destAirports = [];

        for (const p of ports) {
            const pRes = await dynamicPathfinder.findPath(startLng, startLat, p.coords[0], p.coords[1], multiplier);
            if (pRes.isValid) originPorts.push({ hub: p, path: pRes.path, cost: pRes.cost });
        }
        for (const a of airports) {
            const pRes = await dynamicPathfinder.findPath(startLng, startLat, a.coords[0], a.coords[1], multiplier);
            if (pRes.isValid) originAirports.push({ hub: a, path: pRes.path, cost: pRes.cost });
        }

        for (const p of ports) {
            const pRes = await dynamicPathfinder.findPath(p.coords[0], p.coords[1], targetLng, targetLat, multiplier);
            if (pRes.isValid) destPorts.push({ hub: p, path: pRes.path, cost: pRes.cost });
        }
        for (const a of airports) {
            const pRes = await dynamicPathfinder.findPath(a.coords[0], a.coords[1], targetLng, targetLat, multiplier);
            if (pRes.isValid) destAirports.push({ hub: a, path: pRes.path, cost: pRes.cost });
        }

        let bestRoute = null;
        let bestDistance = Infinity;

        // Port-to-Port
        for (const OP of originPorts) {
            for (const DP of destPorts) {
                const capacity = await checkPlayerTransportCapacity(player, OP.hub.regionId, 2, rulesObj);
                if (capacity > 0) {
                    const walk1Dist = OP.cost * 11.1;
                    const transitDist = haversineDist(OP.hub.coords[0], OP.hub.coords[1], DP.hub.coords[0], DP.hub.coords[1]);
                    const walk2Dist = DP.cost * 11.1;
                    const totalDist = walk1Dist + transitDist + walk2Dist;
                    if (totalDist < bestDistance) {
                        bestDistance = totalDist;
                        bestRoute = {
                            type: 'sea',
                            origin: OP,
                            dest: DP,
                            transitDist,
                            walk1Dist,
                            walk2Dist
                        };
                    }
                }
            }
        }

        // Airport-to-Airport
        for (const OA of originAirports) {
            for (const DA of destAirports) {
                const capacity = await checkPlayerTransportCapacity(player, OA.hub.regionId, 0, rulesObj);
                if (capacity > 0) {
                    const walk1Dist = OA.cost * 11.1;
                    const transitDist = haversineDist(OA.hub.coords[0], OA.hub.coords[1], DA.hub.coords[0], DA.hub.coords[1]);
                    const walk2Dist = DA.cost * 11.1;
                    const totalDist = walk1Dist + transitDist + walk2Dist;
                    if (totalDist < bestDistance) {
                        bestDistance = totalDist;
                        bestRoute = {
                            type: 'air',
                            origin: OA,
                            dest: DA,
                            transitDist,
                            walk1Dist,
                            walk2Dist
                        };
                    }
                }
            }
        }

        if (bestRoute) {
            const combinedCoords = [...bestRoute.origin.path, ...bestRoute.dest.path];
            const walkSpeed = baseSpeed;
            const transitSpeed = bestRoute.type === 'sea' ? 25 : 150;
            
            const walk1Eta = bestRoute.walk1Dist / (walkSpeed * multiplier);
            const transitEta = bestRoute.transitDist / transitSpeed;
            const walk2Eta = bestRoute.walk2Dist / (walkSpeed * multiplier);
            
            let totalEtaHours = walk1Eta + transitEta + walk2Eta;
            let etaMs = Math.floor(totalEtaHours * 60 * 60 * 1000);
            
            if (matchMultiplier > 0) {
                etaMs = Math.floor(etaMs / matchMultiplier);
            }

            return {
                isValid: true,
                distance: bestDistance,
                etaMs: etaMs > 0 ? etaMs : 1000,
                path: combinedCoords,
                cost: bestRoute.origin.cost + bestRoute.dest.cost
            };
        }
    }

    // Calcola la distanza effettiva per stimare l'ETA
    let distanceKm = 0;
    if (pathCoords && pathCoords.length > 1) {
        for (let i = 0; i < pathCoords.length - 1; i++) {
            distanceKm += haversineDist(pathCoords[i][0], pathCoords[i][1], pathCoords[i+1][0], pathCoords[i+1][1]);
        }
    }

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
        isValid: pathRes.isValid !== undefined ? pathRes.isValid : true,
        distance: distanceKm,
        etaMs: etaMs > 0 ? etaMs : 1000,
        path: pathCoords,
        cost: pathCost
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
    const startTs = (typeof startTime === 'string' || startTime instanceof Date) ? new Date(startTime).getTime() : Number(startTime);
    if (isNaN(startTs)) return null;
    const elapsed = now - startTs;
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

const getRegionAtCoords = (lng, lat) => {
    loadGeometries();
    if (!regionsFeatures) return null;
    const pt = turf.point([lng, lat]);
    for (const f of regionsFeatures) {
        try {
            if (turf.booleanPointInPolygon(pt, f)) {
                return f.properties?.adm1_code || f.id;
            }
        } catch (e) {}
    }
    return null;
};

module.exports = { calculatePath, getBorderIntersection, getNodeCoords, getRegionForNode, getRegionIdByName, calculateCurrentPosition, getArmyLocation, haversineDist, getRegionAtCoords };
