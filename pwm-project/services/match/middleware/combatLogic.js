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
    
    let currentHp = army.hp !== undefined ? army.hp : totalMaxHp;
    currentHp -= damage;
    
    if (currentHp <= 0) {
        army.hp = 0;
        army.composition = {};
        return true; // died
    }
    
    army.hp = currentHp;
    const survivalRatio = currentHp / totalMaxHp;
    for (const [troopId, count] of Object.entries(army.composition)) {
        if (count > 0) {
            army.composition[troopId] = Math.ceil(count * survivalRatio);
        }
    }
    return false; // survived
};

const getMatchMultiplier = async (id_partita_hash) => {
    let multiplier = 1;
    try {
        const matchDataRaw = await redis.get(`match:${id_partita_hash}`);
        if (matchDataRaw) {
            const matchObj = JSON.parse(matchDataRaw);
            if (matchObj.struttura_partita) {
                const Eru = require('./Eru.js');
                const decodedMatch = Eru.decode_match(matchObj.struttura_partita);
                multiplier = decodedMatch.multiplierValue || 1;
            }
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
        // Prendi tutti i combattimenti attivi dove il next_round è passato
        const res = await db.query(`
            SELECT c.*, p.id_partita_hash 
            FROM attacco c
            JOIN partite p ON c.partita_id = p.id_partita
            WHERE status = 'active' AND next_round_time <= NOW()
        `);
        
        for (const combat of res.rows) {
            const { id_attacco, id_mossa, id_attaccante, id_target_armata, id_target_citta, id_partita_hash, partita_id } = combat;
            
            // 1. Trova l'armata attaccante
            // L'attaccante potrebbe essere ovunque nel dizionario di armate
            const keys = await redis.keys(`match:${id_partita_hash}:player:*:armate`);
            let attackerArmy = null;
            let attackerPlayer = null;
            let attackerRedisKey = null;

            for (const key of keys) {
                const armateStr = await redis.get(key);
                if (armateStr) {
                    const armateObj = JSON.parse(armateStr);
                    if (armateObj[id_attaccante]) {
                        attackerArmy = armateObj[id_attaccante];
                        attackerPlayer = key.split(':')[3];
                        attackerRedisKey = key;
                        break;
                    }
                }
            }

            if (!attackerArmy) {
                // L'attaccante non esiste più
                await db.query(`UPDATE attacco SET status = 'ended' WHERE id_attacco = $1`, [id_attacco]);
                continue;
            }

            // Calcola danno totale dell'attaccante
            let totalDmg = calculateArmyDamage(attackerArmy);
            let combatEnded = false;
            let attackerDied = false;

            // 2. Trova il bersaglio e applica danno
            let damageToArmy = 0;
            let damageToCity = 0;
            let defenderArmy = null;
            let defenderRedisKey = null;

            if (id_target_armata) {
                for (const key of keys) {
                    const armateStr = await redis.get(key);
                    if (armateStr) {
                        const armateObj = JSON.parse(armateStr);
                        if (armateObj[id_target_armata]) {
                            defenderArmy = armateObj[id_target_armata];
                            defenderRedisKey = key;
                            break;
                        }
                    }
                }
            }

            if (id_target_armata && defenderArmy) {
                 damageToArmy = totalDmg;
                 damageToCity = 0;
            } else if (id_target_citta) {
                 damageToCity = totalDmg;
            }

            if (damageToArmy > 0 && defenderArmy) {
                const oldDefenderComposition = JSON.parse(JSON.stringify(defenderArmy.composition));
                const defenderDied = applyDamageToArmy(defenderArmy, damageToArmy);
                
                const defenderPlayer = defenderRedisKey.split(':')[3];
                const defenderName = defenderArmy.name || 'Armata nemica';
                const attackerName = attackerArmy.name || 'La tua armata';

                if (defenderDied) {
                    // Distruggi armata difensore
                    const defStr = await redis.get(defenderRedisKey);
                    const defObj = JSON.parse(defStr);
                    
                    await addToGraveyard(id_partita_hash, defenderPlayer, defObj[id_target_armata], attackerPlayer);
                    
                    delete defObj[id_target_armata];
                    await redis.set(defenderRedisKey, JSON.stringify(defObj));
                    await db.query(`DELETE FROM mosse WHERE id_armata = $1`, [id_target_armata]);
                    
                    await emitCombatEvent(id_partita_hash, attackerName, defenderName, damageToArmy, 'distrutta', [attackerPlayer, defenderPlayer]);
                    
                    // Se c'è solo l'armata, il combattimento finisce. Se c'è anche la città, prosegue solo contro la città.
                    if (!id_target_citta) combatEnded = true;
                } else {
                    // Difensore sopravvive, aggiorniamo il suo stato
                    const defStr = await redis.get(defenderRedisKey);
                    const defObj = JSON.parse(defStr);
                    
                    const multiplier = await getMatchMultiplier(id_partita_hash);
                    const intervalMs = Math.max(1000, Math.floor((15 * 60000) / multiplier));
                    const newNextRoundDate = new Date(Date.now() + intervalMs);
                    
                    defObj[id_target_armata] = defenderArmy;
                    defObj[id_target_armata].next_round_time = newNextRoundDate.toISOString();
                    await redis.set(defenderRedisKey, JSON.stringify(defObj));
                    
                    // Aggiungi perdite parziali al cimitero
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
                    
                    // FASE 2: CONTRATTACCO DEL DIFENSORE
                    const oldAttackerComposition = JSON.parse(JSON.stringify(attackerArmy.composition));
                    let counterDmg = calculateArmyDamage(defenderArmy);
                    attackerDied = applyDamageToArmy(attackerArmy, counterDmg);
                    
                    const attStr = await redis.get(attackerRedisKey);
                    const attObj = JSON.parse(attStr);
                    if (attackerDied) {
                        await addToGraveyard(id_partita_hash, attackerPlayer, attObj[id_attaccante], defenderPlayer);
                        delete attObj[id_attaccante];
                        await db.query(`DELETE FROM mosse WHERE id_armata = $1`, [id_attaccante]);
                        combatEnded = true; // L'attaccante è morto
                        await emitCombatEvent(id_partita_hash, defenderName, attackerName, counterDmg, 'distrutta', [attackerPlayer, defenderPlayer]);
                    } else {
                        // Aggiungi perdite parziali al cimitero
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

                        attObj[id_attaccante] = attackerArmy;
                        attObj[id_attaccante].next_round_time = newNextRoundDate.toISOString();
                        await emitCombatEvent(id_partita_hash, attackerName, defenderName, damageToArmy, 'sopravvissuta', [attackerPlayer, defenderPlayer]);
                    }
                    await redis.set(attackerRedisKey, JSON.stringify(attObj));
                }
            } else if (id_target_armata && !id_target_citta) {
                // L'armata bersaglio non esiste più e non c'è una città
                combatEnded = true;
            }

            if (damageToCity > 0 && id_target_citta) {
                const cityHpKey = `match:${id_partita_hash}:city_hp:${id_target_citta}`;
                let cityHp = await redis.get(cityHpKey);
                cityHp = cityHp ? parseInt(cityHp, 10) : 1000; // 1000 base hp
                cityHp -= damageToCity;

                if (cityHp <= 0) {
                    combatEnded = true;
                    await redis.del(cityHpKey);
                    
                    // Conquista
                    const nationsCache = await redis.get(`match:${id_partita_hash}:nations`);
                    let updatedNations = [];
                    if (nationsCache) {
                        const { getRegionForNode } = require('./movementLogic.js');
                        const regionId = getRegionForNode(id_target_citta) || id_target_citta;

                        const nations = JSON.parse(nationsCache);
                        for (let n of nations) {
                            if (n.territories_flat && n.territories_flat.includes(regionId)) {
                                n.playerId = attackerPlayer;
                                n.isOccupied = true;
                                break;
                            }
                        }
                        updatedNations = nations;
                        await redis.set(`match:${id_partita_hash}:nations`, JSON.stringify(nations));
                    }
                    
                    const broadcastPayload = {
                        matchId: id_partita_hash,
                        payload: {
                            type: 'TERRITORY_CONQUERED',
                            nations: updatedNations
                        }
                    };
                    await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
                    
                    // L'armata attaccante entra in idle (se è sopravvissuta)
                    if (!attackerDied) {
                        const attStr = await redis.get(attackerRedisKey);
                        if (attStr) {
                            const attObj = JSON.parse(attStr);
                            if (attObj[id_attaccante]) {
                                attObj[id_attaccante].status = 'standby';
                                await redis.set(attackerRedisKey, JSON.stringify(attObj));
                            }
                        }
                    }
                } else {
                    await redis.set(cityHpKey, cityHp.toString());
                }
            }
            
            // 3. Aggiorna stato o programma prossimo turno
            if (combatEnded) {
                await db.query(`UPDATE attacco SET status = 'ended' WHERE id_attacco = $1`, [id_attacco]);
                await db.query(`DELETE FROM mosse WHERE id_mossa = $1`, [id_mossa]);
                
                // Rimettiamo in standby l'attaccante se non è morto
                if (!attackerDied) {
                    const attStr = await redis.get(attackerRedisKey);
                    if (attStr) {
                        const attObj = JSON.parse(attStr);
                        if (attObj[id_attaccante]) {
                            attObj[id_attaccante].status = 'standby';
                            await redis.set(attackerRedisKey, JSON.stringify(attObj));
                        }
                    }
                }
            } else {
                const multiplier = await getMatchMultiplier(id_partita_hash);
                const intervalMs = Math.max(1000, Math.floor((15 * 60000) / multiplier));
                const newNextRoundDate = new Date(Date.now() + intervalMs);
                const newNextRound = newNextRoundDate.toISOString();

                await db.query(`UPDATE attacco SET next_round_time = $1 WHERE id_attacco = $2`, [newNextRoundDate, id_attacco]);
                
                // Aggiorna next_round_time su Redis
                if (!attackerDied) {
                    const attStr = await redis.get(attackerRedisKey);
                    if (attStr) {
                        const attObj = JSON.parse(attStr);
                        if (attObj[id_attaccante]) {
                            attObj[id_attaccante].next_round_time = newNextRound;
                            await redis.set(attackerRedisKey, JSON.stringify(attObj));
                        }
                    }
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

const setupCombatFromArrival = async (army, mossa, id_partita_hash, attackerUsername) => {
    try {
        const { id_mossa, id_armata, target_node, x_dest, y_dest } = mossa;

        // Notifica e Guerra
        const nationsCache = await redis.get(`match:${id_partita_hash}:nations`);
        let defenderId = null;
        let isArmyTarget = false;
        
        if (nationsCache) {
            const { getRegionForNode } = require('./movementLogic.js');
            const regionId = getRegionForNode(target_node) || target_node;

            const nations = JSON.parse(nationsCache);
            let targetNation = nations.find(n => n.territories_flat && n.territories_flat.includes(regionId));
            
            if (targetNation && targetNation.playerId) {
                defenderId = targetNation.playerId;
                targetNation.inWarWith = targetNation.inWarWith || [];
                if (!targetNation.inWarWith.includes(attackerUsername)) targetNation.inWarWith.push(attackerUsername);
                
                const attackerNation = nations.find(n => n.playerId === attackerUsername);
                if (attackerNation) {
                    attackerNation.inWarWith = attackerNation.inWarWith || [];
                    if (!attackerNation.inWarWith.includes(defenderId)) attackerNation.inWarWith.push(defenderId);
                }
                await redis.set(`match:${id_partita_hash}:nations`, JSON.stringify(nations));
            } else {
                // Potrebbe essere un attacco a un'armata
                const allArmiesKeys = await redis.keys(`match:${id_partita_hash}:player:*:armate`);
                for (const k of allArmiesKeys) {
                    const ownerUsername = k.split(':')[3];
                    if (ownerUsername === attackerUsername) continue;
                    const data = await redis.get(k);
                    if (data) {
                        const armate = JSON.parse(data);
                        if (armate[target_node]) {
                            defenderId = ownerUsername;
                            isArmyTarget = true;
                            // Imposta guerra
                            const enemyNation = nations.find(n => n.playerId === ownerUsername);
                            const attackerNation = nations.find(n => n.playerId === attackerUsername);
                            if (enemyNation) {
                                enemyNation.inWarWith = enemyNation.inWarWith || [];
                                if (!enemyNation.inWarWith.includes(attackerUsername)) enemyNation.inWarWith.push(attackerUsername);
                            }
                            if (attackerNation) {
                                attackerNation.inWarWith = attackerNation.inWarWith || [];
                                if (!attackerNation.inWarWith.includes(ownerUsername)) attackerNation.inWarWith.push(ownerUsername);
                            }
                            await redis.set(`match:${id_partita_hash}:nations`, JSON.stringify(nations));
                            break;
                        }
                    }
                }
            }
        }

        if (defenderId) {
            // Notifica ai player
            const nationsCacheUpdated = await redis.get(`match:${id_partita_hash}:nations`);
            const updatedNations = nationsCacheUpdated ? JSON.parse(nationsCacheUpdated) : [];

            const broadcastPayload = {
                matchId: id_partita_hash,
                payload: {
                    type: 'WAR_DECLARED',
                    data: { attacker: attackerUsername, defender: defenderId },
                    nations: updatedNations
                }
            };
            await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));

            // Trova se c'è un'armata nemica a difesa di target_node (o se il target è l'armata stessa)
            let defendingArmyId = null;
            if (isArmyTarget) {
                defendingArmyId = target_node;
            } else {
                const { getNodeCoords } = require('./movementLogic.js');
                const cityCoords = getNodeCoords(target_node);
                const allArmiesKeys = await redis.keys(`match:${id_partita_hash}:player:*:armate`);
                for (const k of allArmiesKeys) {
                    const ownerUsername = k.split(':')[3];
                    if (ownerUsername === attackerUsername) continue;
                    
                    const data = await redis.get(k);
                    if (data) {
                        const defArmies = JSON.parse(data);
                        for (const [defId, defArmy] of Object.entries(defArmies)) {
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

            // Controlla se l'attacco esiste già
            const checkAttacco = await db.query(`SELECT id_attacco FROM attacco WHERE id_mossa = $1`, [id_mossa]);
            const multiplier = await getMatchMultiplier(id_partita_hash);
            const intervalMs = Math.max(1000, Math.floor((15 * 60000) / multiplier));
            const newNextRoundDate = new Date(Date.now() + intervalMs);

            if (checkAttacco.rows.length === 0) {
                // Aggiorna la mossa originale
                await db.query(`UPDATE mosse SET type_action = 'atk', ttl = $1 WHERE id_mossa = $2`, [newNextRoundDate, id_mossa]);

                // Inserisci in attacco
            // Se il target è un'armata specificata ESPLICITAMENTE dall'utente, NON bersagliamo la città.
            // Altrimenti (assedio a una nazione), bersagliamo SEMPRE la città, ma grazie alla logica in processActiveCombats, 
            // il danno alla città sarà 0 finché defendingArmyId è in vita.
            let cityTarget = isArmyTarget ? null : target_node;
            await db.query(`
                INSERT INTO attacco (id_mossa, partita_id, id_attaccante, id_target_citta, id_target_armata, next_round_time)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [id_mossa, mossa.partita_id, id_armata, cityTarget, defendingArmyId, newNextRoundDate]);
                
                army.status = 'in combattimento';
                army.currentLocation = `${x_dest},${y_dest}`;
                army.next_round_time = newNextRoundDate.toISOString();
            } else {
                army.status = 'in combattimento';
                // La data del prossimo round è già nel DB, quindi potremmo caricarla o semplicemente aspettare che il loop lo aggiorni
            }
        } else {
            const multiplier = await getMatchMultiplier(id_partita_hash);
            const intervalMs = Math.max(1000, Math.floor((15 * 60000) / multiplier));
            army.status = 'in combattimento';
            army.currentLocation = `${x_dest},${y_dest}`;
            army.next_round_time = new Date(Date.now() + intervalMs).toISOString();
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
