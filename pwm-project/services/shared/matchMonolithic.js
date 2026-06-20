const Redis = require('ioredis');
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
});

async function updateMatch(matchId, updaterCallback, maxRetries = 10) {
    const key = `match:${matchId}`;
    // Resolving alias before watch loop
    let actualKey = key;
    let initialData = await redis.get(key);
    if (initialData && initialData.startsWith('ALIAS:')) {
        actualKey = `match:${initialData.substring(6)}`;
    }

    for (let i = 0; i < maxRetries; i++) {
        // Create an isolated connection for the watch transaction
        const isolatedClient = new Redis({
            host: process.env.REDIS_HOST || 'redis',
            port: process.env.REDIS_PORT || 6379,
        });
        
        try {
            await isolatedClient.watch(actualKey);
            const matchDataStr = await isolatedClient.get(actualKey);
            
            if (!matchDataStr) {
                isolatedClient.disconnect();
                throw new Error("Match non trovata: " + matchId);
            }
            
            const matchObj = JSON.parse(matchDataStr);
            const result = await updaterCallback(matchObj);
            
            if (!result || !result.save) {
                isolatedClient.disconnect();
                return result ? result.data : null;
            }
            
            const id_partita = result.matchObj.match.id_partita;
            const id_partita_hash = result.matchObj.match.id_partita_hash;
            const id_visualizzato = result.matchObj.match.id_visualizzato;

            const stringified = JSON.stringify(result.matchObj);
            const multiCmd = isolatedClient.multi();

            const mainId = id_partita_hash || id_partita;
            const mainKey = `match:${mainId}`;

            multiCmd.set(mainKey, stringified);
            
            if (id_partita && id_partita !== mainId) {
                multiCmd.set(`match:${id_partita}`, `ALIAS:${mainId}`);
            }
            if (id_visualizzato && id_visualizzato !== mainId) {
                multiCmd.set(`match:${id_visualizzato}`, `ALIAS:${mainId}`);
            }
            
            if (actualKey !== mainKey && actualKey !== `match:${id_partita}` && actualKey !== `match:${id_visualizzato}`) {
                multiCmd.set(actualKey, `ALIAS:${mainId}`);
            }
            
            const execResult = await multiCmd.exec();
                
            isolatedClient.disconnect();
            
            if (!execResult) {
                // Transaction failed due to concurrent modification, retry
                await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
                continue;
            }
            
            return result.data;
        } catch (e) {
            isolatedClient.disconnect();
            throw e;
        }
    }
    throw new Error("Superato limite massimo di retry per aggiornamento match: " + matchId);
}

async function getMatch(matchId) {
    let data = await redis.get(`match:${matchId}`);
    if (data && data.startsWith('ALIAS:')) {
        data = await redis.get(`match:${data.substring(6)}`);
    }
    return data ? JSON.parse(data) : null;
}

function createEmptyMatchJSON(id_partita, id_partita_hash, id_partita_visualizzato, struttura_partita) {
    return {
        match: {
            id_partita: id_partita,
            id_partita_hash: id_partita_hash,
            id_visualizzato: id_partita_visualizzato,
            struttura_partita: struttura_partita,
            caratteristiche: {
                nome: "",
                stato: "In attesa",
                max_players: 0,
                is_squad: false
            },
            altre_caratteristiche: {},
            player: []
        }
    };
}

function createEmptyPlayer(username, nationId, nationName) {
    return {
        id_user: "",
        username: username || "",
        nationId: nationId || 0,
        nationName: nationName || "",
        inWar: false,
        isOccupied: true,
        relazioni_diplomatiche: {},
        id_alleanza: "",
        ruolo: "",
        is_leader: false,
        territori: [],
        territori_dict: {},
        strutture: [],
        armate: {},
        truppe: {},
        risorse: {
            denaro: 0, legno: 0, mattone: 0, gas: 0, petrolio: 0, piombo: 0, acciaio: 0, uranio: 0, oro: 0
        },
        produzione: {
            denaro: 0, legno: 0, mattone: 0, gas: 0, petrolio: 0, piombo: 0, acciaio: 0, uranio: 0, oro: 0
        },
        risorse_last_update: 0,
        ricerche: [],
        truppe_sbloccate: [],
        intelligence: {},
        coda_mosse: [],
        messaggi: []
    };
}

module.exports = {
    redis, // Export the connected client if needed
    updateMatch,
    getMatch,
    createEmptyMatchJSON,
    createEmptyPlayer
};
