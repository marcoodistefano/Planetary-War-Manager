const db = require('../../shared/postgresClient');
const redis = require('../../shared/redisClient');
const { randomUUID } = require('crypto');
const Eru = require('./Eru.js');

let isRunning = false;

/**
 * Genera 10 fanti per ogni territorio di tutte le nazioni (reali e bot)
 */
const generateInitialTroopsForMatch = async (matchHashId, matchIdStr, hostId, hostUsername) => {
    try {
        const nationsCache = await redis.get(`match:${matchHashId}:nations`);
        if (!nationsCache) return;
        const nations = JSON.parse(nationsCache);

        const adjData = await redis.get('map_data:regions_adjacency');
        const adj = adjData ? JSON.parse(adjData) : {};

        const client = await db.connect();

        try {
            await client.query('BEGIN');

            for (const nation of nations) {
                const isBot = String(nation.playerId).includes('_bot');
                
                // Oggetto Redis per questa nazione
                let playerArmies = {};
                
                // UUID per il DB (se utente reale)
                // Al momento della creazione, l'unico utente reale assegnato a una nazione è l'host.
                let realUserId = null;
                if (!isBot) {
                    if (nation.playerId === hostUsername || nation.playerId === hostId) {
                        realUserId = hostId;
                    } else {
                        // Se per qualche motivo ci sono altri, proviamo a recuperare l'UUID
                        const userRes = await client.query(`SELECT id_user FROM utenti WHERE username = $1 OR id_user::text = $1`, [nation.playerId]);
                        if (userRes.rows.length > 0) {
                            realUserId = userRes.rows[0].id_user;
                        }
                    }
                }

                // Generiamo un'armata per ogni territorio
                for (const admin in nation.territories) {
                    for (const prov of nation.territories[admin]) {
                        // Troviamo il territorio in adj (prov è l'ID testuale o index?)
                        // nation.territories contiene un array di adj[idx].id. Per trovare lat e lng cerchiamo nell'object adj
                        let region = null;
                        for (const key in adj) {
                            if (adj[key].id === prov) {
                                region = adj[key];
                                break;
                            }
                        }

                        if (!region) continue;

                        const idArmata = randomUUID();
                        const idTruppa = randomUUID();
                        
                        const x = parseFloat(region.lng.toFixed(3));
                        const y = parseFloat(region.lat.toFixed(3));

                        const armyObj = {
                            id: idArmata,
                            name: `Guarnigione ${region.name || prov} ${idArmata.substring(0, 4)}`,
                            composition: { fante: 10 },
                            status: 'standby',
                            currentLocation: { x, y },
                            targetCoords: null,
                            damage: 10,
                            range: 1,
                            speed: 1,
                            are_they_in_the_same_position: true,
                            truppeIds: [idTruppa] // Teniamo traccia delle truppe per comodità
                        };

                        playerArmies[idArmata] = armyObj;

                        // Salvataggio in Postgres SOLO per i player reali (i bot non esistono in "partecipanti_partite")
                        if (!isBot && realUserId) {
                            await client.query(
                                `INSERT INTO armata (id_istanza_armata, partita_id, user_id, x, y, hp_tot, are_they_in_the_same_position, dmg_tot, max_range_atck, speed) 
                                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                                [idArmata, matchIdStr, realUserId, x, y, 1000, true, 10, 1, 1]
                            );

                            await client.query(
                                `INSERT INTO truppe (id_istanza_truppa, partita_id, user_id, id_modello, id_armata, x, y, hp) 
                                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                                [idTruppa, matchIdStr, realUserId, 'fante', idArmata, x, y, 1000] // 10 fanti = 1000 hp (assumendo 1 fante = 100 hp)
                            );
                        }
                    }
                }

                // Salva l'oggetto armate in Redis
                const redisKey = `match:${matchHashId}:player:${nation.playerId}:armate`;
                await redis.set(redisKey, JSON.stringify(playerArmies));
            }

            await client.query('COMMIT');
            console.log(`[TROOP_GEN] Generazione iniziale truppe completata per la partita ${matchHashId}`);
            
            // BROADCAST INITIAL TROOPS ALLA FINE DELLA GENERAZIONE
            try {
                const keys = await redis.keys(`match:${matchHashId}:player:*:armate`);
                let allArmies = [];
                for (const key of keys) {
                    const armateStr = await redis.get(key);
                    if (armateStr) {
                       const playerId = key.split(':')[3];
                       const armateObj = JSON.parse(armateStr);
                       const playerArmies = Object.values(armateObj).map(a => ({...a, owner: playerId}));
                       allArmies = allArmies.concat(playerArmies);
                    }
                }
                const broadcastPayload = {
                   matchId: matchHashId,
                   payload: {
                       type: 'INITIAL_STATE',
                       payload: { armies: allArmies, nations }
                   }
                };
                await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
            } catch(bcastErr) {
                console.error(`[TROOP_GEN] Errore broadcast:`, bcastErr);
            }
            
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(`[TROOP_GEN] Errore DB durante generazione iniziale truppe:`, err);
        } finally {
            client.release();
        }
    } catch (e) {
        console.error(`[TROOP_GEN] Errore critico generazione iniziale truppe:`, e);
    }
};

/**
 * Generazione periodica ("una tantum") di 1 fante per ogni provincia
 */
const generateTroopsPeriodic = async () => {
    if (isRunning) return;
    isRunning = true;

    const client = await db.connect();
    
    try {
        // Recupera tutte le partite IN CORSO
        const matchesRes = await client.query(`
            SELECT id_partita, id_partita_hash, id_partita_visualizzato, struttura_partita::text AS struct
            FROM partite
            WHERE substring(struttura_partita::text from 1 for 2) = '01'
        `);

        for (const match of matchesRes.rows) {
            const matchId = match.id_partita;
            const matchHashId = match.id_partita_hash;
            
            // Estrae il moltiplicatore dalla struttura (default a 1 se errore)
            const decoded = Eru.decode_match(match.struct);
            let multiplier = parseFloat(decoded.moltiplicatore?.replace('x', '')) || 1;
            
            // In un gioco reale dovremmo calcolare se è passato "intervallo_periodico / multiplier".
            // Poiché questo cron gira ogni N minuti, per ora lo usiamo come "trigger base" 
            // ma con un throttle per evitare spam se gira troppo spesso.
            // Per soddisfare il requisito in modo semplice, assumiamo che quando gira questa funzione, 
            // sia il momento di aggiungere 1 truppa (100 hp) alle armate esistenti, limitando la frequenza nel timer.
            
            // 1. Recupero tutte le chiavi armate della partita in Redis
            const keys = await redis.keys(`match:${matchHashId}:player:*:armate`);
            
            for (const key of keys) {
                // key = match:HASH:player:playerId:armate
                const parts = key.split(':');
                const playerId = parts[3];
                const isBot = String(playerId).includes('_bot');
                
                const armateStr = await redis.get(key);
                if (!armateStr) continue;
                
                let playerArmies = JSON.parse(armateStr);
                let realUserId = null;
                
                if (!isBot) {
                    const userRes = await client.query(`SELECT id_user FROM utenti WHERE username = $1 OR id_user::text = $1 LIMIT 1`, [playerId]);
                    if (userRes.rows.length > 0) {
                        realUserId = userRes.rows[0].id_user;
                    }
                }

                await client.query('BEGIN');
                try {
                    for (const armataId in playerArmies) {
                        const armata = playerArmies[armataId];
                        // Aggiunge 1 fante (incrementa composizione, hp e danno approssimativamente)
                        armata.composition.fante = (armata.composition.fante || 0) + 1;
                        armata.damage = (armata.damage || 0) + 1; // +1 danno per truppa
                        
                        if (!isBot && realUserId) {
                            // Aggiorna l'hp dell'armata nel DB (aggiungiamo 100 hp per un fante)
                            await client.query(`
                                UPDATE armata 
                                SET hp_tot = hp_tot + 100, dmg_tot = dmg_tot + 1 
                                WHERE id_istanza_armata = $1
                            `, [armataId]);
                            
                            // Aggiorniamo anche le truppe associate. 
                            // O inseriamo una nuova truppa "fante" oppure ne incrementiamo l'HP.
                            // Per semplicità, incrementiamo l'HP della prima truppa associata a questa armata.
                            await client.query(`
                                UPDATE truppe
                                SET hp = hp + 100
                                WHERE id_armata = $1 AND id_modello = 'fante'
                            `, [armataId]);
                        }
                    }
                    
                    // Salva in Redis
                    await redis.set(key, JSON.stringify(playerArmies));
                    await client.query('COMMIT');
                } catch (err) {
                    await client.query('ROLLBACK');
                    console.error(`[TROOP_GEN] Errore DB durante update periodico per match ${matchHashId}:`, err);
                }
            }

            // BROADCAST ALLA FINE DEL CICLO PARTITA
            try {
                let allArmies = [];
                for (const key of keys) {
                    const armateStr = await redis.get(key);
                    if (armateStr) {
                       const playerId = key.split(':')[3];
                       const armateObj = JSON.parse(armateStr);
                       const playerArmies = Object.values(armateObj).map(a => ({...a, owner: playerId}));
                       allArmies = allArmies.concat(playerArmies);
                    }
                }
                const nationsStr = await redis.get(`match:${matchHashId}:nations`);
                const nations = nationsStr ? JSON.parse(nationsStr) : [];
                
                const broadcastPayload = {
                   matchId: matchHashId,
                   payload: {
                       type: 'INITIAL_STATE',
                       payload: { armies: allArmies, nations }
                   }
                };
                await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
            } catch(bcastErr) {
                console.error(`[TROOP_GEN] Errore broadcast:`, bcastErr);
            }
        }
    } catch (e) {
        console.error('[TROOP_GEN] Errore critico:', e);
    } finally {
        client.release();
        isRunning = false;
    }
};

const startTroopGenerator = () => {
    console.log('[SYSTEM] Avvio cron timer Troop Generator');
    // Esempio: esegue ogni ora / moltiplicatore. In locale usiamo 5 minuti per test.
    // L'utente vuole un intervallo_periodico / moltiplicatore. 
    // Attualmente impostiamo a 1 minuto per testing (60000ms)
    setInterval(generateTroopsPeriodic, 60000); 
};

module.exports = { 
    generateInitialTroopsForMatch,
    startTroopGenerator 
};
