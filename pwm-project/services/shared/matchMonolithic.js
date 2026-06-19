const Redis = require('ioredis');
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
});

async function updateMatch(matchId, updaterCallback, maxRetries = 10) {
    const key = `match:${matchId}`;
    
    for (let i = 0; i < maxRetries; i++) {
        // Create an isolated connection for the watch transaction
        const isolatedClient = new Redis({
            host: process.env.REDIS_HOST || 'redis',
            port: process.env.REDIS_PORT || 6379,
        });
        
        try {
            await isolatedClient.watch(key);
            const matchDataStr = await isolatedClient.get(key);
            
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

            if (id_partita) multiCmd.set(`match:${id_partita}`, stringified);
            if (id_partita_hash) multiCmd.set(`match:${id_partita_hash}`, stringified);
            if (id_visualizzato) multiCmd.set(`match:${id_visualizzato}`, stringified);
            
            // Assicuriamoci che la chiave originaria venga sempre aggiornata se non era tra le tre
            if (![`match:${id_partita}`, `match:${id_partita_hash}`, `match:${id_visualizzato}`].includes(key)) {
                multiCmd.set(key, stringified);
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
    const data = await redis.get(`match:${matchId}`);
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
