const mysql = require('mysql2/promise');
const Redis = require('ioredis');
const redis = new Redis();

const db = mysql.createPool({ host: 'localhost', user: 'root', database: 'pwm_tactical' });

async function performDump() {
    const partiteAttive = await redis.keys('modificati:*');
    
    for (const key of partiteAttive) {
        // Dentro il ciclo for (const key of partiteAttive) in sync_worker.js:

        const partitaId = key.split(':')[1];
        // RINOMINA LA CHIAVE: Così se crasha, non perdi i dati
        const processingKey = `processing:${partitaId}`;
        await redis.rename(key, processingKey).catch(() => null); 
        
        const ids = await redis.smembers(processingKey);
        if (ids.length === 0) continue;

        const rows = [];
        for (const id of ids) {
            const data = await redis.hgetall(`truppa:${id}`);
            // Usa il target se in movimento, altrimenti la x attuale statica
            const currentX = data.targetX || data.x || 0;
            const currentY = data.targetY || data.y || 0;
            
            rows.push([id, partitaId, data.user_id, data.tipo, currentX, currentY, data.alt || 0, data.rot || 0, data.hp || 100, data.stato || 1]);
        }

        const sql = `INSERT INTO truppe (id_truppa, partita_id, user_id, tipo, x, y, alt, rot, hp, stato) 
                     VALUES ? ON DUPLICATE KEY UPDATE x=VALUES(x), y=VALUES(y), stato=VALUES(stato)`;
        
        try {
            await db.query(sql, [rows]);
            // Elimina la chiave SOLO se il DB ha confermato il salvataggio
            await redis.del(processingKey); 
            console.log(`Sincronizzate ${ids.length} truppe per partita ${partitaId}`);
        } catch(e) {
            console.error("Errore DB. Mantengo la coda in processing.", e);
        }
    }
}

setInterval(performDump, 180000); // Dump ogni 3 minuti