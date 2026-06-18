const redis = require("../../shared/redisClient");
const fs = require("fs");
const path = require("path");

// Haversine distance in km
function haversineDist(lon1, lat1, lon2, lat2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

let troopsVisionMap = {}; // id_truppa -> raggio_visivo
let defaultVisionRadius = 100;

try {
    const rulesPath = path.join(__dirname, '../../../shared/assets/game_rules.json');
    if (fs.existsSync(rulesPath)) {
        const gameRules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
        const truppeSheet = gameRules.sheets.find(s => s.name === 'Truppe');
        if (truppeSheet && truppeSheet.lines) {
            truppeSheet.lines.forEach(l => {
                troopsVisionMap[l.id_truppa] = l.raggio_visivo || defaultVisionRadius;
            });
            console.log(`[FOG_OF_WAR] Caricati ${Object.keys(troopsVisionMap).length} raggi visivi dal JSON.`);
        }
    }
} catch (e) {
    console.error("[FOG_OF_WAR] Errore caricamento game_rules.json:", e);
}

// Funzione per calcolare il raggio visivo di un'armata
function getArmyVisionRadius(army) {
    let maxRadius = defaultVisionRadius;
    if (army.composition) {
        for (const [id_truppa, qty] of Object.entries(army.composition)) {
            if (qty > 0 && troopsVisionMap[id_truppa] > maxRadius) {
                maxRadius = troopsVisionMap[id_truppa];
            }
        }
    }
    return maxRadius;
}

// Funzione per ricavare coordinate correnti stimate (se in movimento)
function getEstimatedCoords(army, nodesFeatures = []) {
    let coords = null;
    let loc = army.currentLocation;
    if (typeof loc === 'string') {
        const pts = loc.split(',').map(s => parseFloat(s.trim()));
        if (pts.length === 2 && !isNaN(pts[0])) {
            coords = [pts[0], pts[1]];
        } else {
            // Risolvi il nome del territorio
            const locLower = loc.trim().toLowerCase();
            const feature = nodesFeatures.find(f => {
                const name = f.properties.name || f.properties.ADMIN || f.id;
                return name && String(name).toLowerCase() === locLower;
            });
            if (feature && feature.geometry && feature.geometry.coordinates) {
                let c = feature.geometry.coordinates;
                while (c.length && Array.isArray(c[0][0])) c = c[0];
                if (c.length > 0 && c[0].length === 2) coords = [c[0][0], c[0][1]];
                else if (c.length === 2 && typeof c[0] === 'number') coords = [c[0], c[1]];
            }
        }
    } else if (loc && loc.x !== undefined) {
        coords = [loc.x, loc.y];
    } else if (Array.isArray(loc) && loc.length >= 2) {
        coords = [loc[0], loc[1]];
    }
    
    if ((army.status === 'moving' || army.status === 'moving_to_border' || army.status === "Pronto all'attacco") && army.path && army.path.length > 0 && army.startTime && army.etaMs) {
        const elapsed = Date.now() - army.startTime;
        const progress = Math.max(0, Math.min(1, elapsed / army.etaMs));
        if (progress < 1) {
            let totalDistance = 0;
            const segmentDistances = [];
            for (let i = 0; i < army.path.length - 1; i++) {
                const dx = army.path[i+1][0] - army.path[i][0];
                const dy = army.path[i+1][1] - army.path[i][1];
                const dist = Math.sqrt(dx*dx + dy*dy);
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
            const p1 = army.path[currentIndex];
            const p2 = army.path[currentIndex + 1] || p1;
            const lng = p1[0] + (p2[0] - p1[0]) * segmentProgress;
            const lat = p1[1] + (p2[1] - p1[1]) * segmentProgress;
            coords = [lng, lat];
        } else {
            coords = army.path[army.path.length - 1];
        }
    }
    return coords;
}

const runFogOfWarCycle = async () => {
    try {
        const matchKeys = await redis.keys("match:*");
        const matchIds = new Set();
        matchKeys.forEach(k => {
            const parts = k.split(':');
            if (parts.length >= 2 && parts[1] && parts[1] !== 'ws_broadcast_channel') {
                matchIds.add(parts[1]);
            }
        });

        let nodesFeatures = [];
        try {
            const mapPath = path.join(__dirname, '../../../../shared/assets/map/cities.json');
            if (fs.existsSync(mapPath)) {
                const mapGeo = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
                nodesFeatures = mapGeo.features || [];
            }
        } catch(e) {}

        for (const matchId of matchIds) {
            const playersArmiesKeys = await redis.keys(`match:${matchId}:player:*:armate`);
            let allArmies = [];
            let armiesByPlayer = {};
            
            for (const key of playersArmiesKeys) {
                const parts = key.split(':');
                const username = parts[3];
                const data = await redis.get(key);
                if (data) {
                    const obj = JSON.parse(data);
                    const list = Object.values(obj).map(a => ({...a, owner: username}));
                    armiesByPlayer[username] = list;
                    allArmies = allArmies.concat(list);
                }
            }

            const usersMap = {};
            const db = require('../../shared/postgresClient.js');
            const userRes = await db.query(`SELECT id_user, username FROM utenti`);
            userRes.rows.forEach(r => usersMap[r.username] = r.id_user);

            const nationsData = await redis.get(`match:${matchId}:nations`);
            const nations = nationsData ? JSON.parse(nationsData) : [];

            for (const [username, myArmies] of Object.entries(armiesByPlayer)) {
                const userId = usersMap[username];
                if (!userId) continue;

                const myNations = nations.filter(n => n.playerId === username);
                const myTerritoryNames = new Set();
                myNations.forEach(n => {
                    if (n.territories_flat) {
                        if (Array.isArray(n.territories_flat)) {
                            n.territories_flat.forEach(t => myTerritoryNames.add(String(t).trim().toLowerCase()));
                        } else if (typeof n.territories_flat === 'string') {
                            n.territories_flat.split(',').forEach(t => myTerritoryNames.add(t.trim().toLowerCase()));
                        }
                    }
                });

                // Estraggo le coordinate dei miei territori
                const myTerritoriesCoords = [];
                nodesFeatures.forEach(f => {
                    if (f.geometry && f.geometry.coordinates) {
                        const nodeName = (f.properties.name || f.properties.ADMIN || f.id).toLowerCase();
                        if (myTerritoryNames.has(nodeName)) {
                            let c = f.geometry.coordinates;
                            while (c.length && Array.isArray(c[0][0])) c = c[0];
                            if (c.length > 0 && c[0].length === 2) {
                                myTerritoriesCoords.push([c[0][0], c[0][1]]);
                            } else if (c.length === 2 && typeof c[0] === 'number') {
                                myTerritoriesCoords.push([c[0], c[1]]);
                            }
                        }
                    }
                });

                // Mappo le mie armate con il loro raggio di visione
                const myArmiesVision = myArmies.map(a => {
                    return { coords: getEstimatedCoords(a, nodesFeatures), radius: getArmyVisionRadius(a) };
                }).filter(a => a.coords !== null);

                const visibleEnemies = [];

                for (const army of allArmies) {
                    if (army.owner === username) continue;

                    const coords = getEstimatedCoords(army, nodesFeatures);
                    if (!coords) continue;

                    let isVisible = false;

                    // 1. Check distanza dalle mie armate (usando il raggio visivo di ciascuna armata)
                    for (const myArmy of myArmiesVision) {
                        const dist = haversineDist(coords[0], coords[1], myArmy.coords[0], myArmy.coords[1]);
                        if (dist <= myArmy.radius) {
                            isVisible = true; break;
                        }
                    }

                    // 2. Check distanza dai miei territori (Raggio visivo fisso di confine: 50 km)
                    if (!isVisible) {
                        for (const terrCoords of myTerritoriesCoords) {
                            const dist = haversineDist(coords[0], coords[1], terrCoords[0], terrCoords[1]);
                            if (dist <= 50) { // Un buffer di 50 km dai propri confini
                                isVisible = true; break;
                            }
                        }
                    }

                    if (isVisible) {
                        visibleEnemies.push(army);
                    }
                }

                // Leggere tutti gli hp delle città danneggiate
                const citiesHpKeys = await redis.keys(`match:${matchId}:city_hp:*`);
                const citiesHp = {};
                for (const hpKey of citiesHpKeys) {
                    const cityId = hpKey.split(':').pop();
                    const hp = await redis.get(hpKey);
                    if (hp) citiesHp[cityId] = parseInt(hp, 10);
                }

                const payload = {
                    matchId: matchId,
                    targetUsers: [userId],
                    payload: {
                        type: 'FOG_OF_WAR_UPDATE',
                        payload: {
                            visibleEnemies: visibleEnemies,
                            myArmies: myArmies,
                            citiesHp: citiesHp
                        }
                    }
                };
                await redis.publish('match_ws_broadcast_channel', JSON.stringify(payload));
            }
        }
    } catch (e) {
        console.error("[FOG_OF_WAR] Error during cycle:", e);
    }
};

const startFogOfWarEngine = () => {
    setInterval(runFogOfWarCycle, 3000); // 3 secondi
    console.log("[SYSTEM] Fog of War Engine started.");
};

module.exports = { startFogOfWarEngine };
