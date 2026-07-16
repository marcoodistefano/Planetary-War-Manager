const fs = require('fs');
const path = require('path');
const topojson = require('topojson-client');
const turf = require('@turf/turf');
const dynamicPathfinder = require('./dynamicPathfinder');
const redis = require('../../shared/redisClient.js');

let regionsFeatures = null;

let cachedGameRules = null;
let lastGameRulesFetch = 0;
async function getGameRulesCached(redisClient) {
    if (cachedGameRules && (Date.now() - lastGameRulesFetch < 60000)) {
        return cachedGameRules;
    }
    const rulesRawBase64 = await redisClient.get("assets:game_rules.json");
    if (rulesRawBase64) {
        cachedGameRules = JSON.parse(Buffer.from(rulesRawBase64, 'base64').toString('utf8'));
        lastGameRulesFetch = Date.now();
    }
    return cachedGameRules;
}
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
const calculatePath = async (startLng, startLat, targetName, targetLng, targetLat, multiplier = 1, currentPathInfo = null, matchMultiplier = 1, player = null, waypoints = [], armyComposition = null) => {
    const rulesObj = await getGameRulesCached(redis);

    // --- Calcolo velocità reale dell'armata dalla composizione ---
    // Il convoglio si muove alla velocità dell'unità più lenta (principio tattico realistico)
    // Il campo `velocita` in game_rules è un moltiplicatore relativo: 1.5 = 15 km/h, 10 = 100 km/h
    // Calibrazione: velocita=1 → 10 km/h (passo fante in terreno difficile), velocita=10 → 100 km/h (veicolo su strada)
    const BASE_UNIT_KMH = 10; // km/h per unità con velocita=1
    const NAVAL_KMH = 28;     // ~15 nodi per navi cargo
    const AIR_KMH = 500;      // km/h per aerei da trasporto

    let landSpeedKmh = BASE_UNIT_KMH * 5; // default 50 km/h se non ci sono regole
    let navalSpeedKmh = NAVAL_KMH;
    let airSpeedKmh = AIR_KMH;
    let isNavalOnly = false;

    if (rulesObj && armyComposition) {
        const truppeSheet = rulesObj.sheets.find(s => s.name === "Truppe" || s.name === "truppe");
        const truppeLines = truppeSheet ? truppeSheet.lines : [];
        let minLandSpeed = Infinity;
        let hasNaval = false;
        let hasAir = false;
        let totalUnits = 0;
        let navalUnitsCount = 0;
        for (const [unitId, qty] of Object.entries(armyComposition)) {
            if (!qty || qty <= 0) continue;
            totalUnits += qty;
            const uRule = truppeLines.find(l => l.id_truppa === unitId);
            if (!uRule) continue;
            if (uRule.dominio === 1 && uRule.velocita > 0) {
                const unitKmh = uRule.velocita * BASE_UNIT_KMH;
                if (unitKmh < minLandSpeed) minLandSpeed = unitKmh;
            } else if (uRule.dominio === 2) {
                hasNaval = true;
                navalUnitsCount += qty;
                if (uRule.velocita > 0) navalSpeedKmh = uRule.velocita * BASE_UNIT_KMH;
            } else if (uRule.dominio === 0) {
                hasAir = true;
                if (uRule.velocita > 0) airSpeedKmh = uRule.velocita * BASE_UNIT_KMH;
            }
        }
        if (minLandSpeed !== Infinity) landSpeedKmh = minLandSpeed;
        if (totalUnits > 0 && navalUnitsCount === totalUnits) {
            isNavalOnly = true;
        }
    }

    const pathfindingMode = isNavalOnly ? 'sea' : 'land';
    const currentSpeedKmh = isNavalOnly ? navalSpeedKmh : landSpeedKmh;

    // Helper: calcola ETA in ms da path e costo A*
    const computeEtaMs = (pathCoords, pathCost, speedKmh, matchMult) => {
        let distanceKm = 0;
        if (pathCoords && pathCoords.length > 1) {
            for (let i = 0; i < pathCoords.length - 1; i++) {
                distanceKm += haversineDist(pathCoords[i][0], pathCoords[i][1], pathCoords[i+1][0], pathCoords[i+1][1]);
            }
        }
        // Se abbiamo il costo A* (tiene conto del terreno) usiamo quello per l'ETA
        let effectiveHours;
        if (pathCost > 0) {
            // 1 cella ETOPO a ~1 arcominuto ≈ 1.85 km; il costo è normalizzato per risoluzione
            // Usiamo la distanza reale pesata dal moltiplicatore terreno
            effectiveHours = distanceKm / speedKmh;
            // Il costo A* include già il moltiplicatore di terreno; rapporto costo/distanza > 1 = terreno difficile
            if (distanceKm > 0) {
                const terrainPenalty = Math.max(1, pathCost / (distanceKm / 11.1));
                console.log(`[PATH_DEBUG] Distance: ${distanceKm.toFixed(2)}km, pathCost: ${pathCost.toFixed(2)}, TerrainPenalty: ${terrainPenalty.toFixed(2)}x`);
                effectiveHours = effectiveHours * terrainPenalty;
            }
        } else {
            effectiveHours = distanceKm / speedKmh;
        }
        let etaMs = Math.floor(effectiveHours * 3600 * 1000);
        if (matchMult > 0) etaMs = Math.floor(etaMs / matchMult);
        return { etaMs: etaMs > 0 ? etaMs : 1000, distanceKm };
    };

    console.log(`[PATH_DEBUG] calculatePath startLng: ${startLng}, startLat: ${startLat}, targetLng: ${targetLng}, targetLat: ${targetLat}, mode: ${pathfindingMode}, waypoints:`, waypoints);
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
            
            let segPathRes = await dynamicPathfinder.findPath(segStart[0], segStart[1], segEnd[0], segEnd[1], multiplier, pathfindingMode);
            if (segPathRes.isValid) {
                if (combinedCoords.length > 0) {
                    combinedCoords = combinedCoords.concat(segPathRes.path.slice(1));
                } else {
                    combinedCoords = combinedCoords.concat(segPathRes.path);
                }
                combinedCost += segPathRes.cost;
                const { etaMs: segEta, distanceKm: segDist } = computeEtaMs(segPathRes.path, segPathRes.cost, currentSpeedKmh, 0);
                combinedDistance += segDist;
                combinedEtaMs += segEta;
            } else {
                const startRegionId = getRegionAtCoords(segStart[0], segStart[1]);
                const endRegionId = getRegionAtCoords(segEnd[0], segEnd[1]);
                
                const hasStartPort = player && player.strutture && player.strutture.some(s => s.status === 'built' && s.structureId.startsWith('porto_t') && s.regionId === startRegionId);
                const hasEndPort = player && player.strutture && player.strutture.some(s => s.status === 'built' && s.structureId.startsWith('porto_t') && s.regionId === endRegionId);
                
                const hasStartAirport = player && player.strutture && player.strutture.some(s => s.status === 'built' && s.structureId.startsWith('aeroporto_t') && s.regionId === startRegionId);
                const hasEndAirport = player && player.strutture && player.strutture.some(s => s.status === 'built' && s.structureId.startsWith('aeroporto_t') && s.regionId === endRegionId);
                
                let isTransitValid = false;
                let transitSpeed = currentSpeedKmh;
                
                if (!isNavalOnly) {
                    if (hasStartPort && hasEndPort) {
                        const capacity = await checkPlayerTransportCapacity(player, startRegionId, 2, rulesObj);
                        if (capacity > 0) { isTransitValid = true; transitSpeed = navalSpeedKmh; }
                    } else if (hasStartAirport && hasEndAirport) {
                        const capacity = await checkPlayerTransportCapacity(player, startRegionId, 0, rulesObj);
                        if (capacity > 0) { isTransitValid = true; transitSpeed = airSpeedKmh; }
                    }
                }
                
                const segDist = haversineDist(segStart[0], segStart[1], segEnd[0], segEnd[1]);
                const segEta = segDist / transitSpeed * 3600 * 1000;
                combinedDistance += segDist;
                combinedEtaMs += segEta;
                if (!isTransitValid) isValid = false;
                if (combinedCoords.length > 0) combinedCoords.push(segEnd);
                else combinedCoords.push(segStart, segEnd);
            }
        }

        if (matchMultiplier > 0) combinedEtaMs = Math.floor(combinedEtaMs / matchMultiplier);

        return {
            isValid,
            distance: combinedDistance,
            etaMs: combinedEtaMs > 0 ? combinedEtaMs : 1000,
            path: combinedCoords,
            cost: combinedCost
        };
    }

    // Ottieni il percorso base tramite A* dinamico
    let pathRes = await dynamicPathfinder.findPath(startLng, startLat, targetLng, targetLat, multiplier, pathfindingMode);
    let pathCoords = pathRes.path || pathRes;
    let pathCost = pathRes.cost || 0;

    // Se A* fallisce e c'è il player, tenta l'instradamento automatico hub-to-hub (non consentito per unità navali)
    if (!pathRes.isValid && player && rulesObj && !isNavalOnly) {
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
                    const { distanceKm: walk1Dist } = computeEtaMs(OP.path, OP.cost, landSpeedKmh, 0);
                    const transitDist = haversineDist(OP.hub.coords[0], OP.hub.coords[1], DP.hub.coords[0], DP.hub.coords[1]);
                    const { distanceKm: walk2Dist } = computeEtaMs(DP.path, DP.cost, landSpeedKmh, 0);
                    const totalDist = walk1Dist + transitDist + walk2Dist;
                    if (totalDist < bestDistance) {
                        bestDistance = totalDist;
                        bestRoute = { type: 'sea', origin: OP, dest: DP, transitDist, walk1Dist, walk2Dist };
                    }
                }
            }
        }

        // Airport-to-Airport
        for (const OA of originAirports) {
            for (const DA of destAirports) {
                const capacity = await checkPlayerTransportCapacity(player, OA.hub.regionId, 0, rulesObj);
                if (capacity > 0) {
                    const { distanceKm: walk1Dist } = computeEtaMs(OA.path, OA.cost, landSpeedKmh, 0);
                    const transitDist = haversineDist(OA.hub.coords[0], OA.hub.coords[1], DA.hub.coords[0], DA.hub.coords[1]);
                    const { distanceKm: walk2Dist } = computeEtaMs(DA.path, DA.cost, landSpeedKmh, 0);
                    const totalDist = walk1Dist + transitDist + walk2Dist;
                    if (totalDist < bestDistance) {
                        bestDistance = totalDist;
                        bestRoute = { type: 'air', origin: OA, dest: DA, transitDist, walk1Dist, walk2Dist };
                    }
                }
            }
        }

        if (bestRoute) {
            const combinedCoords = [...bestRoute.origin.path, ...bestRoute.dest.path];
            const transitSpeed = bestRoute.type === 'sea' ? navalSpeedKmh : airSpeedKmh;
            
            const walk1Eta = bestRoute.walk1Dist / landSpeedKmh;
            const transitEta = bestRoute.transitDist / transitSpeed;
            const walk2Eta = bestRoute.walk2Dist / landSpeedKmh;
            
            let etaMs = Math.floor((walk1Eta + transitEta + walk2Eta) * 3600 * 1000);
            if (matchMultiplier > 0) etaMs = Math.floor(etaMs / matchMultiplier);

            return {
                isValid: true,
                distance: bestDistance,
                etaMs: etaMs > 0 ? etaMs : 1000,
                path: combinedCoords,
                cost: bestRoute.origin.cost + bestRoute.dest.cost
            };
        }
    }

    // Percorso terrestre diretto
    const { etaMs, distanceKm } = computeEtaMs(pathCoords, pathCost, currentSpeedKmh, matchMultiplier);

    let isValid = pathRes.isValid !== undefined ? pathRes.isValid : true;

    // Se l'armata è puramente navale, il punto finale reale del percorso A* (in acqua, penultimo punto)
    // deve essere molto vicino alla destinazione reale richiesta. Se la destinazione
    // è nell'entroterra profondo, l'A* snapperà ad un corpo idrico lontano: in questo
    // caso consideriamo il movimento non valido per l'unità navale.
    if (isNavalOnly && pathCoords && pathCoords.length > 1) {
        const actualEndPoint = pathCoords[pathCoords.length - 2];
        const distToTarget = haversineDist(actualEndPoint[0], actualEndPoint[1], targetLng, targetLat);
        if (distToTarget > 5.0) { // Soglia di 5 km per porti costieri/inaccuratezze
            isValid = false;
            console.log(`[PATH_DEBUG] Movimento navale annullato: destinazione reale troppo lontana dall'acqua (${distToTarget.toFixed(2)} km)`);
        }
    }

    return {
        isValid: isValid,
        distance: distanceKm,
        etaMs,
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
