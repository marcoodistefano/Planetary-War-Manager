const { Pool } = require('pg');
const format = require('pg-format');
const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
});

const db = new Pool({
  host: process.env.DB_HOST || 'db',
  user: process.env.DB_USER || 'commander_admin',
  password: process.env.DB_PASSWORD || 'secret',
  database: process.env.DB_NAME || 'pwm_tactical_database',
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

const FE_TO_REDIS_MAP = {
  denaro: 'denaro',
  legno: 'legno',
  piombo: 'piombo',
  acciaio: 'acciaio',
  mattoni: 'mattone',
  petrolio: 'petrolio',
  gas_naturale: 'gas',
  uranio: 'uranio',
  oro: 'oro'
};

function translateRedisToFe(resources) {
  if (!resources) return null;
  return {
    denaro: resources.denaro || 0,
    legno: resources.legno || 0,
    piombo: resources.piombo || 0,
    acciaio: resources.acciaio || 0,
    mattoni: resources.mattone || 0,
    petrolio: resources.petrolio || 0,
    gas_naturale: resources.gas || 0,
    uranio: resources.uranio || 0,
    oro: resources.oro || 0
  };
}

function getMultiplierValue(bits) {
  const map = {
    0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 10, 6: 20, 7: 30,
    8: 40, 9: 50, 10: 60, 11: 100, 12: 200, 13: 500, 14: 1000, 15: 999999
  };
  return map[Number(bits)] || 1;
}

async function generateResources() {
    try {
        const activeMatches = await db.query(
            "SELECT id_partita, id_partita_hash, struttura_partita::text AS struct FROM partite WHERE struttura_partita::text LIKE '01%'"
        );
        
        if (activeMatches.rows.length === 0) return;

        const rulesRawBase64 = await redis.get("assets:game_rules.json");
        let ruleProd = {
          legno: 500,
          piombo: 500,
          acciaio: 500,
          mattoni: 500,
          petrolio: 250,
          gas_naturale: 250
        };
        if (rulesRawBase64) {
          try {
            const rules = JSON.parse(Buffer.from(rulesRawBase64, "base64").toString("utf-8"));
            const sheet = rules.sheets.find(s => s.name === "Risorse");
            if (sheet && sheet.lines) {
              sheet.lines.forEach(line => {
                if (line.risorsa_per_ora !== undefined && ruleProd[line.id] !== undefined) {
                  ruleProd[line.id] = line.risorsa_per_ora;
                }
              });
            }
          } catch (err) {
             // Fallback gia impostato
          }
        }

        for (const match of activeMatches.rows) {
            const matchId = match.id_partita_hash;
            const matchDbId = match.id_partita;
            
            const matchReg = BigInt("0b" + match.struct);
            const multiplierBits = (matchReg >> 38n) & 0b1111n;
            const multiplier = getMultiplierValue(multiplierBits);

            const regionsResourcesStr = await redis.get(`match:${matchId}:regions_resources`);
            if (!regionsResourcesStr) continue; 
            const regionsResources = JSON.parse(regionsResourcesStr);

            const participants = await db.query(
                "SELECT u.username, u.id_user FROM partecipanti_partite pp JOIN utenti u ON pp.user_id = u.id_user WHERE pp.partita_id = $1",
                [matchDbId]
            );

            const { getMatch, updateMatch } = require('../match/shared/matchMonolithic.js');

            await updateMatch(matchId, async (matchObj) => {
                if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false };
                
                for (const player of matchObj.match.player) {
                    const username = player.username;
                    const isBot = String(username).includes('_bot');
                    
                    let userId = player.id_user;
                    if (!userId && !isBot) {
                        const participant = participants.rows.find(p => p.username === username);
                        if (participant) userId = participant.id_user;
                    }

                    const territories = player.territori || [];

                    const production = {
                        denaro: 1000 + (territories.length * 50),
                        legno: 250, piombo: 0, acciaio: 0, mattone: 250, petrolio: 0, gas: 0, uranio: 0, oro: 0
                    };

                    for (const key in production) {
                        production[key] = production[key] * multiplier;
                    }

                    player.produzione = production;

                    let resources = player.risorse;
                    let lastUpdate = player.risorse_last_update || Date.now();

                    const now = Date.now();
                    const dt = Math.max(0, (now - lastUpdate) / 1000); 

                    if (!resources) {
                        resources = { denaro: 100000, legno: 5000, piombo: 2500, acciaio: 3000, mattone: 4000, petrolio: 1500, gas: 1200, uranio: 100, oro: 50 };
                    } else {
                        for (const resKey in resources) {
                            const prodRate = production[resKey] || 0;
                            resources[resKey] = Math.round(resources[resKey] + (prodRate / 3600) * dt);
                        }
                    }

                    player.risorse = resources;
                    player.risorse_last_update = now;

                    if (userId) {
                        const feResources = translateRedisToFe(resources);
                        const feProduction = translateRedisToFe(production);
                        
                        const broadcastPayload = {
                            matchId: matchId,
                            targetUsers: [userId],
                            payload: {
                                type: 'RESOURCES_UPDATED',
                                data: {
                                    resources: feResources,
                                    production: feProduction
                                }
                            }
                        };
                        await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
                    }
                }
                return { save: true, matchObj, data: true };
            });
        }
    } catch (e) {
        console.error("[RESOURCE_GEN] Errore nel loop generazione risorse:", e);
    }
}

// Avvia il loop infinito di base
setInterval(performDump, 5000);
setInterval(generateResources, 10000);
console.log("Worker di sincronizzazione e generazione risorse avviati...");
