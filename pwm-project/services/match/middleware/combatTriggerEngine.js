const redis = require('../../shared/redisClient.js');
const db = require('../../shared/postgresClient.js');
const fs = require('fs');
const path = require('path');
const { setupCombatFromArrival, processActiveCombats } = require('./combatLogic.js');

let troopsVisionMap = {}; 
let defaultVisionRadius = 15;
try {
    const rulesPath = path.join(__dirname, '../../../shared/assets/game_rules.json');
    if (fs.existsSync(rulesPath)) {
        const cdb = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
        const truppeSheet = cdb.sheets.find(s => s.name === 'Truppe');
        if (truppeSheet) {
            truppeSheet.lines.forEach(l => { troopsVisionMap[l.id_truppa] = l.raggio_visivo || defaultVisionRadius; });
        }
    }
} catch (e) {}

function getArmyVisionRadius(army) {
    let maxRadius = defaultVisionRadius;
    if (army.composition) {
        for (const [id_truppa, qty] of Object.entries(army.composition)) {
            if (qty > 0 && troopsVisionMap[id_truppa] > maxRadius) maxRadius = troopsVisionMap[id_truppa];
        }
    }
    return maxRadius;
}

function haversineDist(lon1, lat1, lon2, lat2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getEstimatedCoords(army) {
    let coords = null;
    let loc = army.currentLocation;
    if (typeof loc === 'string') {
        const pts = loc.split(',').map(s => parseFloat(s.trim()));
        if (pts.length === 2 && !isNaN(pts[0])) coords = [pts[0], pts[1]];
    } else if (loc && loc.x !== undefined) {
        coords = [loc.x, loc.y];
    } else if (Array.isArray(loc) && loc.length >= 2) {
        coords = [loc[0], loc[1]];
    }
    
    if ((army.status === 'moving' || army.status === 'moving_to_border' || army.status === "Pronto all'attacco") && army.path && army.path.length > 0 && army.startTime && army.etaMs) {
        const elapsed = Date.now() - army.startTime;
        const progress = Math.max(0, Math.min(1, elapsed / army.etaMs));
        if (progress < 1) {
            const totalSegments = army.path.length - 1;
            const exactIndex = progress * totalSegments;
            const currentIndex = Math.floor(exactIndex);
            const segmentProgress = exactIndex - currentIndex;
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

let nodesFeatures = [];
try {
    const mapPath = path.join(__dirname, '../../../shared/assets/map/cities.json');
    if (fs.existsSync(mapPath)) {
        const mapGeo = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
        nodesFeatures = mapGeo.features || [];
    }
} catch(e) {}

const checkCombatTriggers = async () => {
    try {
        const matchKeys = await redis.keys("match:*");
        const matchIds = new Set();
        matchKeys.forEach(k => {
            const parts = k.split(':');
            if (parts.length >= 2 && parts[1] && parts[1] !== 'ws_broadcast_channel') matchIds.add(parts[1]);
        });

        for (const matchId of matchIds) {
            const playersArmiesKeys = await redis.keys(`match:${matchId}:player:*:armate`);
            let allArmies = [];
            for (const key of playersArmiesKeys) {
                const username = key.split(':')[3];
                const data = await redis.get(key);
                if (data) {
                    const obj = JSON.parse(data);
                    Object.values(obj).forEach(a => allArmies.push({...a, owner: username, redisKey: key}));
                }
            }

            for (const army of allArmies) {
                if (army.status === "Pronto all'attacco") {
                    const radius = getArmyVisionRadius(army);
                    const myCoords = getEstimatedCoords(army);
                    if (!myCoords) continue;

                    let targetCoords = null;
                    const targetName = army.targetName;
                    
                    // Controlla se targetName è un'armata nemica
                    const enemyArmy = allArmies.find(a => a.id === targetName);
                    if (enemyArmy) {
                        targetCoords = getEstimatedCoords(enemyArmy);
                    } else {
                        // Controlla se targetName è una città
                        const cityFeature = nodesFeatures.find(f => (f.properties.name || f.properties.ADMIN || f.id).toLowerCase() === targetName.toLowerCase());
                        if (cityFeature && cityFeature.geometry && cityFeature.geometry.coordinates) {
                            targetCoords = cityFeature.geometry.coordinates;
                        }
                    }

                    if (targetCoords) {
                        const dist = haversineDist(myCoords[0], myCoords[1], targetCoords[0], targetCoords[1]);
                        if (dist <= radius) {
                            // Innesca il combattimento!
                            // Dobbiamo recuperare la mossa dal DB
                            const mossaRes = await db.query(`SELECT * FROM mosse WHERE id_armata = $1 AND type_action = 'mov'`, [army.id]);
                            if (mossaRes.rows.length > 0) {
                                const mossa = mossaRes.rows[0];
                                // Aggiungi target_node e x_dest/y_dest dalla mossa originale
                                const spostamentoRes = await db.query(`SELECT target_node, x_dest, y_dest FROM spostamenti WHERE id_mossa = $1`, [mossa.id_mossa]);
                                if (spostamentoRes.rows.length > 0) {
                                    mossa.target_node = spostamentoRes.rows[0].target_node;
                                    mossa.x_dest = spostamentoRes.rows[0].x_dest;
                                    mossa.y_dest = spostamentoRes.rows[0].y_dest;
                                } else {
                                    mossa.target_node = army.targetName;
                                    mossa.x_dest = targetCoords[0];
                                    mossa.y_dest = targetCoords[1];
                                }
                                
                                await setupCombatFromArrival(army, mossa, matchId, army.owner);
                                
                                // Aggiorna redis con lo stato 'in combattimento'
                                const armateStr = await redis.get(army.redisKey);
                                if (armateStr) {
                                    const armateObj = JSON.parse(armateStr);
                                    if (armateObj[army.id]) {
                                        armateObj[army.id].status = army.status;
                                        if (army.next_round_time) {
                                            armateObj[army.id].next_round_time = army.next_round_time;
                                        }
                                        await redis.set(army.redisKey, JSON.stringify(armateObj));
                                    }
                                }
                                
                                // Forza un ricalcolo immediato per applicare i primi danni all'istante
                                await processActiveCombats();
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error("Errore in combatTriggerEngine:", e);
    }
};

const startCombatTriggerEngine = () => {
    setInterval(checkCombatTriggers, 3000);
    console.log("[SYSTEM] Combat Trigger Engine started.");
};

module.exports = { startCombatTriggerEngine };
