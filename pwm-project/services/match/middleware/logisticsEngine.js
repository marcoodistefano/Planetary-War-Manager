const redis = require('../../shared/redisClient.js');
const db = require('../../shared/postgresClient.js');
const { getMatch, updateMatch } = require('../../shared/matchMonolithic.js');
const { getArmyLocation, haversineDist, getRegionAtCoords } = require('./movementLogic.js');
const { applyDamageToArmy, getArmyMaxHp, addToGraveyard } = require('./combatLogic.js');

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
                    if (player.territori_dict) {
                        for (const list of Object.values(player.territori_dict)) {
                            friendlyRegionsByPlayer[player.username].push(...(list || []));
                        }
                    } else if (player.territori) {
                        friendlyRegionsByPlayer[player.username].push(...(player.territori || []));
                    }
                }

                // Get participant userIds to target broadcasts correctly
                const matchDbRes = await db.query("SELECT id_partita FROM partite WHERE id_partita_hash = $1", [matchId]);
                let matchDbId = matchDbRes.rows.length > 0 ? matchDbRes.rows[0].id_partita : null;
                const participants = matchDbId ? await db.query(
                    "SELECT u.username, u.id_user FROM partecipanti_partite pp JOIN utenti u ON pp.user_id = u.id_user WHERE pp.partita_id = $1",
                    [matchDbId]
                ) : { rows: [] };

                for (const player of matchObj.match.player) {
                    if (!player.armate) continue;
                    
                    const myFriendlyRegions = friendlyRegionsByPlayer[player.username] || [];
                    let playerSaveNeeded = false;

                    for (const [armyId, army] of Object.entries(player.armate)) {
                        if (['in_battaglia', 'in combattimento'].includes(army.status)) continue; // Skip logistics if actively fighting
                        
                        const loc = getArmyLocation(army);
                        if (!loc) continue;

                        const currentRegion = getRegionAtCoords(loc[0], loc[1]);
                        const isInFriendlyRegion = myFriendlyRegions.includes(currentRegion);

                        if (!isInFriendlyRegion) {
                            // Check distance to closest friendly region centroid or just apply a base attrition if deep in enemy territory
                            const maxHp = getArmyMaxHp(army);
                            
                            if (maxHp > 0) {
                                console.log(`[LOGISTICS] Army ${armyId} of ${player.username} is outside friendly territory. Applying attrition.`);
                                
                                // Calculate attrition as 5% of max HP
                                const damageToDeal = Math.max(10, Math.round(maxHp * ATTRITION_DAMAGE_PERCENT));
                                const isDead = applyDamageToArmy(army, damageToDeal);
                                
                                army.status_logistics = 'out_of_supply';
                                playerSaveNeeded = true;
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
                                playerSaveNeeded = true;
                                saveNeeded = true;
                            }
                        }
                    }

                    if (playerSaveNeeded) {
                        // Publish selective broadcast targeting only this specific player's web client
                        let targetUserId = player.id_user;
                        if (!targetUserId) {
                            const pRow = participants.rows.find(p => p.username === player.username);
                            if (pRow) targetUserId = pRow.id_user;
                        }
                        
                        if (targetUserId) {
                            const armiesList = Object.values(player.armate).map(a => ({ ...a, owner: player.username }));
                            const broadcastPayload = {
                                matchId: matchId,
                                targetUsers: [targetUserId],
                                payload: {
                                    type: 'RESOURCES_UPDATED',
                                    data: {
                                        armies_updated: true,
                                        armies: armiesList
                                    }
                                }
                            };
                            await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
                        }
                    }
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
