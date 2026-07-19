const redis = require('../../shared/redisClient.js');
const db = require('../../shared/postgresClient.js');
const fs = require('fs');
const path = require('path');
const { setupCombatFromArrival, processActiveCombats, getRegionsGeojson } = require('./combatLogic.js');
const turf = require('@turf/turf');

const { getArmyVisionRadius, getArmyAttackRange } = require('./gameUtils.js');

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
        const lockAcquired = await redis.set('engine_lock:combatTrigger', 'locked', 'NX', 'PX', 2900);
        if (!lockAcquired) return;
        
        const matchKeys = await db.query("SELECT id_partita_hash FROM partite WHERE substring(struttura_partita::text from 1 for 2) = '01'").then(res => res.rows.map(r => `match:${r.id_partita_hash}`));
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
                if (army.status === 'cooldown' && army.cooldownUntil && Date.now() >= army.cooldownUntil) {
                    console.log(`[COOLDOWN] Army ${army.id} ha terminato il rifornimento.`);
                    await updateMatch(matchId, (mObj) => {
                        const p = mObj.match.player.find(x => x.username === army.owner);
                        if (p && p.armate && p.armate[army.id]) {
                            p.armate[army.id].status = 'standby';
                            delete p.armate[army.id].cooldownUntil;
                        }
                        return { save: true, matchObj: mObj };
                    });
                    continue;
                }

                if (army.status === "Pronto all'attacco" || army.status === "Pronto alla conquista") {
                    const radius = getArmyAttackRange(army);
                    const myCoords = getArmyLocation(army);
                    if (!myCoords) continue;

                    let targetCoords = null;
                    const targetName = army.targetName;
                    
                    console.log(`[COMBAT_TRIGGER] Army ${army.id} is ${army.status}. targetName: ${targetName}, myCoords: ${myCoords}`);
                    
                    // Controlla se targetName è un'armata nemica
                    const enemyArmy = allArmies.find(a => a.id === targetName);
                    if (enemyArmy) {
                        targetCoords = getArmyLocation(enemyArmy);
                    } else if (targetName) {
                        // Controlla se targetName è una città
                        const cityFeature = nodesFeatures.find(f => {
                            const val = f.properties.name || f.properties.ADMIN || f.id;
                            return val && val.toLowerCase() === targetName.toLowerCase();
                        });
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
                        
                        // Per le unità melee (gittata 0 o non valorizzata), usiamo un buffer minimo di 5 km.
                        // Questo evita trigger prematuri dovuti ad attraversamento del confine o raggio visivo elevato.
                        const triggerRadius = radius > 0 ? radius : 5.0;
                        console.log(`[COMBAT_TRIGGER] dist: ${dist}, attackRange: ${radius}, triggerRadius: ${triggerRadius}, targetCoords: ${targetCoords}`);
                        
                        if (dist <= triggerRadius) {
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
    
            // --- INIZIO RADAR DI PROSSIMITA' ---
            const { setupInterceptCombat } = require('./combatLogic.js');
            for (let i = 0; i < allArmies.length; i++) {
                const armyA = allArmies[i];
                if (armyA.status === 'combattimento' || armyA.status === 'in combattimento' || armyA.status === 'cooldown' || armyA.status === 'retreating') continue;

                const playerA = matchObj.match.player.find(p => p.username === armyA.owner);
                if (!playerA || !playerA.inWarWith || playerA.inWarWith.length === 0) continue;

                for (let j = i + 1; j < allArmies.length; j++) {
                    const armyB = allArmies[j];
                    if (armyB.status === 'combattimento' || armyB.status === 'in combattimento' || armyB.status === 'cooldown' || armyB.status === 'retreating') continue;

                    // Se sono nemici
                    if (playerA.inWarWith.includes(armyB.owner)) {
                        const coordsA = getArmyLocation(armyA);
                        const coordsB = getArmyLocation(armyB);
                        if (!coordsA || !coordsB) continue;

                        const dist = haversineDist(coordsA[0], coordsA[1], coordsB[0], coordsB[1]);
                        const rangeA = getArmyAttackRange(armyA);
                        const rangeB = getArmyAttackRange(armyB);
                        
                        // L'ingaggio scatta se la distanza è minore del raggio d'attacco maggiore tra i due (o minimo 5km)
                        const triggerRadius = Math.max(rangeA, rangeB, 5.0);

                        if (dist <= triggerRadius) {
                            console.log(`[PROXIMITY_RADAR] Ingaggio intercettato tra ${armyA.id} e ${armyB.id} (dist: ${dist}km <= trigger: ${triggerRadius}km)`);
                            // Mettiamo temporaneamente uno status per evitare trigger multipli nello stesso loop
                            armyA.status = 'in combattimento';
                            armyB.status = 'in combattimento';
                            await setupInterceptCombat(armyA, armyB, matchId);
                            break; // Passa al prossimo armyA
                        }
                    }
                }
            }
            // --- FINE RADAR DI PROSSIMITA' ---

    } catch (e) {
        console.error("Errore in combatTriggerEngine:", e);
    }
};

const startCombatTriggerEngine = () => {
    setInterval(checkCombatTriggers, 3000);
    console.log("[SYSTEM] Combat Trigger Engine started.");
};

module.exports = { startCombatTriggerEngine };
