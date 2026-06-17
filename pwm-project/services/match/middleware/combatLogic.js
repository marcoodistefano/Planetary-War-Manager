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

            // Calcola danno totale
            let totalDmg = 0;
            if (attackerArmy.composition) {
                for (const [troopId, count] of Object.entries(attackerArmy.composition)) {
                    const stats = getTroopStats(troopId);
                    if (stats) {
                        totalDmg += (stats.danno_base || 0) * count;
                    }
                }
            }

            let combatEnded = false;

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
                let currentHp = defenderArmy.hp || 1000;
                currentHp -= damageToArmy;
                
                if (currentHp <= 0) {
                    // Distruggi armata
                    const defStr = await redis.get(defenderRedisKey);
                    const defObj = JSON.parse(defStr);
                    delete defObj[id_target_armata];
                    await redis.set(defenderRedisKey, JSON.stringify(defObj));
                    await db.query(`DELETE FROM mosse WHERE id_armata = $1`, [id_target_armata]);
                    // Se c'è solo l'armata, il combattimento finisce. Se c'è anche la città, prosegue solo contro la città.
                    if (!id_target_citta) combatEnded = true;
                } else {
                    defenderArmy.hp = currentHp;
                    const defStr = await redis.get(defenderRedisKey);
                    const defObj = JSON.parse(defStr);
                    defObj[id_target_armata] = defenderArmy;
                    await redis.set(defenderRedisKey, JSON.stringify(defObj));
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
                    
                    // L'armata attaccante entra in idle
                    const attStr = await redis.get(attackerRedisKey);
                    const attObj = JSON.parse(attStr);
                    attObj[id_attaccante].status = 'idle';
                    await redis.set(attackerRedisKey, JSON.stringify(attObj));
                } else {
                    await redis.set(cityHpKey, cityHp.toString());
                }
            }

            // 3. Aggiorna stato o programma prossimo turno
            if (combatEnded) {
                await db.query(`UPDATE attacco SET status = 'ended' WHERE id_attacco = $1`, [id_attacco]);
                await db.query(`DELETE FROM mosse WHERE id_mossa = $1`, [id_mossa]);
            } else {
                await db.query(`UPDATE attacco SET next_round_time = NOW() + INTERVAL '15 minutes' WHERE id_attacco = $1`, [id_attacco]);
                await db.query(`UPDATE mosse SET ttl = NOW() + INTERVAL '15 minutes' WHERE id_mossa = $1`, [id_mossa]);
            }
        }
    } catch (e) {
        console.error("Errore processActiveCombats:", e);
    }
};

const startCombatLoop = () => {
    console.log("[SYSTEM] Avvio Combat Loop (interval 1m)");
    setInterval(processActiveCombats, 60000); // Esegue il check ogni minuto
    setInterval(resolveMovements, 15000); // Check movimenti ogni 15s
};

const resolveMovements = async () => {
    try {
        const res = await db.query(`
            SELECT m.id_mossa, m.id_armata, m.user_id, m.partita_id, m.ttl, s.x_dest, s.y_dest, s.target_node, p.id_partita_hash
            FROM mosse m
            JOIN spostamenti s ON m.id_mossa = s.id_mossa
            JOIN partite p ON m.partita_id = p.id_partita
            WHERE m.type_action = 'mov' AND m.ttl <= NOW()
        `);

        for (const mossa of res.rows) {
            const { id_mossa, id_armata, id_partita_hash, user_id, target_node, x_dest, y_dest } = mossa;
            
            // Trova l'armata in Redis
            const keys = await redis.keys(`match:${id_partita_hash}:player:*:armate`);
            let army = null;
            let redisKey = null;
            let attackerUsername = null;

            for (const key of keys) {
                const armateStr = await redis.get(key);
                if (armateStr) {
                    const armateObj = JSON.parse(armateStr);
                    if (armateObj[id_armata]) {
                        army = armateObj[id_armata];
                        redisKey = key;
                        attackerUsername = key.split(':')[3];
                        break;
                    }
                }
            }

            if (!army) {
                await db.query(`DELETE FROM mosse WHERE id_mossa = $1`, [id_mossa]);
                continue;
            }

            if (army.status === 'moving_to_border' || army.status === "Pronto all'attacco") {
                // Notifica e Guerra
                const nationsCache = await redis.get(`match:${id_partita_hash}:nations`);
                let defenderId = null;
                if (nationsCache) {
                    const nations = JSON.parse(nationsCache);
                    const targetNation = nations.find(n => n.territories_flat && n.territories_flat.includes(target_node));
                    if (targetNation && targetNation.playerId) {
                        defenderId = targetNation.playerId;
                        // Imposta inWar (Semplificazione)
                        targetNation.inWar = true;
                        
                        const attackerNation = nations.find(n => n.playerId === attackerUsername);
                        if (attackerNation) attackerNation.inWar = true;
                        
                        await redis.set(`match:${id_partita_hash}:nations`, JSON.stringify(nations));
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

                    // Trova se c'è un'armata nemica a difesa di target_node
                    let defendingArmyId = null;
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

                    // Aggiorna la mossa originale
                    await db.query(`UPDATE mosse SET type_action = 'atk', ttl = NOW() + INTERVAL '15 minutes' WHERE id_mossa = $1`, [id_mossa]);

                    // Inserisci in attacco
                    await db.query(`
                        INSERT INTO attacco (id_mossa, partita_id, id_attaccante, id_target_citta, id_target_armata, next_round_time)
                        VALUES ($1, $2, $3, $4, $5, NOW())
                    `, [id_mossa, mossa.partita_id, id_armata, target_node, defendingArmyId]);
                }

                army.status = 'in combattimento';
                army.currentLocation = `${x_dest},${y_dest}`;
            } else {
                army.status = 'idle';
                army.currentLocation = `${x_dest},${y_dest}`;
                await db.query(`DELETE FROM mosse WHERE id_mossa = $1`, [id_mossa]);
            }

            const armateStr = await redis.get(redisKey);
            const armateObj = JSON.parse(armateStr);
            armateObj[id_armata] = army;
            await redis.set(redisKey, JSON.stringify(armateObj));

            await db.query(`DELETE FROM spostamenti WHERE id_mossa = $1`, [id_mossa]);
        }
    } catch (e) {
        console.error("Errore resolveMovements:", e);
    }
};

module.exports = {
    startCombatLoop
};
