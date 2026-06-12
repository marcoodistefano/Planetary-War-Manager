const fs = require('fs');
const readline = require('readline');
const redis = require('../../shared/redisClient.js');

async function loadMinimumPathToRedis(filePath) {
    const isLoaded = await redis.get('map_data:routing_loaded');
    if (isLoaded === 'true') {
        console.log('[SYSTEM] routing table già caricata in Redis. Salto il caricamento.');
        return;
    }

    console.log('[SYSTEM] Inizio caricamento di minimum_path.json in Redis tramite stream...');
    const fileStream = fs.createReadStream(filePath);
    
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let count = 0;
    for await (const line of rl) {
        let text = line.trim();
        if (text === '{' || text === '}') continue;
        
        // Formato linea: "SourceCity": {"Dest1":{...}, ...},
        if (text.endsWith(',')) {
            text = text.slice(0, -1);
        }

        // Trova il primo due punti per separare la chiave dal valore
        const colonIndex = text.indexOf(':');
        if (colonIndex === -1) continue;

        let keyRaw = text.substring(0, colonIndex).trim();
        const valueRaw = text.substring(colonIndex + 1).trim();

        // Rimuove i doppi apici dalla chiave
        if (keyRaw.startsWith('"') && keyRaw.endsWith('"')) {
            keyRaw = keyRaw.slice(1, -1);
        }

        const redisKey = `map_data:routing:${keyRaw}`;
        await redis.set(redisKey, valueRaw);
        count++;

        if (count % 1000 === 0) {
            console.log(`[SYSTEM] Caricati ${count} nodi in Redis...`);
        }
    }

    await redis.set('map_data:routing_loaded', 'true');
    console.log(`[SYSTEM] Caricamento in Redis completato con successo. Totale nodi: ${count}`);
}

module.exports = { loadMinimumPathToRedis };
