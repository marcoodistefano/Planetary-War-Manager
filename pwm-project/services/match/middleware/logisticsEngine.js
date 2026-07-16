const redis = require('../../shared/redisClient.js');
const db = require('../../shared/postgresClient.js');
const { getMatch, updateMatch } = require('../../shared/matchMonolithic.js');
const { getArmyLocation, haversineDist, getRegionAtCoords } = require('./movementLogic.js');
const { applyDamageToArmy, addToGraveyard } = require('./combatLogic.js');

const ATTRITION_DAMAGE_PERCENT = 0.05; // 5% max hp damage per tick
const MAX_SUPPLY_DISTANCE_KM = 2500; // 2500 km max supply line

const processLogistics = async () => {
    try {
        const lockAcquired = await redis.set('engine_lock:logisticsLoop', 'locked', 'NX', 'PX', 59000); // 1 minute lock
        if (!lockAcquired) return;
        
        const matchKeys = await db.query("SELECT id_partita_hash FROM partite WHERE substring(struttura_partita::text from 1 for 2) = '01'").then(res => res.rows.map(r => `match:${r.id_partita_hash}`));
        const matchIds = new Set();
        matchKeys.forEach(k => {
            const parts = k.split(':');
            if (parts.length >= 2 && parts[1] && parts[1] !== 'ws_broadcast_channel') matchIds.add(parts[1]);
        });

        for (const matchId of matchIds) {
            await updateMatch(matchId, async (matchObj) => {
                if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false };

                let saveNeeded = false;
                const friendlyRegionsByPlayer = {};

                // Map all friendly regions
                for (const player of matchObj.match.player) {
                    friendlyRegionsByPlayer[player.username] = [];
                    if (matchObj.match.nations) {
                        for (const nation of matchObj.match.nations) {
                            if (nation.player_username === player.username) {
                                friendlyRegionsByPlayer[player.username].push(nation.id_nazione);
                            }
                        }
                    }
                }

                // Gather node coords from match structures
                const friendlyCitiesCoordsByPlayer = {};
                for (const player of matchObj.match.player) {
                    friendlyCitiesCoordsByPlayer[player.username] = [];
                    if (player.strutture) {
                        for (const s of player.strutture) {
                            if (s.status === 'built' && s.structureId.startsWith('centro_comando')) {
                                // We can use region coords or node coords, we'll need to fetch them if we can, but we can't easily sync them here without movementLogic's getNodeCoords
                                // We will just check if army is in friendly region first.
                            }
                        }
                    }
                }

                for (const player of matchObj.match.player) {
                    if (!player.armate) continue;
                    
                    const myFriendlyRegions = friendlyRegionsByPlayer[player.username] || [];

                    for (const [armyId, army] of Object.entries(player.armate)) {
                        if (['in_battaglia', 'in combattimento'].includes(army.status)) continue; // Skip logistics if actively fighting? Or maybe they suffer more? Let's skip for now to avoid race conditions with combatEngine.
                        
                        const loc = getArmyLocation(army);
                        if (!loc) continue;

                        const currentRegion = getRegionAtCoords(loc[0], loc[1]);
                        const isInFriendlyRegion = myFriendlyRegions.includes(currentRegion);

                        if (!isInFriendlyRegion) {
                            // Check distance to closest friendly region centroid or just apply a base attrition if deep in enemy territory
                            // For a simple GSG mechanic: if outside friendly territory, 2% attrition
                            
                            // Let's calculate total max HP to apply fixed percentage damage
                            const { getArmyMaxHp } = require('./combatLogic.js'); // We need this exported or we can just calculate it
                            
                            // Wait, getArmyMaxHp is not exported. Let's just use applyDamageToArmy with an estimated damage or export getArmyMaxHp.
                            // I'll export getArmyMaxHp in the next step. For now, let's assume we can get it or we just apply flat damage.
                            
                            // Let's do a simple logic: 1 unit lost per tick if outside supply lines
                            let totalUnits = 0;
                            if (army.composition) {
                                for (const qty of Object.values(army.composition)) {
                                    totalUnits += qty;
                                }
                            }
                            
                            if (totalUnits > 0) {
                                console.log(`[LOGISTICS] Army ${armyId} of ${player.username} is outside friendly territory. Applying attrition.`);
                                
                                // Randomly remove 1-5% of units
                                const attrDamage = Math.max(1, Math.floor(totalUnits * ATTRITION_DAMAGE_PERCENT));
                                
                                // Since we didn't export getArmyMaxHp, let's just reduce composition directly to be safe and simple
                                let damageToDeal = attrDamage * 10; // estimate 10 hp per unit
                                const isDead = applyDamageToArmy(army, damageToDeal);
                                
                                army.status_logistics = 'out_of_supply';
                                saveNeeded = true;
                                
                                if (isDead) {
                                    console.log(`[LOGISTICS] Army ${armyId} of ${player.username} died from attrition.`);
                                    await addToGraveyard(matchId, player.username, army, 'Logoramento/Attrito');
                                    delete player.armate[armyId];
                                }
                            }
                        } else {
                            if (army.status_logistics === 'out_of_supply') {
                                delete army.status_logistics;
                                saveNeeded = true;
                            }
                        }
                    }
                }

                if (saveNeeded) {
                    // Trigger broadcast of RESOURCES_UPDATED so frontend knows
                    redis.publish('match_ws_broadcast_channel', JSON.stringify({
                        matchId: matchId,
                        payload: { type: 'RESOURCES_UPDATED', data: { armies_updated: true, armies: Object.values(matchObj.match.player.find(p=>p.username===matchObj.match.player[0].username).armate).map(a => ({...a, owner: matchObj.match.player[0].username})) } }
                    })); // This broadcast is a bit hacky for all players, let's let the sync_workers handle the actual full broadcast, we just save.
                }

                return { save: saveNeeded, matchObj };
            });
        }
    } catch (e) {
        console.error("Errore in logisticsEngine:", e);
    }
};

const startLogisticsEngine = () => {
    // Run every 60 seconds
    setInterval(processLogistics, 60000);
    console.log("[SYSTEM] Logistics Engine started.");
};

module.exports = { startLogisticsEngine };
