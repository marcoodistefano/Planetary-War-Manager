const db = require('../shared/postgresClient');
const redis = require('../shared/redisClient');
const { randomUUID } = require('crypto');

const PALERMO_COORDS = { x: 13.348081, y: 38.126969 };

// Implementiamo un sistema a coda per differire il carico
let isRunning = false;

const generateTroopForAntopintus = async () => {
    if (isRunning) return;
    isRunning = true;

    console.log('[TROOP_GEN] Avvio generazione truppe programmata...');
    const client = await db.connect();
    
    try {
        // 1. Recupero ID di antopintus
        const userRes = await client.query(`SELECT id_user FROM utenti WHERE username = $1`, ['antopintus']);
        if (userRes.rows.length === 0) {
            console.log('[TROOP_GEN] Utente antopintus non trovato. Salto...');
            return;
        }
        const userId = userRes.rows[0].id_user;

        // 2. Trovo in quali partite è coinvolto con anche l'id visualizzato
        const partiteRes = await client.query(`
            SELECT pp.partita_id, p.id_partita_visualizzato, p.id_partita_hash
            FROM partecipanti_partite pp
            JOIN partite p ON pp.partita_id = p.id_partita
            WHERE pp.user_id = $1
        `, [userId]);
        const partite = partiteRes.rows;

        if (partite.length === 0) {
            console.log('[TROOP_GEN] antopintus non è in nessuna partita. Salto...');
            return;
        }

        // Processiamo le partite sequenzialmente con un piccolo delay (strategia differita)
        for (let i = 0; i < partite.length; i++) {
            const matchId = partite[i].partita_id;
            const matchHashId = partite[i].id_partita_hash;
            
            try {
                await client.query('BEGIN');

                // 3. Creiamo l'Armata in DB (su Postgres usiamo UUID matchId)
                const idArmata = randomUUID();
                await client.query(
                    `INSERT INTO armata (id_istanza_armata, partita_id, user_id, x, y, hp_tot) 
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [idArmata, matchId, userId, PALERMO_COORDS.x, PALERMO_COORDS.y, 100]
                );

                // 4. Creiamo la Truppa (Fante) in DB e la leghiamo all'Armata
                const idTruppa = randomUUID();
                await client.query(
                    `INSERT INTO truppe (id_istanza_truppa, partita_id, user_id, id_modello, id_armata, x, y, hp) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [idTruppa, matchId, userId, 'fante', idArmata, PALERMO_COORDS.x, PALERMO_COORDS.y, 100]
                );

                await client.query('COMMIT');

                // 5. Aggiornamento in Redis (su Redis usiamo matchHashId come in server.js ws.matchId)
                const redisKey = `match:${matchHashId}:player:${userId}:armies`;
                const armiesStr = await redis.get(redisKey);
                let armies = armiesStr ? JSON.parse(armiesStr) : [];
                
                const newArmy = {
                    id: idArmata,
                    name: 'Guarnigione Palermo ' + idArmata.substring(0, 4),
                    composition: { fante: 1 },
                    status: 'standby',
                    currentLocation: `${PALERMO_COORDS.x}, ${PALERMO_COORDS.y}`,
                    targetCoords: null
                };
                
                armies.push(newArmy);
                await redis.set(redisKey, JSON.stringify(armies));

                // 6. Broadcast via WebSocket (a tutta la partita)
                const broadcastPayload = {
                    matchId: matchHashId, // Il Dispatcher filtra su ws.matchId (che è l'hash)
                    payload: {
                        type: 'TROOPS_SPAWNED',
                        data: {
                            userId: userId,
                            army: newArmy
                        }
                    }
                };
                await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));

                console.log(`[TROOP_GEN] Fante generato per antopintus in match ${matchHashId}`);

            } catch (err) {
                await client.query('ROLLBACK');
                console.error(`[TROOP_GEN] Errore partita ${matchId}:`, err);
            }

            // Staggering: attendi 1 secondo prima di processare il prossimo match per non sovraccaricare il DB
            await new Promise(res => setTimeout(res, 1000));
        }

    } catch (e) {
        console.error('[TROOP_GEN] Errore critico:', e);
    } finally {
        client.release();
        isRunning = false;
    }
};

const startTroopGenerator = () => {
    console.log('[SYSTEM] Avvio cron timer Troop Generator (Differito)');
    // Esegui ogni 60 secondi
    setInterval(generateTroopForAntopintus, 60000);
    // Esegui la prima volta subito:
    setTimeout(generateTroopForAntopintus, 5000);
};

module.exports = { startTroopGenerator };
