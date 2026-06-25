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
        const { getMatch, updateMatch } = require('../../shared/matchMonolithic.js');
        const matchData = await getMatch(matchHashId);
        if (!matchData || !matchData.match || !matchData.match.player) return;
        const nations = matchData.match.player;

        const adjData = await redis.get('map_data:regions_adjacency');
        const adj = adjData ? JSON.parse(adjData) : {};

        // Costruiamo un indice O(1) per lookup per id_territorio
        const adjById = {};
        for (const key in adj) {
            if (adj[key] && adj[key].id) {
                adjById[adj[key].id] = adj[key];
            }
        }

        const client = await db.connect();

        try {
            await client.query('BEGIN');

            for (const nation of nations) {
                const isBot = String(nation.username).includes('_bot');
                
                // Oggetto Redis per questa nazione
                let playerArmies = {};
                let playerTruppe = {};
                
                // UUID per il DB (se utente reale)
                // Al momento della creazione, l'unico utente reale assegnato a una nazione è l'host.
                let realUserId = null;
                if (!isBot) {
                    if (nation.username === hostUsername || nation.username === hostId) {
                        realUserId = hostId;
                    } else {
                        // Se per qualche motivo ci sono altri, proviamo a recuperare l'UUID
                        const userRes = await client.query(`SELECT id_user FROM utenti WHERE username = $1 OR id_user::text = $1`, [nation.username]);
                        if (userRes.rows.length > 0) {
                            realUserId = userRes.rows[0].id_user;
                        }
                    }
                }

                // Generiamo un'armata per ogni territorio
                for (const admin in nation.territori_dict) {
                    for (const prov of nation.territori_dict[admin]) {
                        // Troviamo il territorio nell'indice O(1)
                        let region = adjById[prov] || null;

                        if (!region) continue;

                        const idArmata = randomUUID();
                        const idTruppa = randomUUID();
                        
                        const x = parseFloat(region.lng.toFixed(5));
                        const y = parseFloat(region.lat.toFixed(5));

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

                        const truppaObj = {
                            id: idTruppa,
                            id_armata: idArmata,
                            hp: 1000,
                            type: 'fante'
                        };
                        playerTruppe[idTruppa] = truppaObj;

                        // Salvataggio in Postgres SOLO per i player reali (i bot non esistono in "partecipanti_partite")
                        if (!isBot && realUserId) {
                            await client.query(
                                `INSERT INTO armata (id_istanza_armata, partita_id, user_id, id_modello, x, y, hp_tot, are_they_in_the_same_position, dmg_tot, max_range_atck, speed) 
                                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                                [idArmata, matchIdStr, realUserId, 'fante', x, y, 1000, true, 10, 1, 1]
                            );

                            await client.query(
                                `INSERT INTO truppe (id_istanza_truppa, partita_id, user_id, id_modello, id_armata, x, y, hp) 
                                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                                [idTruppa, matchIdStr, realUserId, 'fante', idArmata, x, y, 1000] // 10 fanti = 1000 hp (assumendo 1 fante = 100 hp)
                            );
                        }
                    }
                }

                // Salva l'oggetto armate nel monolithic JSON
                await updateMatch(matchHashId, async (matchObj) => {
                    if (!matchObj || !matchObj.match) return { save: false };
                    const player = matchObj.match.player.find(p => p.username === nation.username);
                    if (player) {
                        player.armate = playerArmies;
                        player.truppe = playerTruppe;
                        return { save: true, matchObj, data: true };
                    }
                    return { save: false };
                });
            }

            await client.query('COMMIT');
            console.log(`[TROOP_GEN] Generazione iniziale truppe completata per la partita ${matchHashId}`);
            
            // BROADCAST INITIAL TROOPS ALLA FINE DELLA GENERAZIONE
            try {
                const finalMatchData = await getMatch(matchHashId);
                let allArmies = [];
                if (finalMatchData && finalMatchData.match && finalMatchData.match.player) {
                    for (const player of finalMatchData.match.player) {
                        if (player.armate) {
                            const playerArmies = Object.values(player.armate).map(a => ({...a, owner: player.username}));
                            allArmies = allArmies.concat(playerArmies);
                        }
                    }
                }
                const broadcastPayload = {
                   matchId: matchHashId,
                   payload: {
                       type: 'INITIAL_STATE',
                       payload: { armies: allArmies, nations: finalMatchData ? finalMatchData.match.player : [] }
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
    
    const lockAcquired = await redis.set('engine_lock:troopGenerator', 'locked', 'NX', 'PX', 59000);
    if (!lockAcquired) return;
    
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
            
            let armiesToUpdateDB = [];

            const { getMatch, updateMatch } = require('../../shared/matchMonolithic.js');
            const updRes = await updateMatch(matchHashId, (matchObj) => {
                if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false };
                
                armiesToUpdateDB = []; // Reset inside callback in case of retry
                
                for (const player of matchObj.match.player) {
                    const playerId = player.username;
                    const isBot = String(playerId).includes('_bot');
                    
                    if (!player.armate || Object.keys(player.armate).length === 0) continue;
                    
                    for (const armataId in player.armate) {
                        const armata = player.armate[armataId];
                        armata.composition.fante = (armata.composition.fante || 0) + 1;
                        armata.damage = (armata.damage || 0) + 1;
                        
                        if (!isBot) {
                            armiesToUpdateDB.push(armataId);
                        }
                    }
                }
                return { save: true, matchObj, data: true };
            });

            if (updRes && armiesToUpdateDB.length > 0) {
                await client.query('BEGIN');
                try {
                    for (const armataId of armiesToUpdateDB) {
                        await client.query(`
                            UPDATE armata 
                            SET hp_tot = hp_tot + 100, dmg_tot = dmg_tot + 1 
                            WHERE id_istanza_armata = $1
                        `, [armataId]);
                        
                        await client.query(`
                            UPDATE truppe
                            SET hp = hp + 100
                            WHERE id_armata = $1 AND id_modello = 'fante'
                        `, [armataId]);
                    }
                    await client.query('COMMIT');
                } catch (err) {
                    await client.query('ROLLBACK');
                    console.error(`[TROOP_GEN] Errore DB durante update periodico per match ${matchHashId}:`, err);
                }
            }

            // BROADCAST ALLA FINE DEL CICLO PARTITA
            try {
                const finalMatchData = await require('../../shared/matchMonolithic.js').getMatch(matchHashId);
                let allArmies = [];
                if (finalMatchData && finalMatchData.match && finalMatchData.match.player) {
                    for (const player of finalMatchData.match.player) {
                        if (player.armate) {
                            const playerArmies = Object.values(player.armate).map(a => ({...a, owner: player.username}));
                            allArmies = allArmies.concat(playerArmies);
                        }
                    }
                }
                const broadcastPayload = {
                   matchId: matchHashId,
                   payload: {
                       type: 'INITIAL_STATE',
                       payload: { armies: allArmies, nations: finalMatchData ? finalMatchData.match.player : [] }
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
    console.log('[SYSTEM] Avvio cron timer Troop Generator DISABILITATO. Generazione fanti demandata a sync_workers.js');
};

module.exports = { 
    generateInitialTroopsForMatch,
    startTroopGenerator 
};
