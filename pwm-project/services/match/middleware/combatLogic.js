const db = require('../../shared/postgresClient.js');
const redis = require('../../shared/redisClient.js');
const fs = require('fs');
const path = require('path');

// Carica le regole dal json
let gameRules = null;
const loadGameRules = () => {
    if (gameRules) return gameRules;
    const rulesPath = path.join(__dirname, '../../../shared/assets/game_rules.json');
    if (fs.existsSync(rulesPath)) {
        gameRules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
    }
    return gameRules;
};

const getTroopStats = (troopId) => {
    const rules = loadGameRules();
    if (!rules) return null;
    const truppeSheet = rules.sheets.find(s => s.name === 'Truppe');
    if (!truppeSheet) return null;
    return truppeSheet.lines.find(l => l.id_truppa === troopId);
};

const calculateArmyDamage = (army) => {
    let dmg = 0;
    if (army && army.composition) {
        for (const [troopId, count] of Object.entries(army.composition)) {
            const stats = getTroopStats(troopId);
            if (stats && count > 0) {
                dmg += (stats.danno_base || 0) * count;
            }
        }
    }
    return dmg;
};

const getArmyMaxHp = (army) => {
    let maxHp = 0;
    if (army && army.composition) {
        for (const [troopId, count] of Object.entries(army.composition)) {
            const stats = getTroopStats(troopId);
            if (stats && count > 0) {
                maxHp += (stats.HP || 10) * count;
            }
        }
    }
    return maxHp;
};

const applyDamageToArmy = (army, damage) => {
    const totalMaxHp = getArmyMaxHp(army);
    if (totalMaxHp === 0) return true;
    
    // We apply damage to the true current max HP of the surviving composition
    let currentHp = totalMaxHp - damage;
    
    if (currentHp <= 0) {
        army.hp = 0;
        army.composition = {};
        return true; // died
    }
    
    army.hp = currentHp;
    const survivalRatio = currentHp / totalMaxHp;
    let anySurvived = false;
    for (const [troopId, count] of Object.entries(army.composition)) {
        if (count > 0) {
            // Use Math.round instead of Math.ceil to prevent infinite survival of small units
            army.composition[troopId] = Math.round(count * survivalRatio);
            if (army.composition[troopId] > 0) {
                anySurvived = true;
            } else {
                delete army.composition[troopId];
            }
        }
    }
    
    if (!anySurvived) {
        army.hp = 0;
        army.composition = {};
        return true; // died
    }
    
    return false; // survived
};

const getMatchMultiplier = async (id_partita_hash) => {
    let multiplier = 1;
    try {
        const { getMatch } = require('../../shared/matchMonolithic.js');
        const matchData = await getMatch(id_partita_hash);
        if (matchData && matchData.match && matchData.match.struttura_partita) {
            const Eru = require('./Eru.js');
            const decodedMatch = Eru.decode_match(matchData.match.struttura_partita);
            multiplier = decodedMatch.multiplierValue || 1;
        }
    } catch(err) {
        console.error("[SYS_WARN] Impossibile ottenere il moltiplicatore nel combat:", err);
    }
    return multiplier;
};

const addToGraveyard = async (id_partita_hash, playerUsername, armyData, destroyedBy) => {
    if (!playerUsername || !armyData) return;
    try {
        const graveyardKey = `match:${id_partita_hash}:player:${playerUsername}:graveyard`;
        const record = {
            ...armyData,
            destroyedAt: new Date().toISOString(),
            destroyedBy: destroyedBy || 'Sconosciuto'
        };
        // redis client node-redis doesn't have lpush directly sometimes, let's use sendCommand if needed, but wait:
        // node-redis has lPush!
        await redis.lPush(graveyardKey, JSON.stringify(record));
        await redis.lTrim(graveyardKey, 0, 99);
    } catch (e) {
        console.error("Errore salvataggio nel cimitero:", e);
    }
};

const emitCombatEvent = async (id_partita_hash, attackerName, defenderName, damage, result, playersInvolved) => {
    try {
        const broadcastPayload = {
            matchId: id_partita_hash,
            payload: {
                type: 'COMBAT_EVENT',
                attacker: attackerName,
                defender: defenderName,
                damage: damage,
                result: result,
                players: playersInvolved
            }
        };
        await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
    } catch (e) {
        console.error("Errore emitCombatEvent:", e);
    }
};

const processActiveCombats = async () => {
    try {
        const { getMatch, updateMatch } = require('../../shared/matchMonolithic.js');
        const res = await db.query(`
            SELECT c.*, p.id_partita_hash 
            FROM attacco c
            JOIN partite p ON c.partita_id = p.id_partita
            WHERE status = 'active' AND next_round_time <= NOW()
        `);
        
        for (const combat of res.rows) {
            const { id_attacco, id_mossa, id_attaccante, id_target_armata, id_target_citta, id_partita_hash, partita_id } = combat;
            
            let matchObj = await getMatch(id_partita_hash);
            if (!matchObj || !matchObj.match || !matchObj.match.player) continue;

            let attackerArmy = null;
            let attackerPlayer = null;

            for (const p of matchObj.match.player) {
                if (p.armate && p.armate[id_attaccante]) {
                    attackerArmy = p.armate[id_attaccante];
                    attackerPlayer = p.username;
                    break;
                }
            }

            if (!attackerArmy) {
                await db.query(`UPDATE attacco SET status = 'ended' WHERE id_attacco = $1`, [id_attacco]);
                continue;
            }

            let totalDmg = calculateArmyDamage(attackerArmy);
            let combatEnded = false;
            let attackerDied = false;

            let damageToArmy = 0;
            let damageToCity = 0;
            let defenderArmy = null;
            let defenderPlayer = null;

            if (id_target_armata) {
                for (const p of matchObj.match.player) {
                    if (p.armate && p.armate[id_target_armata]) {
                        defenderArmy = p.armate[id_target_armata];
                        defenderPlayer = p.username;
                        break;
                    }
                }
            }

            if (id_target_armata && defenderArmy && id_target_citta) {
                 damageToCity = Math.floor(totalDmg / 3);
                 damageToArmy = totalDmg - damageToCity;
            } else if (id_target_armata && defenderArmy) {
                 damageToArmy = totalDmg;
                 damageToCity = 0;
            } else if (id_target_citta) {
                 damageToCity = totalDmg;
            }

            const defenderName = defenderArmy ? defenderArmy.name : 'Armata nemica';
            const attackerName = attackerArmy ? attackerArmy.name : 'La tua armata';
            const multiplier = await getMatchMultiplier(id_partita_hash);
            const intervalMs = Math.max(1000, Math.floor((15 * 60000) / multiplier));
            const newNextRoundDate = new Date(Date.now() + intervalMs);

            if (damageToArmy > 0 && defenderArmy) {
                const oldDefenderComposition = JSON.parse(JSON.stringify(defenderArmy.composition));
                const defenderDied = applyDamageToArmy(defenderArmy, damageToArmy);
                
                if (defenderDied) {
                    await addToGraveyard(id_partita_hash, defenderPlayer, defenderArmy, attackerPlayer);
                    await updateMatch(id_partita_hash, (mObj) => {
                        const p = mObj.match.player.find(x => x.username === defenderPlayer);
                        if (p && p.armate) delete p.armate[id_target_armata];
                        return { save: true, matchObj: mObj };
                    });
                    await db.query(`DELETE FROM mosse WHERE id_armata = $1`, [id_target_armata]);
                    await emitCombatEvent(id_partita_hash, attackerName, defenderName, damageToArmy, 'distrutta', [attackerPlayer, defenderPlayer]);
                    
                    if (!id_target_citta) combatEnded = true;
                } else {
                    const deadDefenderTroops = {};
                    for (const troop in oldDefenderComposition) {
                        const diff = oldDefenderComposition[troop] - (defenderArmy.composition[troop] || 0);
                        if (diff > 0) deadDefenderTroops[troop] = diff;
                    }
                    if (Object.keys(deadDefenderTroops).length > 0) {
                        await addToGraveyard(id_partita_hash, defenderPlayer, {
                            name: defenderArmy.name,
                            composition: deadDefenderTroops,
                            currentLocation: defenderArmy.currentLocation
                        }, attackerPlayer);
                    }
                    
                    await updateMatch(id_partita_hash, (mObj) => {
                        const p = mObj.match.player.find(x => x.username === defenderPlayer);
                        if (p && p.armate && p.armate[id_target_armata]) {
                            p.armate[id_target_armata] = defenderArmy;
                            p.armate[id_target_armata].next_round_time = newNextRoundDate.toISOString();
                        }
                        return { save: true, matchObj: mObj };
                    });
                    
                    const oldAttackerComposition = JSON.parse(JSON.stringify(attackerArmy.composition));
                    let counterDmg = calculateArmyDamage(defenderArmy);
                    attackerDied = applyDamageToArmy(attackerArmy, counterDmg);
                    
                    if (attackerDied) {
                        await addToGraveyard(id_partita_hash, attackerPlayer, attackerArmy, defenderPlayer);
                        await updateMatch(id_partita_hash, (mObj) => {
                            const p = mObj.match.player.find(x => x.username === attackerPlayer);
                            if (p && p.armate) delete p.armate[id_attaccante];
                            return { save: true, matchObj: mObj };
                        });
                        await db.query(`DELETE FROM mosse WHERE id_armata = $1`, [id_attaccante]);
                        combatEnded = true;
                        await emitCombatEvent(id_partita_hash, defenderName, attackerName, counterDmg, 'distrutta', [attackerPlayer, defenderPlayer]);
                    } else {
                        const deadAttackerTroops = {};
                        for (const troop in oldAttackerComposition) {
                            const diff = oldAttackerComposition[troop] - (attackerArmy.composition[troop] || 0);
                            if (diff > 0) deadAttackerTroops[troop] = diff;
                        }
                        if (Object.keys(deadAttackerTroops).length > 0) {
                            await addToGraveyard(id_partita_hash, attackerPlayer, {
                                name: attackerArmy.name,
                                composition: deadAttackerTroops,
                                currentLocation: attackerArmy.currentLocation
                            }, defenderPlayer);
                        }
                        
                        await updateMatch(id_partita_hash, (mObj) => {
                            const p = mObj.match.player.find(x => x.username === attackerPlayer);
                            if (p && p.armate && p.armate[id_attaccante]) {
                                p.armate[id_attaccante] = attackerArmy;
                                p.armate[id_attaccante].next_round_time = newNextRoundDate.toISOString();
                            }
                            return { save: true, matchObj: mObj };
                        });
                        await emitCombatEvent(id_partita_hash, attackerName, defenderName, damageToArmy, 'sopravvissuta', [attackerPlayer, defenderPlayer]);
                    }
                }
            } else if (id_target_armata && !id_target_citta) {
                combatEnded = true;
            }

            if (damageToCity > 0 && id_target_citta && !attackerDied) {
                const cityHpKey = `match:${id_partita_hash}:cities_hp`;
                let cityHpStr = await redis.hGet(cityHpKey, id_target_citta);
                let cityHp = cityHpStr ? parseInt(cityHpStr, 10) : 100;
                cityHp -= damageToCity;

                if (cityHp <= 0) {
                    combatEnded = true;
                    await redis.hDel(cityHpKey, id_target_citta);
                    
                    console.log(`[COMBAT_DEBUG] City HP <= 0 for ${id_target_citta}. Initiating conquest...`);
                    
                    const { getRegionForNode } = require('./movementLogic.js');
                    const regionId = getRegionForNode(id_target_citta) || id_target_citta;

                    let updatedNations = [];
                    await updateMatch(id_partita_hash, (mObj) => {
                        let defNation = null;
                        let attNation = mObj.match.player.find(n => n.username === attackerPlayer);
                        let actualRegionToTransfer = regionId;

                        for (let n of mObj.match.player) {
                            if (n.territori_dict && Object.values(n.territori_dict).some(list => list.includes(regionId))) {
                                defNation = n;
                                break;
                            }
                        }

                        if (!defNation && id_target_citta !== regionId) {
                            for (let n of mObj.match.player) {
                                if (n.territori_dict && Object.values(n.territori_dict).some(list => list.includes(id_target_citta))) {
                                    defNation = n;
                                    actualRegionToTransfer = id_target_citta;
                                    break;
                                }
                            }
                        }

                        if (defNation && attNation && defNation.username !== attNation.username) {
                            let targetAdmin = null;
                            for (const admin in defNation.territori_dict) {
                                if (defNation.territori_dict[admin].includes(actualRegionToTransfer)) {
                                    targetAdmin = admin;
                                    defNation.territori_dict[admin] = defNation.territori_dict[admin].filter(t => t !== actualRegionToTransfer);
                                    if (defNation.territori_dict[admin].length === 0) {
                                        delete defNation.territori_dict[admin];
                                    }
                                    break;
                                }
                            }

                            if (!attNation.territori_dict) attNation.territori_dict = {};
                            if (!attNation.territori_dict[targetAdmin || "Altro"]) {
                                attNation.territori_dict[targetAdmin || "Altro"] = [];
                            }
                            attNation.territori_dict[targetAdmin || "Altro"].push(actualRegionToTransfer);
                        }
                        
                        updatedNations = mObj.match.player;
                        return { save: true, matchObj: mObj };
                    });

                    // Database Sync for Conquest (omitted for brevity, keep what was there if needed, 
                    // but since monolithic is the source of truth, we just emit event)
                    
                    const broadcastPayload = {
                        matchId: id_partita_hash,
                        payload: {
                            type: 'TERRITORY_CONQUERED',
                            nations: updatedNations
                        }
                    };
                    await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
                    await emitCombatEvent(id_partita_hash, attackerName, id_target_citta, damageToCity, 'distrutta', [attackerPlayer]);
                    
                    if (!attackerDied) {
                        await updateMatch(id_partita_hash, (mObj) => {
                            const p = mObj.match.player.find(x => x.username === attackerPlayer);
                            if (p && p.armate && p.armate[id_attaccante]) {
                                p.armate[id_attaccante].status = 'standby';
                            }
                            return { save: true, matchObj: mObj };
                        });
                    }
                } else {
                    await redis.hSet(cityHpKey, id_target_citta, cityHp.toString());
                    await emitCombatEvent(id_partita_hash, attackerName, id_target_citta, damageToCity, 'sopravvissuta', [attackerPlayer]);
                }
            }
            
            if (combatEnded) {
                await db.query(`UPDATE attacco SET status = 'ended' WHERE id_attacco = $1`, [id_attacco]);
                await db.query(`DELETE FROM mosse WHERE id_mossa = $1`, [id_mossa]);
                
                if (!attackerDied) {
                    await updateMatch(id_partita_hash, (mObj) => {
                        const p = mObj.match.player.find(x => x.username === attackerPlayer);
                        if (p && p.armate && p.armate[id_attaccante]) {
                            p.armate[id_attaccante].status = 'standby';
                        }
                        return { save: true, matchObj: mObj };
                    });
                }
            } else {
                await db.query(`UPDATE attacco SET next_round_time = $1 WHERE id_attacco = $2`, [newNextRoundDate, id_attacco]);
                if (!attackerDied) {
                    await updateMatch(id_partita_hash, (mObj) => {
                        const p = mObj.match.player.find(x => x.username === attackerPlayer);
                        if (p && p.armate && p.armate[id_attaccante]) {
                            p.armate[id_attaccante].next_round_time = newNextRoundDate.toISOString();
                        }
                        return { save: true, matchObj: mObj };
                    });
                }
            }
        }
    } catch (e) {
        console.error("Errore processActiveCombats:", e);
    }
};

const startCombatLoop = () => {
    console.log("[SYSTEM] Avvio Combat Loop (interval 3s)");
    setInterval(processActiveCombats, 3000); // Esegue il check ogni 3 secondi
};

const setupCombatFromArrival = async (army, mossa, id_partita_hash, attackerUsername, currentCoords) => {
    try {
        const { id_mossa, id_armata, target_node, x_dest, y_dest } = mossa;
        const { getMatch, updateMatch } = require('../../shared/matchMonolithic.js');

        let matchObj = await getMatch(id_partita_hash);
        if (!matchObj || !matchObj.match || !matchObj.match.player) return;

        let defenderId = null;
        let isArmyTarget = false;
        
        const { getRegionForNode } = require('./movementLogic.js');
        const regionId = getRegionForNode(target_node) || target_node;

        let targetNation = matchObj.match.player.find(n => n.territori_dict && Object.values(n.territori_dict).some(list => list.includes(regionId)));
        if (!targetNation && target_node && target_node !== regionId) {
            targetNation = matchObj.match.player.find(n => n.territori_dict && Object.values(n.territori_dict).some(list => list.includes(target_node)));
        }
        
        if (targetNation && targetNation.username) {
            if (targetNation.username === attackerUsername) {
                army.status = 'standby';
                delete army.next_round_time;
                await db.query(`DELETE FROM mosse WHERE id_mossa = $1`, [id_mossa]);
                return;
            }
            defenderId = targetNation.username;
            
            await updateMatch(id_partita_hash, (mObj) => {
                const def = mObj.match.player.find(n => n.username === defenderId);
                const att = mObj.match.player.find(n => n.username === attackerUsername);
                if (def) {
                    def.inWarWith = def.inWarWith || [];
                    if (!def.inWarWith.includes(attackerUsername)) def.inWarWith.push(attackerUsername);
                }
                if (att) {
                    att.inWarWith = att.inWarWith || [];
                    if (!att.inWarWith.includes(defenderId)) att.inWarWith.push(defenderId);
                }
                return { save: true, matchObj: mObj };
            });
        } else {
            for (const n of matchObj.match.player) {
                if (n.username === attackerUsername) continue;
                if (n.armate && n.armate[target_node]) {
                    defenderId = n.username;
                    isArmyTarget = true;
                    await updateMatch(id_partita_hash, (mObj) => {
                        const def = mObj.match.player.find(x => x.username === defenderId);
                        const att = mObj.match.player.find(x => x.username === attackerUsername);
                        if (def) {
                            def.inWarWith = def.inWarWith || [];
                            if (!def.inWarWith.includes(attackerUsername)) def.inWarWith.push(attackerUsername);
                        }
                        if (att) {
                            att.inWarWith = att.inWarWith || [];
                            if (!att.inWarWith.includes(defenderId)) att.inWarWith.push(defenderId);
                        }
                        return { save: true, matchObj: mObj };
                    });
                    break;
                }
            }
        }

        if (defenderId) {
            let updatedNations = [];
            matchObj = await getMatch(id_partita_hash);
            if (matchObj && matchObj.match) updatedNations = matchObj.match.player;

            const broadcastPayload = {
                matchId: id_partita_hash,
                payload: {
                    type: 'WAR_DECLARED',
                    data: { attacker: attackerUsername, defender: defenderId },
                    nations: updatedNations
                }
            };
            await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
        }

        let defendingArmyId = null;
        if (isArmyTarget) {
            defendingArmyId = target_node;
        } else {
            const { getNodeCoords } = require('./movementLogic.js');
            const cityCoords = getNodeCoords(target_node);
            matchObj = await getMatch(id_partita_hash);
            
            for (const n of matchObj.match.player) {
                if (n.username === attackerUsername) continue;
                if (n.armate) {
                    for (const [defId, defArmy] of Object.entries(n.armate)) {
                        let isAtCity = false;
                        if (defArmy.currentLocation === target_node || defArmy.targetName === target_node) {
                            isAtCity = true;
                        } else if (cityCoords && defArmy.currentLocation && defArmy.status !== 'moving') {
                            let ax, ay;
                            if (typeof defArmy.currentLocation === 'string') {
                                const parts = defArmy.currentLocation.split(',');
                                ax = parseFloat(parts[0]); ay = parseFloat(parts[1]);
                            } else if (typeof defArmy.currentLocation === 'object') {
                                ax = defArmy.currentLocation.x; ay = defArmy.currentLocation.y;
                            }
                            if (ax !== undefined && ay !== undefined) {
                                const dx = ax - cityCoords[0];
                                const dy = ay - cityCoords[1];
                                if (dx*dx + dy*dy < 0.0001) isAtCity = true;
                            }
                        }
                        if (isAtCity) {
                            defendingArmyId = defId;
                            break;
                        }
                    }
                }
                if (defendingArmyId) break;
            }
        }

        const checkAttacco = await db.query(`SELECT id_attacco FROM attacco WHERE id_mossa = $1`, [id_mossa]);
        const multiplier = await getMatchMultiplier(id_partita_hash);
        const intervalMs = Math.max(1000, Math.floor((15 * 60000) / multiplier));
        const newNextRoundDate = new Date(Date.now() + intervalMs);

        if (checkAttacco.rows.length === 0) {
            await db.query(`UPDATE mosse SET type_action = 'atk', ttl = $1 WHERE id_mossa = $2`, [newNextRoundDate, id_mossa]);

            let cityTarget = isArmyTarget ? null : target_node;

            if (!cityTarget && !defendingArmyId) {
                console.log(`[COMBAT] Nessun bersaglio valido trovato per l'armata ${id_armata}. Annullamento attacco.`);
                army.status = 'standby';
                await db.query(`DELETE FROM mosse WHERE id_mossa = $1`, [id_mossa]);
                return;
            }

            await db.query(`
                INSERT INTO attacco (id_mossa, partita_id, id_attaccante, id_target_citta, id_target_armata, next_round_time)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [id_mossa, mossa.partita_id, id_armata, cityTarget, defendingArmyId, newNextRoundDate]);
            
            army.status = 'in combattimento';
            if (currentCoords) {
                army.currentLocation = `${currentCoords[0]},${currentCoords[1]}`;
            } else {
                army.currentLocation = `${x_dest},${y_dest}`;
            }
            army.next_round_time = newNextRoundDate.toISOString();

            if (defendingArmyId && defenderId) {
                await updateMatch(id_partita_hash, (mObj) => {
                    const p = mObj.match.player.find(x => x.username === defenderId);
                    if (p && p.armate && p.armate[defendingArmyId]) {
                        p.armate[defendingArmyId].status = 'in combattimento';
                        if (p.armate[defendingArmyId].path && p.armate[defendingArmyId].path.length > 0 && p.armate[defendingArmyId].startTime && p.armate[defendingArmyId].etaMs) {
                            const { getEstimatedCoords } = require('./combatTriggerEngine.js');
                            const currentC = getEstimatedCoords(p.armate[defendingArmyId]) || p.armate[defendingArmyId].currentLocation;
                            if (currentC && Array.isArray(currentC)) {
                                p.armate[defendingArmyId].currentLocation = `${currentC[0]},${currentC[1]}`;
                            } else if (currentC) {
                                p.armate[defendingArmyId].currentLocation = currentC;
                            }
                        }
                        delete p.armate[defendingArmyId].path;
                        delete p.armate[defendingArmyId].etaMs;
                        delete p.armate[defendingArmyId].startTime;
                        delete p.armate[defendingArmyId].targetName;
                        delete p.armate[defendingArmyId].missionMode;
                        delete p.armate[defendingArmyId].targetCoords;
                    }
                    return { save: true, matchObj: mObj };
                });

                const defMossaRes = await db.query(`SELECT id_mossa FROM mosse WHERE id_armata = $1 AND type_action = 'mov'`, [defendingArmyId]);
                if (defMossaRes.rows.length > 0) {
                    for (const mr of defMossaRes.rows) {
                        await db.query(`DELETE FROM spostamenti WHERE id_mossa = $1`, [mr.id_mossa]);
                        await db.query(`DELETE FROM mosse WHERE id_mossa = $1`, [mr.id_mossa]);
                    }
                }
                
                const broadcastDef = {
                    matchId: id_partita_hash,
                    targetUsers: [defenderId],
                    payload: {
                        type: 'MISSION_CANCELLED',
                        payload: { armyId: defendingArmyId }
                    }
                };
                await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastDef));
            }
        } else {
            army.status = 'in combattimento';
        }
    } catch (e) {
        console.error("Errore in setupCombatFromArrival:", e);
    }
};

module.exports = {
    startCombatLoop,
    setupCombatFromArrival,
    processActiveCombats
};
