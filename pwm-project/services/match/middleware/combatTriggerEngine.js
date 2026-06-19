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
        const gameRules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
        const truppeSheet = gameRules.sheets.find(s => s.name === 'Truppe');
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

const { getArmyLocation, haversineDist } = require('./movementLogic.js');
let nodesFeatures = [];
try {
    const topojson = require('topojson-client');
    const mapPath = path.join(__dirname, '../../../shared/assets/map/cities.json');
    if (fs.existsSync(mapPath)) {
        const mapGeo = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
        if (mapGeo.type === 'Topology') {
            const objectKey = Object.keys(mapGeo.objects)[0];
            const geojson = topojson.feature(mapGeo, mapGeo.objects[objectKey]);
            nodesFeatures = geojson.features || [];
        } else {
            nodesFeatures = mapGeo.features || [];
        }
    }
} catch(e) {
    console.error("Error loading cities.json in combatTriggerEngine:", e);
}

const { getMatch, updateMatch } = require('../../shared/matchMonolithic.js');

const checkCombatTriggers = async () => {
    try {
        const matchKeys = await db.query('SELECT id_partita_hash FROM partite').then(res => res.rows.map(r => `match:${r.id_partita_hash}`));
        const matchIds = new Set();
        matchKeys.forEach(k => {
            const parts = k.split(':');
            if (parts.length >= 2 && parts[1] && parts[1] !== 'ws_broadcast_channel') matchIds.add(parts[1]);
        });

        for (const matchId of matchIds) {
            const matchObj = await getMatch(matchId);
            if (!matchObj || !matchObj.match || !matchObj.match.player) continue;

            let allArmies = [];
            for (const player of matchObj.match.player) {
                if (player.armate) {
                    Object.entries(player.armate).forEach(([id, a]) => {
                        allArmies.push({...a, owner: player.username, id: id});
                    });
                }
            }

            for (const army of allArmies) {
                if (army.status === "Pronto all'attacco") {
                    const radius = getArmyVisionRadius(army);
                    const myCoords = getArmyLocation(army);
                    if (!myCoords) continue;

                    let targetCoords = null;
                    const targetName = army.targetName;
                    
                    console.log(`[COMBAT_TRIGGER] Army ${army.id} is Pronto all'attacco. targetName: ${targetName}, myCoords: ${myCoords}`);
                    
                    // Controlla se targetName è un'armata nemica
                    const enemyArmy = allArmies.find(a => a.id === targetName);
                    if (enemyArmy) {
                        targetCoords = getArmyLocation(enemyArmy);
                    } else if (targetName) {
                        // Controlla se targetName è una città
                        const cityFeature = nodesFeatures.find(f => (f.properties.name || f.properties.ADMIN || f.id).toLowerCase() === targetName.toLowerCase());
                        if (cityFeature && cityFeature.geometry && cityFeature.geometry.coordinates) {
                            targetCoords = cityFeature.geometry.coordinates;
                        } else {
                            targetCoords = army.targetCoords;
                        }
                    } else {
                        targetCoords = army.targetCoords;
                    }

                    if (targetCoords) {
                        const dist = haversineDist(myCoords[0], myCoords[1], targetCoords[0], targetCoords[1]);
                        console.log(`[COMBAT_TRIGGER] dist: ${dist}, radius: ${radius}, targetCoords: ${targetCoords}`);
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
                                
                                console.log(`[COMBAT_TRIGGER] Triggering setupCombatFromArrival per army ${army.id} at coords ${myCoords}`);
                                await db.query(`DELETE FROM spostamenti WHERE id_mossa = $1`, [mossa.id_mossa]);
                                await setupCombatFromArrival(army, mossa, matchId, army.owner, myCoords);
                                
                                // Aggiorna redis con lo stato modificato da setupCombatFromArrival
                                await updateMatch(matchId, (mObj) => {
                                    const p = mObj.match.player.find(x => x.username === army.owner);
                                    if (p && p.armate && p.armate[army.id]) {
                                        p.armate[army.id].status = army.status;
                                        if (army.currentLocation) p.armate[army.id].currentLocation = army.currentLocation;
                                        if (army.next_round_time) p.armate[army.id].next_round_time = army.next_round_time;
                                        delete p.armate[army.id].path;
                                        delete p.armate[army.id].etaMs;
                                        delete p.armate[army.id].startTime;
                                        delete p.armate[army.id].targetName;
                                        delete p.armate[army.id].missionMode;
                                        delete p.armate[army.id].targetCoords;
                                    }
                                    return { save: true, matchObj: mObj };
                                });
                                
                                // Forza un ricalcolo immediato per applicare i primi danni all'istante
                                await processActiveCombats();
                            } else {
                                console.log(`[COMBAT_TRIGGER] Nessuna mossa in db per armata ${army.id}, forzo standby in Redis e salto.`);
                                await updateMatch(matchId, (mObj) => {
                                    const p = mObj.match.player.find(x => x.username === army.owner);
                                    if (p && p.armate && p.armate[army.id]) {
                                        p.armate[army.id].status = 'standby';
                                        delete p.armate[army.id].path;
                                        delete p.armate[army.id].etaMs;
                                        delete p.armate[army.id].startTime;
                                        delete p.armate[army.id].targetName;
                                        delete p.armate[army.id].missionMode;
                                        delete p.armate[army.id].targetCoords;
                                    }
                                    return { save: true, matchObj: mObj };
                                });
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
