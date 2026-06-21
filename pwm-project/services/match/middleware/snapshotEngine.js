const db = require('../../shared/postgresClient.js');
const redis = require('../../shared/redisClient.js');

const runSnapshotCycle = async () => {
    try {
        const lockAcquired = await redis.set('engine_lock:snapshotEngine', 'locked', 'NX', 'PX', 299000);
        if (!lockAcquired) return;

        // Garantisce che esista la colonna per il JSON monolitico di backup
        await db.query(`ALTER TABLE partite ADD COLUMN IF NOT EXISTS stato_partita_json JSONB`);

        // Recupera solo le partite attive (stato '01')
        const matchKeys = await db.query("SELECT id_partita_hash, id_partita FROM partite WHERE substring(struttura_partita::text from 1 for 2) = '01'");
        
        let snapshotsSaved = 0;

        for (const row of matchKeys.rows) {
            const matchId = row.id_partita_hash;
            const uuid = row.id_partita;

            // Prende l'ultimo stato noto da Redis usando i frammenti
            const { getMatch } = require('../../shared/matchMonolithic.js');
            const matchObj = await getMatch(matchId);
            if (!matchObj) continue;

            // Salva lo snapshot completo su PostgreSQL
            if (matchObj && matchObj.match) {
                await db.query(
                    `UPDATE partite SET stato_partita_json = $1 WHERE id_partita = $2`,
                    [JSON.stringify(matchObj), uuid]
                );
                snapshotsSaved++;
            }
        }
        
        if (snapshotsSaved > 0) {
            console.log(`[SNAPSHOT] Eseguito backup di ${snapshotsSaved} partite attive nel database SQL.`);
        }
    } catch (e) {
        console.error("[SNAPSHOT] Errore durante il backup SQL:", e);
    }
};

const startSnapshotEngine = () => {
    // Esegui il ciclo ogni 5 minuti (300.000 ms)
    setInterval(runSnapshotCycle, 5 * 60 * 1000);
    console.log("[SYSTEM] Snapshot Engine started (5m interval).");
};

module.exports = { startSnapshotEngine };
