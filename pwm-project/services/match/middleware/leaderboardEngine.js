const db = require('../../shared/postgresClient.js');
const redis = require('../../shared/redisClient.js');
const { getMatch } = require('../../shared/matchMonolithic.js');

const runLeaderboardCycle = async () => {
    try {
        const lockAcquired = await redis.set('engine_lock:leaderboardEngine', 'locked', 'NX', 'PX', 50000);
        if (!lockAcquired) return;

        // Recupera le partite attive e il loro orario di creazione
        const matchKeys = await db.query("SELECT id_partita_hash, id_partita, created_at FROM partite WHERE substring(struttura_partita::text from 1 for 2) = '01'");
        
        for (const row of matchKeys.rows) {
            const matchId = row.id_partita_hash;
            const createdAtMs = new Date(row.created_at).getTime();
            if (isNaN(createdAtMs)) continue;

            const nextCalcKey = `match:${matchId}:next_leaderboard_calc`;
            let nextCalcMs = await redis.get(nextCalcKey);
            
            if (!nextCalcMs) {
                // Se non c'è, calcola il prossimo step di 5 minuti rispetto alla creazione
                const now = Date.now();
                const elapsedSinceCreation = now - createdAtMs;
                const intervalsPassed = Math.floor(elapsedSinceCreation / 300000);
                nextCalcMs = createdAtMs + ((intervalsPassed + 1) * 300000);
                await redis.set(nextCalcKey, nextCalcMs);
            }

            if (Date.now() >= parseInt(nextCalcMs)) {
                // Ricalcoliamo il prossimo scatto reale partendo da ora, per evitare loop di esecuzioni arretrate se il server si ferma
                const now = Date.now();
                const elapsedSinceCreation = now - createdAtMs;
                const intervalsPassed = Math.floor(elapsedSinceCreation / 300000);
                const newNextCalcMs = createdAtMs + ((intervalsPassed + 1) * 300000);
                
                await redis.set(nextCalcKey, newNextCalcMs);
                
                await calculateAndBroadcastLeaderboard(matchId);
            }
        }
    } catch (e) {
        console.error("[LEADERBOARD] Errore durante il ciclo:", e);
    }
};

const calculateAndBroadcastLeaderboard = async (matchId) => {
    try {
        const matchObj = await getMatch(matchId);
        if (!matchObj || !matchObj.match || !matchObj.match.player) return;

        // Recupera le alleanze per mappare l'alleanza di ogni giocatore
        const alliancesResult = await db.query(`SELECT id_alleanza, nome_alleanza FROM alleanze WHERE id_partita = (SELECT id_partita FROM partite WHERE id_partita_hash = $1 LIMIT 1)`, [matchId]);
        const alliancesMap = {};
        alliancesResult.rows.forEach(r => {
            alliancesMap[r.id_alleanza] = r.nome_alleanza;
        });
        
        let leaderboard = [];
        matchObj.match.player.forEach(p => {
            // Conta solo i player occupati e non i bot
            if (p.isOccupied && p.username && !p.username.toLowerCase().includes('bot')) {
                const totalTerritories = p.territori ? p.territori.length : 0;
                
                // Cerca l'alleanza
                let allianceName = 'Nessuna';
                if (p.id_alleanza && alliancesMap[p.id_alleanza]) {
                    allianceName = alliancesMap[p.id_alleanza];
                }

                leaderboard.push({
                    username: p.username,
                    territories: totalTerritories,
                    alliance: allianceName
                });
            }
        });

        // Ordina decrescente per territori
        leaderboard.sort((a, b) => b.territories - a.territories);
        
        // Calcola il ranking denso (1, 1, 2, 3...)
        let currentRank = 1;
        let lastTerritories = -1;
        leaderboard.forEach(p => {
            if (lastTerritories !== -1 && p.territories < lastTerritories) {
                currentRank++;
            }
            p.rank = currentRank;
            lastTerritories = p.territories;
        });

        // Salva in Redis
        await redis.set(`match:${matchId}:leaderboard`, JSON.stringify(leaderboard));

        // Invia in broadcast
        const broadcastPayload = {
            matchId: matchId,
            payload: {
                type: 'LEADERBOARD_UPDATE',
                data: leaderboard
            }
        };
        await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));

        console.log(`[LEADERBOARD] Calcolata e inviata per partita ${matchId} (giocatori: ${leaderboard.length})`);
    } catch(err) {
        console.error(`[LEADERBOARD] Errore calcolo per ${matchId}:`, err);
    }
};

const startLeaderboardEngine = () => {
    // Eseguiamo il loop ogni 1 minuto per controllare se per qualche partita è giunto il traguardo dei 5 minuti
    setInterval(runLeaderboardCycle, 60000);
    console.log("[SYSTEM] Leaderboard Engine started (1m check interval).");
};

module.exports = { startLeaderboardEngine, calculateAndBroadcastLeaderboard };
