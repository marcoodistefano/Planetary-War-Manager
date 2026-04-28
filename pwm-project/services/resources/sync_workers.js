const { Pool } = require('pg');
const format = require('pg-format');
const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
});

const db = new Pool({
  host: process.env.DB_HOST || 'db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'secret',
  database: process.env.DB_NAME || 'postgres',
  port: process.env.DB_PORT || 5432,
});

async function performDump() {
    const partiteAttive = await redis.keys('modificati:*');
    
    for (const key of partiteAttive) {
        const partitaId = key.split(':')[1];
        const processingKey = `processing:${partitaId}`;
        await redis.rename(key, processingKey).catch(() => null); 
        
        const ids = await redis.smembers(processingKey);
        if (ids.length === 0) continue;

        const rows = [];
        for (const id of ids) {
            const data = await redis.hgetall(`truppa:${id}`);
            const currentX = data.targetX || data.x || 0;
            const currentY = data.targetY || data.y || 0;
            
            rows.push([id, partitaId, data.user_id, data.tipo, currentX, currentY, data.alt || 0, data.rot || 0, data.hp || 100, data.stato || 1]);
        }

        const sql = format(
            `INSERT INTO truppe (id_istanza_truppa, partita_id, user_id, id_modello, x, y, alt, rot, hp, stato) 
             VALUES %L 
             ON CONFLICT (id_istanza_truppa) 
             DO UPDATE SET x=EXCLUDED.x, y=EXCLUDED.y, stato=EXCLUDED.stato`,
            rows
        );
        
        try {
            await db.query(sql);
            await redis.del(processingKey); 
            console.log(`Sincronizzate ${ids.length} truppe per partita ${partitaId}`);
        } catch(e) {
            console.error("Errore DB. Mantengo la coda in processing.", e);
        }
    }
}

// Avvia il loop infinito di base
setInterval(performDump, 5000);
console.log("Worker di sincronizzazione avviato...");
