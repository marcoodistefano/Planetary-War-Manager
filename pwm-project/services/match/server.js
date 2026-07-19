const express = require("express");
const { handleRecruitUnit } = require('./handlers/recruit.handler.js');
const { handleBuildStructure, handleResearchTech } = require('./handlers/build.handler.js');
const { handlePreviewMissions, handleMoveTroops, handleCancelMission } = require('./handlers/movement.handler.js');
const { handleCreateArmy, handleDisbandArmy } = require('./handlers/army.handler.js');

const http = require("http");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { WebSocketServer } = require("ws");
const matchRoutes = require("./matchRoute.js");
const matchModel = require("./matchModel.js");
const { getAuthContextFromRequest } = require("../shared/authContext.js");
const { initDispatcher } = require("./Dispatcher/webDispatcher.js");
const redis = require("../shared/redisClient.js");
const dynamicPathfinder = require("./middleware/dynamicPathfinder.js");
const { calculatePath, getBorderIntersection, getNodeCoords, getRegionForNode, calculateCurrentPosition, getRegionIdByName, getRegionAtCoords, getArmyLocation, haversineDist } = require("./middleware/movementLogic.js");
const { getArmyVisionRadius, isAirArmy, isStealthArmy, radarRadiusMap, defaultVisionRadius, territoryVisionRadius } = require("./middleware/gameUtils.js");
const { getMatch, updateMatch } = require('../shared/matchMonolithic.js');
const db = require('../shared/postgresClient.js');
const { startTroopGenerator } = require("./middleware/troopGenerator.js");
const { loadMinimumPathToRedis } = require("./middleware/loadPathToRedis.js");
const { startCombatLoop } = require("./middleware/combatLogic.js");
const { startFogOfWarEngine } = require("./middleware/fogOfWarEngine.js");
const { startCombatTriggerEngine } = require("./middleware/combatTriggerEngine.js");
const { startLogisticsEngine } = require("./middleware/logisticsEngine.js");
const { startSnapshotEngine } = require("./middleware/snapshotEngine.js");
const { startMatchStateEngine } = require("./middleware/matchStateEngine.js");
const { startLeaderboardEngine } = require("./middleware/leaderboardEngine.js");
const Eru = require('./middleware/Eru.js');

function translateRedisToFe(resources) {
    // Ritorna sempre un oggetto valido (mai null) con fallback a 0
    // Così il frontend sovrascrive sempre i valori hardcoded
    return {
        denaro: (resources && resources.denaro) || 0,
        legno: (resources && resources.legno) || 0,
        piombo: (resources && resources.piombo) || 0,
        acciaio: (resources && resources.acciaio) || 0,
        mattoni: (resources && resources.mattone) || 0,
        petrolio: (resources && resources.petrolio) || 0,
        gas_naturale: (resources && resources.gas) || 0,
        uranio: (resources && resources.uranio) || 0,
        oro: (resources && resources.oro) || 0
    };
}

let cachedGameRules = null;
let lastGameRulesFetch = 0;

async function getGameRulesCached(redisClient) {
    if (cachedGameRules && (Date.now() - lastGameRulesFetch < 60000)) {
        return cachedGameRules;
    }
    const rulesRawBase64 = await redisClient.get("assets:game_rules.json");
    if (rulesRawBase64) {
        cachedGameRules = JSON.parse(Buffer.from(rulesRawBase64, 'base64').toString('utf8'));
        lastGameRulesFetch = Date.now();
    }
    return cachedGameRules;
}

const app = express();

app.use(cors());
app.use(express.json());
app.use("/match", matchRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });
const clientSockets = new Map();
const userRateLimits = new Map();

const extractMatchId = (rawUrl) => {
    const parsed = new URL(rawUrl || "/", "http://localhost");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] !== "match") return null;
    if (parts[1]) return parts[1];
    return parsed.searchParams.get("matchId") || parsed.searchParams.get("id_partita");
};

wss.on("connection", async (ws, req, userId, rawMatchId) => {
    try {
        const authResult = await matchModel.authorizeWsConnection({
            userId,
            matchId: rawMatchId,
        });

        if (!authResult.ok) {
            ws.close(1008, authResult.error || "Accesso negato alla partita");
            return;
        }

        ws.userId = userId;
        ws.username = authResult.username;
        ws.matchId = authResult.matchId;

        console.log(`[WS_MATCH] Link TCP stabilito per l'utente: ${ws.username} (match ${ws.matchId})`);

        if (!clientSockets.has(userId)) {
            clientSockets.set(userId, new Set());
        }
        clientSockets.get(userId).add(ws);

        ws.on("message", async (message) => {
            const now = Date.now();
            const lastMessageTime = userRateLimits.get(userId) || 0;
            if (now - lastMessageTime < 50) {
                console.warn(`[WS_MATCH] Rate limit exceeded per user ${userId}`);
                return;
            }
            userRateLimits.set(userId, now);

            if (message.toString() === "PING") {
                ws.send("PONG");
                return;
            }

            let payload;
            try {
                payload = JSON.parse(message.toString());
                if (typeof payload === 'string') {
                    payload = JSON.parse(payload);
                }
                if (payload.action === 'SURRENDER') {
                    try {
                        const result = await updateMatch(ws.matchId, async (matchObj) => {
                            let player = matchObj.match.player.find(p => p.username === ws.username);
                            if (!player) return { save: false };

                            player.isOccupied = false;
                            player.inWar = false;
                            player.inWarWith = [];
                            
                            // Cancella tutte le armate e truppe da Redis
                            player.armate = {};
                            
                            // Cancella tutte le strutture (se presenti)
                            player.strutture = [];
                            
                            // Azzera i territori (torna neutrale)
                            player.territori = [];
                            player.territori_dict = {};
                            
                            // Cancella code di produzione se presenti
                            player.coda_produzione = [];
                            player.costruzioni_in_corso = [];
                            
                            // Modifica lo username in modo che appaia come un bot abbandonato
                            player.username = `Abbandonato_${Math.floor(Math.random() * 1000)}`;
                            
                            return { save: true, matchObj, data: true };
                        });

                        if (result) {
                            // 1. Remove from partecipanti_partite
                            await db.query(
                                `DELETE FROM partecipanti_partite WHERE user_id = (SELECT id_user FROM utenti WHERE username = $1) AND partita_id = (SELECT id_partita FROM partite WHERE id_partita_hash = $2 OR id_partita_visualizzato = $2)`,
                                [ws.username, ws.matchId]
                            );

                            // 2. ELO penalty if ranked
                            const matchRes = await db.query('SELECT has_elo FROM partite WHERE id_partita_hash = $1 OR id_partita_visualizzato = $1', [ws.matchId]);
                            if (matchRes.rows.length > 0 && matchRes.rows[0].has_elo) {
                                // Sottrai una quota fissa (es. 20 punti) se non c'è un avversario umano
                                // O usa la logica ELO standard contro un avversario fittizio di pari livello
                                const resL = await db.query('SELECT elo_rating FROM utenti WHERE username = $1 FOR UPDATE', [ws.username]);
                                if (resL.rows.length > 0) {
                                    const ratingL = resL.rows[0].elo_rating || 1000;
                                    const K_FACTOR = 32;
                                    // Assume expected score 0.5 (contro pari livello) e risultato 0 (sconfitta)
                                    const expectedL = 0.5;
                                    const newRatingL = Math.max(0, Math.round(ratingL + K_FACTOR * (0 - expectedL)));
                                    await db.query('UPDATE utenti SET elo_rating = $1 WHERE username = $2', [newRatingL, ws.username]);
                                    console.log(`[SURRENDER] Penalità ELO applicata a ${ws.username}: ${ratingL} -> ${newRatingL}`);
                                }
                            }

                            // 3. Notifica al client che può uscire
                            ws.send(JSON.stringify({ type: 'SURRENDER_OK' }));
                            console.log(`[SURRENDER] Giocatore ${ws.username} ha abbandonato la partita ${ws.matchId}.`);
                        }
                    } catch (err) {
                        console.error('[SURRENDER] Errore:', err);
                    }
                }
            } catch (error) {
                ws.send(JSON.stringify({ type: "ERROR", error: "Payload non valido" }));
                return;
            }

            console.log(`[WS_MATCH] Ricevuto messaggio da ${userId}:`, payload);

            try {
                if (payload.action === 'GET_INITIAL_STATE') {
                    const matchData = await getMatch(ws.matchId);

                    let armies = [];
                    let nations = [];                    let resources = translateRedisToFe({});
                    let production = translateRedisToFe({});
                    let structures = [];
                    let technologies = [];
                    let trainings = [];
                    let truppe = {};

                    if (matchData && matchData.match && matchData.match.player) {
                        nations = matchData.match.player;
                        const myPlayer = nations.find(p => p.username === ws.username);
                        const myAllianceId = myPlayer ? myPlayer.id_alleanza : null;

                        const alliedUsers = new Set(
                            nations
                                .filter(p => p.username === ws.username || (myAllianceId && String(p.id_alleanza) === String(myAllianceId)))
                                .map(p => p.username)
                        );

                        const alliedArmiesVision = [];
                        const alliedRadars = [];
                        const alliedTerritoriesCoords = [];

                        for (const p of nations) {
                            if (!alliedUsers.has(p.username)) continue;

                            if (p.armate) {
                                Object.values(p.armate).forEach(a => {
                                    const loc = getArmyLocation(a);
                                    if (loc) {
                                        alliedArmiesVision.push({
                                            coords: loc,
                                            radius: getArmyVisionRadius(a)
                                        });
                                    }
                                });
                            }

                            if (p.strutture) {
                                p.strutture.forEach(s => {
                                    if (s.status === 'built' && s.structureId && s.structureId.startsWith('radar_')) {
                                        const radius = radarRadiusMap[s.structureId] || 500;
                                        if (s.targetCoords) {
                                            alliedRadars.push({
                                                coords: s.targetCoords,
                                                radius: radius,
                                                isAntiAir: s.structureId.startsWith('radar_anti_aereo')
                                            });
                                        }
                                    }
                                });
                            }

                            const pTerrNames = new Set();
                            if (p.territori_dict) {
                                Object.values(p.territori_dict).forEach(provs => {
                                    provs.forEach(t => pTerrNames.add(String(t).trim().toLowerCase()));
                                });
                            } else if (p.territori) {
                                p.territori.forEach(t => pTerrNames.add(String(t).trim().toLowerCase()));
                            }

                            pTerrNames.forEach(nodeName => {
                                const coords = getNodeCoords(nodeName);
                                if (coords) {
                                    alliedTerritoriesCoords.push(coords);
                                }
                            });
                        }

                        for (const p of nations) {
                            if (p.armate) {
                                const playerArmies = Object.values(p.armate).map(a => ({ ...a, owner: p.username }));
                                if (alliedUsers.has(p.username)) {
                                    armies = armies.concat(playerArmies);
                                } else {
                                    const visibleEnemies = playerArmies.filter(enemy => {
                                        const enemyLoc = getArmyLocation(enemy);
                                        if (!enemyLoc) return false;

                                        for (const tCoord of alliedTerritoriesCoords) {
                                            if (haversineDist(enemyLoc[0], enemyLoc[1], tCoord[0], tCoord[1]) <= territoryVisionRadius) {
                                                return true;
                                            }
                                        }

                                        for (const aVision of alliedArmiesVision) {
                                            if (haversineDist(enemyLoc[0], enemyLoc[1], aVision.coords[0], aVision.coords[1]) <= aVision.radius) {
                                                return true;
                                            }
                                        }

                                        for (const radar of alliedRadars) {
                                            if (haversineDist(enemyLoc[0], enemyLoc[1], radar.coords[0], radar.coords[1]) <= radar.radius) {
                                                if (isStealthArmy(enemy)) continue;
                                                if (radar.isAntiAir && !isAirArmy(enemy)) continue;
                                                if (!radar.isAntiAir && isAirArmy(enemy)) continue;
                                                return true;
                                            }
                                        }

                                        return false;
                                    });
                                    armies = armies.concat(visibleEnemies);
                                }
                            }
                            if (p.strutture) {
                                const isAlly = myAllianceId && String(p.id_alleanza) === String(myAllianceId);
                                if (p.username === ws.username || isAlly) {
                                    const playerStr = p.strutture.map(s => ({ ...s, owner: p.username }));
                                    structures = structures.concat(playerStr);
                                }
                            }
                            if (p.username === ws.username) {
                                resources = translateRedisToFe(p.risorse);
                                production = translateRedisToFe(p.produzione);
                                technologies = p.technologies || [];
                                trainings = p.addestramenti || [];
                                truppe = Object.fromEntries(Object.entries(p.truppe || {}).filter(([k,v]) => typeof v === 'number'));
                                console.log(`[WS_MATCH] INITIAL_STATE per ${ws.username}: risorse=`, resources);
                            }
                        }
                    }
                    const actualMatchId = matchData.match.id_partita_hash;
                    const regionsResourcesStr = await redis.get(`match:${actualMatchId}:regions_resources`);
                    const regionsResources = regionsResourcesStr ? JSON.parse(regionsResourcesStr) : {};

                    const leaderboardStr = await redis.get(`match:${actualMatchId}:leaderboard`);
                    const leaderboard = leaderboardStr ? JSON.parse(leaderboardStr) : [];

                    ws.send(JSON.stringify({
                        type: 'INITIAL_STATE',
                        payload: { armies, nations, resources, production, structures, regionsResources, technologies, trainings, leaderboard, truppe }
                    }));
                    return;
                }

                if (payload.action === 'RECRUIT_UNIT') {
                    return await handleRecruitUnit(ws, payload);
                }
                if (payload.action === 'CREATE_ARMY') {
                    return await handleCreateArmy(ws, payload, userId);
                }
                if (payload.action === 'DISBAND_ARMY') {
                    return await handleDisbandArmy(ws, payload, userId);
                }
                if (payload.action === 'SAVE_ARMIES') {
                    console.warn("[SECURITY_WARN] Endpoint SAVE_ARMIES deprecato contattato da", ws.username);
                    ws.send(JSON.stringify({ type: 'ERROR', error: 'Azione deprecata per motivi di sicurezza.' }));
                    return;
                }
                if (payload.action === 'PREVIEW_MISSIONS') {
                    const now = Date.now();
                    const lastPF = ws.lastPathfindingTime || 0;
                    if (now - lastPF < 1000) {
                        ws.send(JSON.stringify({ type: 'ERROR', error: 'Stai calcolando troppi percorsi, attendi.' }));
                        return;
                    }
                    ws.lastPathfindingTime = now;
                    return await handlePreviewMissions(ws, payload);
                }
                if (payload.action === 'MOVE_TROOPS') {
                    const now = Date.now();
                    const lastPF = ws.lastPathfindingTime || 0;
                    if (now - lastPF < 1000) {
                        ws.send(JSON.stringify({ type: 'ERROR', error: 'Stai calcolando troppi percorsi, attendi.' }));
                        return;
                    }
                    ws.lastPathfindingTime = now;
                    return await handleMoveTroops(ws, payload, userId);
                }
                if (payload.action === 'CANCEL_MISSION') {
                    return await handleCancelMission(ws, payload, userId);
                }
                if (payload.action === 'RESEARCH_TECH') {
                    return await handleResearchTech(ws, payload);
                }
                if (payload.action === 'BUILD_STRUCTURE') {
                    return await handleBuildStructure(ws, payload, userId);
                }

            } catch (globalError) {
                console.error("[SYS_ERR] Errore inaspettato durante gestione messaggio WS:", globalError);
                ws.send(JSON.stringify({ type: "ERROR", error: "Errore interno del server" }));
            }
        });

        ws.on("close", () => {
            console.log(`[WS_MATCH] Link TCP interrotto per l'utente: ${userId}`);
            const userSockets = clientSockets.get(userId);
            if (userSockets) {
                userSockets.delete(ws);
                if (userSockets.size === 0) {
                    clientSockets.delete(userId);
                }
            }
        });
    } catch (error) {
        console.error("[SYS_ERR] WS init error in match service:", error);
        ws.close(1011, "Errore interno");
    }
});

server.on("upgrade", async (request, socket, head) => {
    try {
        const auth = await getAuthContextFromRequest(request);
        if (!auth.ok) {
            console.warn("[SECURITY] Tentativo di tunnel WS rifiutato (Match):", auth.error);
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
        }
        const userId = auth.userId;

        const matchId = extractMatchId(request.url);
        if (!matchId) {
            socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
            socket.destroy();
            return;
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, request, userId, matchId);
        });
    } catch (error) {
        console.error("[SYS_ERR] WS upgrade error (Match):", error);
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
    }
});

const PORT = parseInt(process.env.PORT || "3004", 10);

const MINIMUM_PATH_FILE = path.join(__dirname, "../../shared/assets/map/minimum_path.json");
if (!fs.existsSync(MINIMUM_PATH_FILE)) {
    console.log("[SYSTEM] File minimum_path.json non trovato. Generazione in corso (potrebbe richiedere 15s)...");
    try {
        execSync("node middleware/calculate_minimum_paths.js", { stdio: "inherit", cwd: __dirname });
        console.log("[SYSTEM] Generazione minimum_path.json completata con successo.");
    } catch (err) {
        console.error("[SYS_ERR] Errore durante la generazione dei cammini minimi:", err.message);
        process.exit(1);
    }
} else {
    console.log("[SYSTEM] File minimum_path.json trovato. Salto la generazione.");
}
const startConstructionEngine = () => {
    setInterval(async () => {
        try {
            const lockAcquired = await redis.set('engine_lock:constructionEngine', 'locked', 'NX', 'PX', 2000);
            if (!lockAcquired) return;

            const activeMatchesRes = await db.query(
                "SELECT id_partita_hash FROM partite WHERE substring(struttura_partita::text from 1 for 2) = '01'"
            );
            const activeMatchIds = activeMatchesRes.rows.map(r => r.id_partita_hash);
            for (const matchIdHash of activeMatchIds) {
                let shouldSave = false;

                await updateMatch(matchIdHash, (mObj) => {
                    if (!mObj || !mObj.match || !mObj.match.player) return { save: false };

                    const now = Date.now();
                    const completedStructures = [];

                    for (const p of mObj.match.player) {
                        if (p.strutture && p.strutture.length > 0) {
                            for (const s of p.strutture) {
                                if (s.status === 'building' && s.completionTime && now >= s.completionTime) {
                                    s.status = 'built';
                                    let targetUsers = [p.id_user];
                                    const myAllianceId = p.id_alleanza;
                                    if (myAllianceId) {
                                        targetUsers = mObj.match.player
                                            .filter(x => String(x.id_alleanza) === String(myAllianceId))
                                            .map(x => x.id_user);
                                    }
                                    completedStructures.push({ structure: s, owner: p.username, targetUsers });
                                    shouldSave = true;
                                }
                            }
                        }
                    }

                    if (shouldSave) {
                        return { save: true, matchObj: mObj, data: { completedStructures } };
                    }
                    return { save: false };
                }).then(async (updRes) => {
                    if (updRes && updRes.completedStructures && updRes.completedStructures.length > 0) {
                        for (const item of updRes.completedStructures) {
                            const broadcastStructurePayload = {
                                matchId: matchIdHash,
                                targetUsers: item.targetUsers,
                                payload: { type: 'STRUCTURE_COMPLETED', data: item.structure }
                            };
                            await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastStructurePayload));
                        }
                    }
                });
            }
        } catch (e) {
            console.error("Errore nel construction engine:", e);
        }
    }, 2000);
};

const startArrivalEngine = () => {
    setInterval(async () => {
        try {
            const lockAcquired = await redis.set('engine_lock:arrivalEngine', 'locked', 'NX', 'PX', 900);
            if (!lockAcquired) return;

            const query = `
        SELECT s.id_spostamento, s.id_mossa, m.id_armata, m.partita_id, u.username, u.id_user, p.id_partita_hash as match_id, s.target_node
        FROM spostamenti s 
        JOIN mosse m ON s.id_mossa = m.id_mossa 
        JOIN utenti u ON m.user_id = u.id_user 
        JOIN partite p ON m.partita_id = p.id_partita 
        WHERE s.time_to_arrive <= NOW()
      `;
            const res = await db.query(query);

            for (const row of res.rows) {
                const matchObj = await getMatch(row.match_id);
                if (!matchObj || !matchObj.match || !matchObj.match.player) {
                    // Partita non trovata o non valida: eliminiamo lo spostamento per evitare che si blocchi
                    await db.query(`DELETE FROM spostamenti WHERE id_spostamento = $1`, [row.id_spostamento]);
                    await db.query(`UPDATE mosse SET queue_order = 0 WHERE id_mossa = $1`, [row.id_mossa]);
                    continue;
                }
                if (!matchObj.match.struttura_partita || !matchObj.match.struttura_partita.startsWith('01')) {
                    // Partita non attiva: non elaborare
                    continue;
                }

                let army = null;
                let pIndex = -1;
                for (let i = 0; i < matchObj.match.player.length; i++) {
                    if (matchObj.match.player[i].username === row.username && matchObj.match.player[i].armate && matchObj.match.player[i].armate[row.id_armata]) {
                        army = matchObj.match.player[i].armate[row.id_armata];
                        pIndex = i;
                        break;
                    }
                }

                if (!army) {
                    // Armata non trovata in Redis: eliminiamo lo spostamento per pulizia
                    console.warn(`[ARRIVAL] Armata ${row.id_armata} non trovata in Redis per il match ${row.match_id}. Rimuovo lo spostamento.`);
                    await db.query(`DELETE FROM spostamenti WHERE id_spostamento = $1`, [row.id_spostamento]);
                    await db.query(`UPDATE mosse SET queue_order = 0 WHERE id_mossa = $1`, [row.id_mossa]);
                    continue;
                }

                let isEnemyTerritory = false;
                let isAlliedTerritory = false;
                const regionId = getRegionForNode(row.target_node) || row.target_node;

                let targetNation = matchObj.match.player.find(n => n.territori_dict && Object.values(n.territori_dict).some(list => list.includes(regionId)));
                if (!targetNation && row.target_node !== regionId) {
                    targetNation = matchObj.match.player.find(n => n.territori_dict && Object.values(n.territori_dict).some(list => list.includes(row.target_node)));
                }

                if (targetNation && targetNation.username && targetNation.username !== row.username) {
                    isEnemyTerritory = true;

                    // Controlla se il proprietario del territorio è un alleato dell'attaccante
                    const attackerPlayer = matchObj.match.player.find(n => n.username === row.username);
                    const attackerAllianceId = attackerPlayer ? attackerPlayer.id_alleanza : null;
                    const defenderAllianceId = targetNation.id_alleanza || null;

                    if (attackerAllianceId && defenderAllianceId && String(attackerAllianceId) === String(defenderAllianceId)) {
                        isAlliedTerritory = true;
                    }
                }

                // Auto-converte in attacco se territorio nemico e NON alleato
                if (isAlliedTerritory && army.missionMode === 'conquer') {
                    army.missionMode = 'move';
                    console.log(`[ARRIVAL] Annullato attacco per l'armata ${row.id_armata} poiché ora è in territorio alleato`);
                } else if (isEnemyTerritory && !isAlliedTerritory && army.missionMode !== 'conquer') {
                    army.missionMode = 'conquer';
                    await updateMatch(row.match_id, (mObj) => {
                        const p = mObj.match.player.find(x => x.username === row.username);
                        if (p && p.armate && p.armate[row.id_armata]) {
                            p.armate[row.id_armata].missionMode = 'conquer';
                        }
                        return { save: true, matchObj: mObj };
                    });
                    console.log(`[ARRIVAL] Auto-converted move to ATTACK for army ${row.id_armata} on enemy territory ${row.target_node}`);
                }

                let success = false;
                
                const { getArmyDomain, getArmyType, executeAirStrike } = require('./middleware/combatLogic.js');
                const armyDomain = getArmyDomain(army);
                const armyType = getArmyType(army);

                if (armyDomain === 0 && army.missionMode === 'conquer') {
                    // Air Strike and Return / Explode
                    console.log("[ARRIVAL] Air Strike detected for army " + row.id_armata);
                    if (armyType === 3) {
                        // Missile: Nuke strike (AOE) and destroy self
                        const { executeNukeStrike } = require('./middleware/combatLogic.js');
                        const tCoords = army.targetCoords || [row.x_dest, row.y_dest];
                        await executeNukeStrike(army, tCoords, row.match_id, matchObj);
                        await db.query(`DELETE FROM spostamenti WHERE id_spostamento = $1`, [row.id_spostamento]);
                        await db.query(`DELETE FROM mosse WHERE id_mossa = $1`, [row.id_mossa]);
                        
                        // Rimuovi missile dal gioco
                        await updateMatch(row.match_id, (mObj) => {
                            const p = mObj.match.player.find(x => x.username === row.username);
                            if (p && p.armate && p.armate[row.id_armata]) {
                                delete p.armate[row.id_armata];
                            }
                            return { save: true, matchObj: mObj };
                        });
                        continue;
                    } else if (armyType === 8 || armyType === 7) {
                        // Strike and return
                        let defArmy = null;
                        let targetPlayer = row.target_node;
                        for (const p of matchObj.match.player) {
                            if (p.username === row.username || !p.armate) continue;
                            if (p.armate[row.target_node]) { 
                                defArmy = p.armate[row.target_node]; 
                                targetPlayer = p.username;
                                break; 
                            }
                        }
                        
                        await executeAirStrike(army, targetPlayer, defArmy, row.match_id, matchObj);
                        
                        // Set up return
                        const startLoc = army.startingLocation || row.target_node;
                        const returnEtaMs = 60000; // Tempo fittizio/fisso per ora, in futuro calcolato su distanza
                        const etaDate = new Date(Date.now() + returnEtaMs);
                        
                        await db.query(`DELETE FROM spostamenti WHERE id_spostamento = $1`, [row.id_spostamento]);
                        await db.query(`UPDATE mosse SET ttl = $1, type_action = 'mov' WHERE id_mossa = $2`, [etaDate, row.id_mossa]);
                        
                        // Dobbiamo estrarre lat/lng da startLoc
                        let x_dest = 0, y_dest = 0;
                        if (typeof startLoc === 'string' && startLoc.includes(',')) {
                            const pts = startLoc.split(',');
                            x_dest = parseFloat(pts[0]);
                            y_dest = parseFloat(pts[1]);
                        }
                        
                        await db.query(`INSERT INTO spostamenti (id_mossa, numero_coda, x_dest, y_dest, target_node, time_to_arrive) VALUES ($1, 1, $2, $3, $4, $5)`, [row.id_mossa, x_dest, y_dest, 'Rientro', etaDate]);
                        
                        await updateMatch(row.match_id, (mObj) => {
                            const p = mObj.match.player.find(x => x.username === row.username);
                            if (p && p.armate && p.armate[row.id_armata]) {
                                p.armate[row.id_armata].status = 'returning';
                                p.armate[row.id_armata].missionMode = 'return';
                                p.armate[row.id_armata].targetName = 'Rientro';
                                p.armate[row.id_armata].targetCoords = [x_dest, y_dest];
                                p.armate[row.id_armata].startTime = Date.now();
                                p.armate[row.id_armata].etaMs = returnEtaMs;
                                
                                // Reverse path if it exists
                                if (p.armate[row.id_armata].path) {
                                    p.armate[row.id_armata].path = p.armate[row.id_armata].path.reverse();
                                }
                            }
                            return { save: true, matchObj: mObj };
                        });
                        continue;
                    }
                }

                if (army.missionMode === 'conquer') {
                    const { setupCombatFromArrival } = require('./middleware/combatLogic.js');
                    const mossaObj = {
                        id_mossa: row.id_mossa,
                        id_armata: row.id_armata,
                        target_node: row.target_node,
                        x_dest: army.targetCoords ? army.targetCoords[0] : 0,
                        y_dest: army.targetCoords ? army.targetCoords[1] : 0,
                        partita_id: row.partita_id
                    };
                    
                    try {
                        await setupCombatFromArrival(army, mossaObj, row.match_id, row.username);

                        await updateMatch(row.match_id, (mObj) => {
                            const p = mObj.match.player.find(x => x.username === row.username);
                            if (p && p.armate && p.armate[row.id_armata]) {
                                p.armate[row.id_armata].status = army.status;
                                if (army.currentLocation) p.armate[row.id_armata].currentLocation = army.currentLocation;
                                if (army.next_round_time) p.armate[row.id_armata].next_round_time = army.next_round_time;
                                delete p.armate[row.id_armata].path;
                                delete p.armate[row.id_armata].etaMs;
                                delete p.armate[row.id_armata].startTime;
                                delete p.armate[row.id_armata].targetName;
                                delete p.armate[row.id_armata].missionMode;
                            }
                            return { save: true, matchObj: mObj };
                        });
                        success = true;
                    } catch (combatErr) {
                        console.error("[ARRIVAL] Errore nell'avvio del combattimento o salvataggio Redis:", combatErr);
                    }

                } else {
                    try {
                        await updateMatch(row.match_id, (mObj) => {
                            const p = mObj.match.player.find(x => x.username === row.username);
                            if (p && p.armate && p.armate[row.id_armata]) {
                                const { getArmyDomain } = require('./middleware/combatLogic.js');
                                const dom = getArmyDomain(p.armate[row.id_armata]);
                                if (dom === 0) {
                                    p.armate[row.id_armata].status = 'cooldown';
                                    p.armate[row.id_armata].cooldownUntil = Date.now() + 60000; // 60s cooldown
                                } else {
                                    p.armate[row.id_armata].status = 'standby';
                                }
                                if (p.armate[row.id_armata].path && p.armate[row.id_armata].path.length > 0) {
                                    const lastCoord = p.armate[row.id_armata].path[p.armate[row.id_armata].path.length - 1];
                                    p.armate[row.id_armata].currentLocation = `${lastCoord[0]},${lastCoord[1]}`;
                                } else if (p.armate[row.id_armata].targetCoords) {
                                    p.armate[row.id_armata].currentLocation = `${p.armate[row.id_armata].targetCoords[0]},${p.armate[row.id_armata].targetCoords[1]}`;
                                } else {
                                    p.armate[row.id_armata].currentLocation = p.armate[row.id_armata].targetName || row.target_node;
                                }

                                delete p.armate[row.id_armata].path;
                                delete p.armate[row.id_armata].etaMs;
                                delete p.armate[row.id_armata].startTime;
                                delete p.armate[row.id_armata].targetName;
                                delete p.armate[row.id_armata].missionMode;
                            }
                            return { save: true, matchObj: mObj };
                        });
                        success = true;
                    } catch (standbyErr) {
                        console.error("[ARRIVAL] Errore nel salvataggio stato standby in Redis:", standbyErr);
                    }
                }

                if (success) {
                    await db.query(`DELETE FROM spostamenti WHERE id_spostamento = $1`, [row.id_spostamento]);
                    await db.query(`UPDATE mosse SET queue_order = 0 WHERE id_mossa = $1`, [row.id_mossa]);
                    const broadcastPayload = {
                        matchId: row.match_id,
                        payload: {
                            type: 'TROOPS_ARRIVED',
                            payload: { armyId: row.id_armata }
                        }
                    };
                    await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
                }
            }
        } catch (e) {
            console.error("Errore nell'arrival engine:", e);
        }
    }, 1000);
};
// Caricamento in Redis
const restoreActiveMoves = async () => {
    console.log("[SYSTEM] Avvio ripristino mosse attive da DB a Redis...");
    try {
        // Aggiungi colonna target_node se non esiste per retrocompatibilità
        await db.query(`ALTER TABLE spostamenti ADD COLUMN IF NOT EXISTS target_node VARCHAR(128)`);

        const query = `
      SELECT m.id_mossa, m.id_armata, m.user_id, m.partita_id, m.ttl,
             s.x_dest, s.y_dest, s.target_node,
             p.id_partita_hash, p.struttura_partita,
             u.username
      FROM mosse m
      JOIN spostamenti s ON m.id_mossa = s.id_mossa
      JOIN partite p ON m.partita_id = p.id_partita
      JOIN utenti u ON m.user_id = u.id_user
      WHERE m.type_action = 'mov' AND m.ttl > NOW()
    `;
        const res = await db.query(query);
        console.log(`[SYSTEM] Trovati ${res.rows.length} spostamenti attivi da ripristinare.`);

        for (const row of res.rows) {
            if (!row.target_node) continue;

            const matchObj = await getMatch(row.id_partita_hash);
            if (!matchObj || !matchObj.match || !matchObj.match.player) continue;

            const player = matchObj.match.player.find(p => p.username === row.username);
            if (!player || !player.armate || !player.armate[row.id_armata]) continue;

            let army = player.armate[row.id_armata];
            let loc = army.currentLocation;
            let startLng, startLat;
            if (typeof loc === 'string') {
                if (loc.includes(',')) {
                    const pts = loc.split(',').map(s => parseFloat(s.trim()));
                    if (pts.length === 2 && !isNaN(pts[0]) && !isNaN(pts[1])) { startLng = pts[0]; startLat = pts[1]; }
                } else {
                    const nodeCoords = getNodeCoords(loc);
                    if (nodeCoords) {
                        startLng = nodeCoords[0];
                        startLat = nodeCoords[1];
                    }
                }
            } else if (loc && loc.x !== undefined) {
                startLng = loc.x;
                startLat = loc.y;
            }

            if (startLng === undefined || startLat === undefined) {
                console.warn(`[SYS_WARN] Coordinate invalide per armata ${row.id_armata}, salto ripristino`);
                continue;
            }

            let matchMultiplier = 1;
            if (row.struttura_partita) {
                try {
                    const decodedMatch = Eru.decode_match(row.struttura_partita);
                    matchMultiplier = decodedMatch.multiplierValue || 1;
                } catch (err) { }
            }

            let unitSpeedMultiplier = 1;
            if (army.composition) {
                const types = Object.keys(army.composition);
                const gameRulesStr = await redis.get("map_data:game_rules");
                if (gameRulesStr) {
                    try {
                        const rules = JSON.parse(gameRulesStr);
                        let minSpeed = Infinity;
                        for (const type of types) {
                            const uRule = rules.units.find(r => r.id === type);
                            if (uRule && uRule.speed < minSpeed) minSpeed = uRule.speed;
                        }
                        if (minSpeed !== Infinity && minSpeed > 0) unitSpeedMultiplier = 1 / minSpeed;
                    } catch (e) {}
                }
            }

            // Ricalcola il percorso
            try {
                const pathInfo = await calculatePath(startLng, startLat, row.target_node, row.x_dest, row.y_dest, unitSpeedMultiplier, null, matchMultiplier);

                army.status = 'moving';
                army.targetCoords = [parseFloat(row.x_dest), parseFloat(row.y_dest)];
                army.targetName = row.target_node;
                army.path = pathInfo.path;
                // missionMode potrebbe essere perso se non storicizzato in mosse, assumiamo 'move'
                army.missionMode = 'move';
                army.etaMs = pathInfo.etaMs;
                army.startTime = new Date(row.ttl).getTime() - pathInfo.etaMs;

                await updateMatch(row.id_partita_hash, mObj => {
                    const p = mObj.match.player.find(x => x.username === row.username);
                    if (p && p.armate && p.armate[row.id_armata]) {
                        p.armate[row.id_armata] = army;
                    }
                    return { save: true, matchObj: mObj };
                });
                console.log(`[SYSTEM] Ripristinata mossa armata ${row.id_armata} verso ${row.target_node}`);
            } catch (err) {
                console.error(`[SYS_ERR] Impossibile ricalcolare path ripristino armata ${row.id_armata}:`, err.message);
            }
        }
    } catch (err) {
        console.error("[SYS_ERR] Errore durante il ripristino delle mosse attive:", err);
    }
};

loadMinimumPathToRedis(MINIMUM_PATH_FILE).then(async () => {
    await restoreActiveMoves();
    server.listen(PORT, () => {
        console.log(`[SYSTEM] Microservizio MATCH operativo su porta ${PORT} (HTTP + WS)`);
        // Avvio generatore automatico di truppe (differito)
        startTroopGenerator();
        startCombatLoop();
        startFogOfWarEngine();
        startCombatTriggerEngine();
        startLogisticsEngine();
        startSnapshotEngine();
        startMatchStateEngine();
        startLeaderboardEngine();
        startArrivalEngine();
        startConstructionEngine();
    });
}).catch(err => {
    console.error("[SYS_ERR] Errore caricamento routing in Redis:", err);
    process.exit(1);
});

initDispatcher(clientSockets).catch((error) => {
    console.error("[SYS_ERR] Impossibile avviare il WS dispatcher (Match):", error);
});

module.exports = { clientSockets };

process.on("SIGTERM", () => {
    console.log("[SYSTEM] Ricevuto segnale di shutdown (Match). Chiusura dei circuiti...");
    wss.clients.forEach((client) => {
        client.close();
    });
    server.close(() => {
        console.log("[SYSTEM] Server MATCH arrestato in modo sicuro.");
        process.exit(0);
    });
});
