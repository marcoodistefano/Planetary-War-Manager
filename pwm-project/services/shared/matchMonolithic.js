const Redis = require('ioredis');
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
});

const getTransactionClient = async () => ({ client: redis, inUse: true });
const releaseTransactionClient = () => {};

const safeParse = (str) => {
    try { return str ? JSON.parse(str) : null; } catch(e) { return null; }
};

// ==========================================
// FUNZIONI DI FRAMMENTAZIONE (SMART PROXY)
// ==========================================

async function getMatch(matchId) {
    let actualKey = `match:${matchId}`;
    let aliasCheck = await redis.get(actualKey);
    
    if (aliasCheck && aliasCheck.startsWith('ALIAS:')) {
        actualKey = `match:${aliasCheck.substring(6)}`;
        aliasCheck = await redis.get(actualKey);
    }

    if (aliasCheck && aliasCheck.startsWith('{')) {
        return safeParse(aliasCheck);
    }

    const mainId = actualKey.replace('match:', '');
    const baseStr = await redis.get(`match:${mainId}:base`);
    
    if (!baseStr) return null;
    
    const baseObj = safeParse(baseStr);
    if (!baseObj) return null;

    const matchObj = { match: baseObj };

    const playersNames = await redis.smembers(`match:${mainId}:players`);
    matchObj.match.player = [];

    if (playersNames && playersNames.length > 0) {
        const pipeline = redis.pipeline();
        for (const pName of playersNames) {
            pipeline.get(`match:${mainId}:player:${pName}:base`);
            pipeline.hgetall(`match:${mainId}:player:${pName}:armate`);
            pipeline.hgetall(`match:${mainId}:player:${pName}:truppe`);
            pipeline.get(`match:${mainId}:player:${pName}:risorse`);
            pipeline.get(`match:${mainId}:player:${pName}:territori`);
        }
        
        const results = await pipeline.exec();
        
        let rIndex = 0;
        for (const pName of playersNames) {
            const pBaseStr = results[rIndex++][1];
            const pArmateHash = results[rIndex++][1] || {};
            const pTruppeHash = results[rIndex++][1] || {};
            const pRisorseStr = results[rIndex++][1];
            const pTerritoriStr = results[rIndex++][1];
            
            if (pBaseStr) {
                const pBase = safeParse(pBaseStr) || {};
                
                const armate = {};
                for (const [k, v] of Object.entries(pArmateHash)) {
                    armate[k] = safeParse(v);
                }
                pBase.armate = armate;
                
                const truppe = {};
                for (const [k, v] of Object.entries(pTruppeHash)) {
                    truppe[k] = safeParse(v);
                }
                pBase.truppe = truppe;
                
                if (pRisorseStr) {
                    const ris = safeParse(pRisorseStr);
                    if (ris) pBase.risorse = ris;
                }
                if (pTerritoriStr) {
                    const terr = safeParse(pTerritoriStr);
                    if (terr) {
                        pBase.territori = terr.territori || [];
                        pBase.territori_dict = terr.territori_dict || {};
                    }
                }
                matchObj.match.player.push(pBase);
            }
        }
    }

    return matchObj;
}

// ==========================================
// UPDATE MATCH (DIFF ENGINE)
// ==========================================
async function updateMatch(matchId, updaterCallback, maxRetries = 100) {
    let actualKey = `match:${matchId}`;
    let aliasCheck = await redis.get(actualKey);
    if (aliasCheck && aliasCheck.startsWith('ALIAS:')) {
        actualKey = `match:${aliasCheck.substring(6)}`;
        aliasCheck = await redis.get(actualKey);
    }

    let isMigrating = false;
    if (aliasCheck && aliasCheck.startsWith('{')) {
        isMigrating = true;
    }

    const lockKey = `lock:updateMatch:${actualKey}`;
    const lockVal = Date.now() + Math.random().toString();

    for (let retry = 0; retry < maxRetries; retry++) {
        const lockAcquired = await redis.set(lockKey, lockVal, 'NX', 'PX', 5000);
        if (!lockAcquired) {
            await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
            continue;
        }

        try {
            const currentMatchObj = await getMatch(matchId);
            if (!currentMatchObj) {
                throw new Error("Match non trovata o base frammentata assente: " + matchId);
            }

            const preState = JSON.parse(JSON.stringify(currentMatchObj));
            const result = await updaterCallback(currentMatchObj);

            if (!result || !result.save) {
                return result ? result.data : null;
            }

            const newMatchObj = result.matchObj;
            const mainId = newMatchObj.match.id_partita_hash || newMatchObj.match.id_partita;

            const multiCmd = redis.multi();

            if (newMatchObj.match.id_partita && newMatchObj.match.id_partita !== mainId) {
                multiCmd.set(`match:${newMatchObj.match.id_partita}`, `ALIAS:${mainId}`);
            }
            if (newMatchObj.match.id_visualizzato && newMatchObj.match.id_visualizzato !== mainId) {
                multiCmd.set(`match:${newMatchObj.match.id_visualizzato}`, `ALIAS:${mainId}`);
            }

            if (isMigrating) {
                multiCmd.del(actualKey);
            }

            const preBase = isMigrating ? {} : { ...preState.match }; delete preBase.player;
            const newBase = { ...newMatchObj.match }; delete newBase.player;
            if (JSON.stringify(preBase) !== JSON.stringify(newBase)) {
                multiCmd.set(`match:${mainId}:base`, JSON.stringify(newBase));
            }

            const currentPlayersSet = new Set(newMatchObj.match.player.map(p => p.username));
            if (currentPlayersSet.size > 0) {
                multiCmd.sadd(`match:${mainId}:players`, ...Array.from(currentPlayersSet));
            }

            const prePlayersSet = new Set(preState.match.player ? preState.match.player.map(p => p.username) : []);
            const removedPlayers = Array.from(prePlayersSet).filter(p => !currentPlayersSet.has(p));
            
            for (const oldUsername of removedPlayers) {
                multiCmd.srem(`match:${mainId}:players`, oldUsername);
                multiCmd.del(`match:${mainId}:player:${oldUsername}:base`);
                multiCmd.del(`match:${mainId}:player:${oldUsername}:territori`);
                multiCmd.del(`match:${mainId}:player:${oldUsername}:risorse`);
                multiCmd.del(`match:${mainId}:player:${oldUsername}:armate`);
                multiCmd.del(`match:${mainId}:player:${oldUsername}:truppe`);
            }

            for (const newPlayer of newMatchObj.match.player) {
                const username = newPlayer.username;
                const prePlayer = preState.match.player ? preState.match.player.find(p => p.username === username) || {} : {};

                const pBaseOld = { ...prePlayer }; 
                delete pBaseOld.armate; delete pBaseOld.truppe; delete pBaseOld.risorse; delete pBaseOld.territori; delete pBaseOld.territori_dict;
                const pBaseNew = { ...newPlayer }; 
                delete pBaseNew.armate; delete pBaseNew.truppe; delete pBaseNew.risorse; delete pBaseNew.territori; delete pBaseNew.territori_dict;
                
                if (JSON.stringify(pBaseOld) !== JSON.stringify(pBaseNew)) {
                    multiCmd.set(`match:${mainId}:player:${username}:base`, JSON.stringify(pBaseNew));
                }

                const oldTerritori = { territori: prePlayer.territori || [], territori_dict: prePlayer.territori_dict || {} };
                const newTerritori = { territori: newPlayer.territori || [], territori_dict: newPlayer.territori_dict || {} };
                if (JSON.stringify(oldTerritori) !== JSON.stringify(newTerritori)) {
                    multiCmd.set(`match:${mainId}:player:${username}:territori`, JSON.stringify(newTerritori));
                }

                if (JSON.stringify(prePlayer.risorse || {}) !== JSON.stringify(newPlayer.risorse || {})) {
                    multiCmd.set(`match:${mainId}:player:${username}:risorse`, JSON.stringify(newPlayer.risorse || {}));
                }

                const oldArmate = prePlayer.armate || {};
                const newArmate = newPlayer.armate || {};
                for (const [aId, aData] of Object.entries(newArmate)) {
                    if (JSON.stringify(oldArmate[aId]) !== JSON.stringify(aData)) {
                        multiCmd.hset(`match:${mainId}:player:${username}:armate`, aId, JSON.stringify(aData));
                    }
                }
                for (const aId of Object.keys(oldArmate)) {
                    if (!newArmate[aId]) {
                        multiCmd.hdel(`match:${mainId}:player:${username}:armate`, aId);
                    }
                }

                const oldTruppe = prePlayer.truppe || {};
                const newTruppe = newPlayer.truppe || {};
                for (const [tId, tData] of Object.entries(newTruppe)) {
                    if (JSON.stringify(oldTruppe[tId]) !== JSON.stringify(tData)) {
                        multiCmd.hset(`match:${mainId}:player:${username}:truppe`, tId, JSON.stringify(tData));
                    }
                }
                for (const tId of Object.keys(oldTruppe)) {
                    if (!newTruppe[tId]) {
                        multiCmd.hdel(`match:${mainId}:player:${username}:truppe`, tId);
                    }
                }
            }

            const execResult = await multiCmd.exec();
            if (!execResult) {
                console.error("Errore critico in redis.multi().exec() durante updateMatch", matchId);
                throw new Error("Transazione fallita");
            }

            return result.data;
        } finally {
            const script = `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                else
                    return 0
                end
            `;
            try {
                await redis.eval(script, 1, lockKey, lockVal);
            } catch (err) {
                console.error("Errore rilascio lock Lua in updateMatch:", err);
            }
        }
    }
    
    throw new Error("Superato limite massimo di retry per acquisizione lock in updateMatch: " + matchId);
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
        technologies: [],
        territori: [],
        territori_dict: {},
        strutture: [],
        armate: {},
        truppe: {},
        risorse: {
            legno: 0,
            piombo: 0,
            acciaio: 0,
            mattoni: 0,
            petrolio: 0,
            gas_naturale: 0,
            cibo: 0,
            denaro: 0
        }
    };
}

module.exports = {
    getMatch,
    updateMatch,
    getTransactionClient,
    releaseTransactionClient,
    createEmptyMatchJSON,
    createEmptyPlayer
};