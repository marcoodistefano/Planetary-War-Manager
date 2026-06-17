const db = require('../../shared/postgresClient.js');
const redis = require('../../shared/redisClient.js');
const fs = require('fs');
const path = require('path');

// Carica le regole dal cdb
let gameRules = null;
const loadGameRules = () => {
    if (gameRules) return gameRules;
    const rulesPath = path.join(__dirname, '../../../../game_rules.cdb');
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
                 if (id_target_citta) {
                     damageToArmy = Math.floor(totalDmg * 0.66);
                     damageToCity = totalDmg - damageToArmy;
                 } else {
                     damageToArmy = totalDmg;
                 }
            } else if (id_target_citta) {
                 damageToCity = totalDmg;
            }

            if (damageToArmy > 0 && defenderArmy) {
                const defenderDied = applyDamageToArmy(defenderArmy, damageToArmy);
                
                if (defenderDied) {
                    // Distruggi armata difensore
                    const defStr = await redis.get(defenderRedisKey);
                    const defObj = JSON.parse(defStr);
                    delete defObj[id_target_armata];
                    await redis.set(defenderRedisKey, JSON.stringify(defObj));
                    await db.query(`DELETE FROM mosse WHERE id_armata = $1`, [id_target_armata]);
                    
                    // Se c'è solo l'armata, il combattimento finisce. Se c'è anche la città, prosegue solo contro la città.
                    if (!id_target_citta) combatEnded = true;
                } else {
                    // Difensore sopravvive, aggiorniamo il suo stato
                    const defStr = await redis.get(defenderRedisKey);
                    const defObj = JSON.parse(defStr);
                    defObj[id_target_armata] = defenderArmy;
                    await redis.set(defenderRedisKey, JSON.stringify(defObj));
                    
                    // FASE 2: CONTRATTACCO DEL DIFENSORE
                    let counterDmg = calculateArmyDamage(defenderArmy);
                    attackerDied = applyDamageToArmy(attackerArmy, counterDmg);
                    
                    const attStr = await redis.get(attackerRedisKey);
                    const attObj = JSON.parse(attStr);
                    if (attackerDied) {
                        delete attObj[id_attaccante];
                        await db.query(`DELETE FROM mosse WHERE id_armata = $1`, [id_attaccante]);
                        combatEnded = true; // L'attaccante è morto
                    } else {
                        attObj[id_attaccante] = attackerArmy;
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
                        const nations = JSON.parse(nationsCache);
                        for (let n of nations) {
                            if (n.territories_flat && n.territories_flat.includes(id_target_citta)) {
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
                await db.query(`UPDATE attacco SET next_round_time = NOW() + INTERVAL '15 minutes' WHERE id_attacco = $1`, [id_attacco]);
                
                // Aggiorna next_round_time su Redis
                if (!attackerDied) {
                    const attStr = await redis.get(attackerRedisKey);
                    if (attStr) {
                        const attObj = JSON.parse(attStr);
                        if (attObj[id_attaccante]) {
                            const newNextRound = new Date(Date.now() + 15 * 60000).toISOString();
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
    console.log("[SYSTEM] Avvio Combat Loop (interval 1m)");
    setInterval(processActiveCombats, 60000); // Esegue il check ogni minuto
};

const setupCombatFromArrival = async (army, mossa, id_partita_hash, attackerUsername) => {
    try {
        const { id_mossa, id_armata, target_node, x_dest, y_dest } = mossa;

        // Notifica e Guerra
        const nationsCache = await redis.get(`match:${id_partita_hash}:nations`);
        let defenderId = null;
        let isArmyTarget = false;
        
        if (nationsCache) {
            const nations = JSON.parse(nationsCache);
            let targetNation = nations.find(n => n.territories_flat && n.territories_flat.includes(target_node));
            
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
                const defenderArmiesStr = await redis.get(`match:${id_partita_hash}:player:${defenderId}:armate`);
                if (defenderArmiesStr) {
                    const defArmies = JSON.parse(defenderArmiesStr);
                    for (const [defId, defArmy] of Object.entries(defArmies)) {
                        if (defArmy.currentLocation === target_node || defArmy.targetName === target_node) {
                            defendingArmyId = defId;
                            break;
                        }
                    }
                }
            }

            // Controlla se l'attacco esiste già
            const checkAttacco = await db.query(`SELECT id_attacco FROM attacco WHERE id_mossa = $1`, [id_mossa]);
            if (checkAttacco.rows.length === 0) {
                // Aggiorna la mossa originale
                await db.query(`UPDATE mosse SET type_action = 'atk', ttl = NOW() + INTERVAL '15 minutes' WHERE id_mossa = $1`, [id_mossa]);

                // Inserisci in attacco
            let cityTarget = isArmyTarget ? null : target_node;
            await db.query(`
                INSERT INTO attacco (id_mossa, partita_id, id_attaccante, id_target_citta, id_target_armata, next_round_time)
                VALUES ($1, $2, $3, $4, $5, NOW())
            `, [id_mossa, mossa.partita_id, id_armata, cityTarget, defendingArmyId]);
                
                army.status = 'in combattimento';
                army.currentLocation = `${x_dest},${y_dest}`;
                army.next_round_time = new Date(Date.now() + 15 * 60000).toISOString();
            } else {
                army.status = 'in combattimento';
                // La data del prossimo round è già nel DB, quindi potremmo caricarla o semplicemente aspettare che il loop lo aggiorni
            }
        } else {
            army.status = 'in combattimento';
            army.currentLocation = `${x_dest},${y_dest}`;
            army.next_round_time = new Date(Date.now() + 15 * 60000).toISOString();
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
