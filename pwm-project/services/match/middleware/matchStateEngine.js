const db = require('../../shared/postgresClient');
const redis = require('../../shared/redisClient');
const Eru = require('./Eru.js');
const { getMatch, updateMatch } = require('../../shared/matchMonolithic.js');

let isRunning = false;

const checkMatchesState = async () => {
    if (isRunning) return;
    
    // Usiamo un lock su redis per evitare sovrapposizioni tra processi
    const lockAcquired = await redis.set('engine_lock:matchState', 'locked', 'NX', 'PX', 59000);
    if (!lockAcquired) return;
    
    isRunning = true;
    const client = await db.connect();
    
    try {
        // Recupera le partite IN CORSO
        const matchesRes = await client.query(`
            SELECT id_partita, id_partita_hash, id_partita_visualizzato, 
                   struttura_partita::text AS struct, tempo_start
            FROM partite
            WHERE substring(struttura_partita::text from 1 for 2) = '01'
        `);

        // Recuperiamo i dati mappa per sapere il totale regioni
        const adjData = await redis.get('map_data:regions_adjacency');
        const adj = adjData ? JSON.parse(adjData) : {};
        const totalRegions = Object.keys(adj).length || 7000;

        for (const match of matchesRes.rows) {
            const matchHashId = match.id_partita_hash;
            const decoded = Eru.decode_match(match.struct);
            const durationMs = decoded.durationMs;
            
            const timePassedMs = Date.now() - new Date(match.tempo_start).getTime();
            let isTimeout = durationMs !== Infinity && timePassedMs >= durationMs;
            
            // Controlla Win Conditions su Redis
            const matchData = await getMatch(matchHashId);
            if (!matchData || !matchData.match || !matchData.match.player) continue;

            const players = matchData.match.player;
            let totalRegionsOwnedByPlayer = {};
            let totalRegionsOwnedByAlliance = {};
            
            // Calcolo territori
            for (const p of players) {
                let count = 0;
                if (p.territori_dict) {
                    for (const admin in p.territori_dict) {
                        count += p.territori_dict[admin].length;
                    }
                } else if (p.territori) {
                    count = p.territori.length;
                }
                totalRegionsOwnedByPlayer[p.username] = count;
                
                if (decoded.alleanze_win && p.id_alleanza) {
                    totalRegionsOwnedByAlliance[p.id_alleanza] = (totalRegionsOwnedByAlliance[p.id_alleanza] || 0) + count;
                }
            }

            // Controlliamo se qualcuno ha superato la soglia (default 50% = 0.5)
            const sogliaPct = (matchData.match.caratteristiche && matchData.match.caratteristiche.vittoriaSoglia) 
                              ? (matchData.match.caratteristiche.vittoriaSoglia / 100) 
                              : 0.5;
            const requiredRegions = totalRegions * sogliaPct;
            
            let winnerPlayer = null;
            let winnerAlliance = null;
            let hasWinnerByThreshold = false;

            for (const username in totalRegionsOwnedByPlayer) {
                if (totalRegionsOwnedByPlayer[username] >= requiredRegions) {
                    winnerPlayer = username;
                    hasWinnerByThreshold = true;
                    break;
                }
            }

            if (!hasWinnerByThreshold && decoded.alleanze_win) {
                for (const allianceId in totalRegionsOwnedByAlliance) {
                    if (totalRegionsOwnedByAlliance[allianceId] >= requiredRegions) {
                        winnerAlliance = allianceId;
                        hasWinnerByThreshold = true;
                        break;
                    }
                }
            }
            
            // Se la partita scade per tempo, decretiamo il vincitore per punteggio (maggior numero territori)
            if (isTimeout && !hasWinnerByThreshold) {
                let maxCount = -1;
                for (const username in totalRegionsOwnedByPlayer) {
                    if (totalRegionsOwnedByPlayer[username] > maxCount) {
                        maxCount = totalRegionsOwnedByPlayer[username];
                        winnerPlayer = username;
                    }
                }
                
                if (decoded.alleanze_win) {
                    for (const allianceId in totalRegionsOwnedByAlliance) {
                        if (totalRegionsOwnedByAlliance[allianceId] > maxCount) {
                            maxCount = totalRegionsOwnedByAlliance[allianceId];
                            winnerAlliance = allianceId;
                            winnerPlayer = null; // Vince l'alleanza
                        }
                    }
                }
            }

            if (hasWinnerByThreshold || isTimeout) {
                // Termina la partita -> aggiorna il DB e REDIS a STATO.TERMINATA (0b10)
                let newMatchBigInt = (BigInt("0b" + match.struct) & ~(0b11n << 54n)) | (0b10n << 54n);
                const newStructStr = newMatchBigInt.toString(2).padStart(56, "0");

                await client.query(`UPDATE partite SET struttura_partita = $1::bit(56) WHERE id_partita_hash = $2`, [newStructStr, matchHashId]);
                
                await updateMatch(matchHashId, (matchObj) => {
                    matchObj.match.struttura_partita = newStructStr;
                    matchObj.match.caratteristiche.stato = "Terminata";
                    matchObj.match.caratteristiche.vincitore = winnerAlliance ? `Alleanza ${winnerAlliance}` : winnerPlayer;
                    return { save: true, matchObj, data: true };
                });

                console.log(`[MATCH_ENGINE] Partita ${matchHashId} TERMINATA. Vincitore: ${winnerAlliance || winnerPlayer}`);

                // Broadcast
                await redis.publish('match_ws_broadcast_channel', JSON.stringify({
                    matchId: matchHashId,
                    payload: {
                        type: 'MATCH_ENDED',
                        data: {
                            winnerPlayer,
                            winnerAlliance,
                            reason: hasWinnerByThreshold ? 'THRESHOLD_REACHED' : 'TIMEOUT'
                        }
                    }
                }));
            }
        }

    } catch (e) {
        console.error('[MATCH_ENGINE] Errore critico:', e);
    } finally {
        client.release();
        isRunning = false;
    }
};

const startMatchStateEngine = () => {
    console.log('[SYSTEM] Avvio cron timer Match State Engine...');
    setInterval(checkMatchesState, 60000); // Controlla ogni minuto
};

module.exports = { startMatchStateEngine };
