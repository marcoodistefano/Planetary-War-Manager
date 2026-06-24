const express = require("express");
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
const { calculatePath, getBorderIntersection, getNodeCoords, getRegionForNode, calculateCurrentPosition, getRegionIdByName } = require("./middleware/movementLogic.js");
const { getMatch, updateMatch } = require('../shared/matchMonolithic.js');
const db = require('../shared/postgresClient.js');
const { startTroopGenerator } = require("./middleware/troopGenerator.js");
const { loadMinimumPathToRedis } = require("./middleware/loadPathToRedis.js");
const { startCombatLoop } = require("./middleware/combatLogic.js");
const { startFogOfWarEngine } = require("./middleware/fogOfWarEngine.js");
const { startCombatTriggerEngine } = require("./middleware/combatTriggerEngine.js");
const { startSnapshotEngine } = require("./middleware/snapshotEngine.js");
const { startMatchStateEngine } = require("./middleware/matchStateEngine.js");
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

                    if (matchData && matchData.match && matchData.match.player) {
                        nations = matchData.match.player;
                        for (const p of nations) {
                            if (p.armate) {
                                const playerArmies = Object.values(p.armate).map(a => ({ ...a, owner: p.username }));
                                armies = armies.concat(playerArmies);
                            }
                            if (p.strutture) {
                                const playerStr = p.strutture.map(s => ({ ...s, owner: p.username }));
                                structures = structures.concat(playerStr);
                            }
                            if (p.username === ws.username) {
                                resources = translateRedisToFe(p.risorse);
                                production = translateRedisToFe(p.produzione);
                                technologies = p.technologies || [];
                                trainings = p.addestramenti || [];
                                console.log(`[WS_MATCH] INITIAL_STATE per ${ws.username}: risorse=`, resources);
                            }
                        }
                    }
                    const actualMatchId = matchData.match.id_partita_hash;
                    const regionsResourcesStr = await redis.get(`match:${actualMatchId}:regions_resources`);
                    const regionsResources = regionsResourcesStr ? JSON.parse(regionsResourcesStr) : {};

                    ws.send(JSON.stringify({
                        type: 'INITIAL_STATE',
                        payload: { armies, nations, resources, production, structures, regionsResources, technologies, trainings }
                    }));
                    return;
                }

                if (payload.action === 'RECRUIT_UNIT') {
                    try {
                        console.log("[RECRUIT_UNIT] Inizio elaborazione", payload);
                        const { unitId, targetName, targetCoords, costMoney, costSteel, trainTime } = payload;
                        
                        const result = await updateMatch(ws.matchId, async (matchObj) => {
                            if (!matchObj || !matchObj.match || !matchObj.match.player) {
                                console.log("[RECRUIT_UNIT] Partita o player mancanti");
                                return { save: false };
                            }

                            let player = matchObj.match.player.find(p => p.username === ws.username);
                            if (!player) {
                                console.log("[RECRUIT_UNIT] Player non trovato per", ws.username);
                                return { save: false };
                            }

                            if (unitId !== 'fante' && player.addestramenti && player.addestramenti.some(t => t.targetName === targetName)) {
                                console.log("[RECRUIT_UNIT] Addestramento già in corso in questa struttura");
                                ws.send(JSON.stringify({ type: 'ERROR', error: 'Coda di addestramento occupata in questa struttura.' }));
                                return { save: false };
                            }
                            
                            let resources = player.risorse || { denaro: 0, acciaio: 0 };
                            
                            if (resources.denaro < costMoney || resources.acciaio < (costSteel || 0)) {
                                console.log("[RECRUIT_UNIT] Risorse insufficienti");
                                ws.send(JSON.stringify({ type: 'ERROR', error: 'Risorse insufficienti per il reclutamento.' }));
                                return { save: false };
                            }
                            
                            resources.denaro -= costMoney;
                            if (costSteel) resources.acciaio -= costSteel;
                            player.risorse = resources;
                            
                            let multiplier = 1;
                            if (matchObj.match.struttura_partita) {
                                try {
                                    const decodedMatch = Eru.decode_match(matchObj.match.struttura_partita);
                                    multiplier = decodedMatch.multiplierValue || 1;
                                } catch (err) {}
                            }
                            const trainTimeMs = (trainTime / multiplier) * 3600 * 1000;
                            const endTime = Date.now() + trainTimeMs;
                            
                            if (!player.addestramenti) player.addestramenti = [];
                            player.addestramenti.push({
                                troopId: unitId,
                                targetName: targetName,
                                spawnCoords: targetCoords,
                                count: 1,
                                endTime: endTime
                            });
                            console.log(`[RECRUIT_UNIT] Salvataggio addestramento di ${unitId} per ${ws.username}`);
                            return { save: true, matchObj, data: { trainings: player.addestramenti, resources: player.risorse } };
                        });
                        
                        if (result) {
                            ws.send(JSON.stringify({
                                type: 'RECRUIT_UNIT_SUCCESS',
                                payload: {
                                    trainings: result.trainings,
                                    resources: translateRedisToFe(result.resources)
                                }
                            }));
                        }
                    } catch (e) {
                        console.error("[SYS_ERR] Errore in RECRUIT_UNIT:", e);
                        ws.send(JSON.stringify({ type: 'ERROR', error: `Errore RECRUIT_UNIT: ${e.message}` }));
                    }
                    return;
                }

                if (payload.action === 'SAVE_ARMIES') {
                    const dict = {};
                    (payload.payload.armies || []).forEach(a => dict[a.id] = a);
                    await updateMatch(ws.matchId, async (matchObj) => {
                        if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false };
                        const player = matchObj.match.player.find(p => p.username === ws.username);
                        if (player) {
                            player.armate = dict;
                            return { save: true, matchObj, data: true };
                        }
                        return { save: false };
                    });

                    // Sync PostgreSQL
                    try {
                        const partitaRes = await db.query(`SELECT id_partita FROM partite WHERE id_partita_hash = $1`, [ws.matchId]);
                        if (partitaRes.rows.length > 0) {
                            const partitaId = partitaRes.rows[0].id_partita;
                            const userRes = await db.query(`SELECT id_user FROM utenti WHERE username = $1`, [ws.username]);
                            if (userRes.rows.length > 0) {
                                const userId = userRes.rows[0].id_user;
                                
                                const dbArmiesRes = await db.query(`SELECT id_istanza_armata FROM armata WHERE partita_id = $1 AND user_id = $2`, [partitaId, userId]);
                                const dbArmies = new Set(dbArmiesRes.rows.map(r => r.id_istanza_armata));
                                const uiArmies = new Set(Object.keys(dict));

                                // Trova armate da inserire
                                const toInsert = [...uiArmies].filter(id => !dbArmies.has(id));
                                for (const id of toInsert) {
                                    const a = dict[id];
                                    const comp = a.composition || {};
                                    const troopType = Object.keys(comp)[0] || 'fante';
                                    const count = comp[troopType] || 1;
                                    
                                    let spawnX = 0, spawnY = 0;
                                    if (a.currentLocation && typeof a.currentLocation === 'string' && a.currentLocation.includes(',')) {
                                        const pts = a.currentLocation.split(',');
                                        spawnX = parseFloat(pts[0]);
                                        spawnY = parseFloat(pts[1]);
                                    }

                                    const hp = 100 * count; // Base HP
                                    const dmg = 10 * count; // Base DMG
                                    
                                    await db.query(
                                        `INSERT INTO armata (id_istanza_armata, partita_id, user_id, id_modello, x, y, hp_tot, are_they_in_the_same_position, dmg_tot, max_range_atck, speed) 
                                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT DO NOTHING`,
                                        [id, partitaId, userId, troopType, spawnX, spawnY, hp, true, dmg, 1, 1]
                                    );
                                    
                                    const crypto = require('crypto');
                                    await db.query(
                                        `INSERT INTO truppe (id_istanza_truppa, partita_id, user_id, id_modello, id_armata, x, y, hp) 
                                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
                                        [crypto.randomUUID(), partitaId, userId, troopType, id, spawnX, spawnY, hp]
                                    );
                                }

                                // Trova armate da eliminare
                                const toDelete = [...dbArmies].filter(id => !uiArmies.has(id));
                                for (const id of toDelete) {
                                    await db.query(`DELETE FROM armata WHERE id_istanza_armata = $1`, [id]);
                                    await db.query(`DELETE FROM truppe WHERE id_armata = $1`, [id]);
                                }
                            }
                        }
                    } catch (dbErr) {
                        console.error("[SAVE_ARMIES] Errore sync PostgreSQL:", dbErr);
                    }

                    return;
                }

                if (payload.action === 'MOVE_TROOPS') {
                    const { armyId, targetName, targetCoords } = payload.payload;

                    const matchData = await getMatch(ws.matchId);
                    if (!matchData || !matchData.match || !matchData.match.player) {
                        ws.send(JSON.stringify({ type: 'ERROR', error: 'Partita non trovata' }));
                        return;
                    }

                    if (!matchData.match.struttura_partita || !matchData.match.struttura_partita.startsWith('01')) {
                        ws.send(JSON.stringify({ type: 'ERROR', error: 'La partita non è ancora iniziata.' }));
                        return;
                    }

                    const player = matchData.match.player.find(p => p.username === ws.username);
                    if (!player || !player.armate || !player.armate[armyId]) {
                        ws.send(JSON.stringify({ type: 'ERROR', error: 'Armata non trovata' }));
                        return;
                    }

                    const armata = player.armate[armyId];
                    let startLng, startLat;
                    let loc = armata.currentLocation;
                    if (loc && typeof loc === 'string') {
                        if (loc.includes(',')) {
                            const pts = loc.split(',').map(s => parseFloat(s.trim()));
                            if (pts.length === 2 && !isNaN(pts[0]) && !isNaN(pts[1])) { startLng = pts[0]; startLat = pts[1]; }
                        } else {
                            const nodeCoords = getNodeCoords(loc);
                            if (nodeCoords) { startLng = nodeCoords[0]; startLat = nodeCoords[1]; }
                        }
                    } else if (loc && loc.x !== undefined && loc.y !== undefined) {
                        startLng = loc.x; startLat = loc.y;
                    } else if (Array.isArray(loc) && loc.length >= 2) {
                        startLng = loc[0]; startLat = loc[1];
                    }

                    if (startLng === undefined || startLat === undefined) {
                        ws.send(JSON.stringify({ type: 'ERROR', error: 'Coordinate di partenza invalide' }));
                        return;
                    }

                    let currentPathInfo = null;
                    const armyState = armata.status;
                    if ((armyState === 'moving' || armyState === 'moving_to_border' || armyState === "Pronto alla conquista") && armata.path && armata.path.length > 1 && armata.startTime && armata.etaMs) {
                        const currentPos = calculateCurrentPosition(armata.path, armata.startTime, armata.etaMs);
                        if (currentPos) {
                            startLng = currentPos.lng;
                            startLat = currentPos.lat;
                            currentPathInfo = { path: armata.path, currentIndex: currentPos.currentIndex };
                        }
                    }

                    let targetLng, targetLat;
                    let parsedTargetCoords = null;
                    if (typeof targetCoords === 'string') {
                        const pts = targetCoords.split(',').map(s => parseFloat(s.trim()));
                        if (pts.length === 2 && !isNaN(pts[0]) && !isNaN(pts[1])) {
                            targetLng = pts[0]; targetLat = pts[1]; parsedTargetCoords = [targetLng, targetLat];
                        }
                    } else if (Array.isArray(targetCoords) && targetCoords.length === 2) {
                        targetLng = parseFloat(targetCoords[0]); targetLat = parseFloat(targetCoords[1]); parsedTargetCoords = [targetLng, targetLat];
                    }

                    if (targetLng === undefined && targetName) {
                        const nodeCoords = getNodeCoords(targetName);
                        if (nodeCoords) { targetLng = nodeCoords[0]; targetLat = nodeCoords[1]; parsedTargetCoords = [targetLng, targetLat]; }
                    }
                    if (targetLng === undefined || targetLat === undefined) {
                        ws.send(JSON.stringify({ type: 'ERROR', error: 'Coordinate di destinazione invalide' })); return;
                    }

                    let multiplier = 1;
                    if (matchData.match.struttura_partita) {
                        try {
                            const decodedMatch = Eru.decode_match(matchData.match.struttura_partita);
                            multiplier = decodedMatch.multiplierValue || 1;
                        } catch (err) {
                            console.warn("[SYS_WARN] Errore decodifica match:", err.message);
                        }
                    }

                    let pathInfo = { isValid: false, distance: 0, etaMs: 0, path: [] };
                    try {
                        pathInfo = await calculatePath(startLng, startLat, targetName, targetLng, targetLat, multiplier, currentPathInfo);
                    } catch (e) {
                        console.error("Errore durante calculatePath:", e);
                    }

                    let targetPlayerId = null;
                    let isInWar = false;
                    let isAttack = false;
                    let borderEtaMs = pathInfo.etaMs;

                    const updRes = await updateMatch(ws.matchId, async (matchObj) => {
                        if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false };

                        const regionId = getRegionForNode(targetName) || targetName;
                        let targetNation = matchObj.match.player.find(n => n.territori_dict && Object.values(n.territori_dict).some(list => list.includes(regionId)));
                        if (!targetNation && targetName !== regionId) {
                            targetNation = matchObj.match.player.find(n => n.territori_dict && Object.values(n.territori_dict).some(list => list.includes(targetName)));
                        }
                        if (!targetNation) {
                            targetNation = matchObj.match.player.find(n => n.territori && n.territori.includes(targetName));
                        }
                        if (targetNation && targetNation.isOccupied && targetNation.username && targetNation.username !== ws.username) {
                            // Controlla se il target è un alleato - in quel caso inibire l'attacco
                            const movingPlayer = matchObj.match.player.find(n => n.username === ws.username);
                            const movingAllianceId = movingPlayer ? movingPlayer.id_alleanza : null;
                            const defenderAllianceId = targetNation.id_alleanza || null;
                            const isAlly = movingAllianceId && defenderAllianceId && String(movingAllianceId) === String(defenderAllianceId);

                            if (isAlly) {
                                return { save: false, data: { error: 'Non puoi attaccare un membro della tua alleanza!' } };
                            }

                            isAttack = true;
                            targetPlayerId = targetNation.username;
                            isInWar = targetNation.inWarWith && targetNation.inWarWith.includes(ws.username);
                        }

                        if (!isAttack && payload.payload.mode === 'conquer') {
                            for (const n of matchObj.match.player) {
                                if (n.username === ws.username) continue;
                                if (n.armate && n.armate[targetName]) {
                                    // Controlla alleanza anche per target armata
                                    const movingPlayer = matchObj.match.player.find(x => x.username === ws.username);
                                    const movingAllianceId = movingPlayer ? movingPlayer.id_alleanza : null;
                                    const defAllianceId = n.id_alleanza || null;
                                    if (movingAllianceId && defAllianceId && String(movingAllianceId) === String(defAllianceId)) {
                                        return { save: false, data: { error: 'Non puoi attaccare un membro della tua alleanza!' } };
                                    }
                                    isAttack = true;
                                    targetPlayerId = n.username;
                                    isInWar = n.inWarWith && n.inWarWith.includes(ws.username);
                                    break;
                                }
                            }
                        }

                        let warBroadcast = null;
                        if (isAttack && !isInWar) {
                            const attackerNation = matchObj.match.player.find(n => n.username === ws.username);
                            const defenderNation = matchObj.match.player.find(n => n.username === targetPlayerId);
                            if (attackerNation && defenderNation) {
                                attackerNation.inWarWith = attackerNation.inWarWith || [];
                                if (!attackerNation.inWarWith.includes(targetPlayerId)) attackerNation.inWarWith.push(targetPlayerId);
                                defenderNation.inWarWith = defenderNation.inWarWith || [];
                                if (!defenderNation.inWarWith.includes(ws.username)) defenderNation.inWarWith.push(ws.username);

                                warBroadcast = {
                                    matchId: ws.matchId,
                                    payload: {
                                        type: 'WAR_DECLARED',
                                        data: { attacker: ws.username, defender: targetPlayerId },
                                        nations: matchObj.match.player
                                    }
                                };
                                isInWar = true;
                            }
                        }

                        const p = matchObj.match.player.find(n => n.username === ws.username);
                        if (!p || !p.armate || !p.armate[armyId]) return { save: false };

                        p.armate[armyId].currentLocation = `${startLng},${startLat}`;
                        p.armate[armyId].status = (isAttack || (isAttack && pathInfo.path.length > 0)) ? "Pronto alla conquista" : "moving";
                        p.armate[armyId].targetCoords = parsedTargetCoords || targetCoords;
                        p.armate[armyId].targetName = targetName;
                        p.armate[armyId].missionMode = payload.payload.mode;
                        p.armate[armyId].path = pathInfo.path;
                        p.armate[armyId].startTime = Date.now();
                        p.armate[armyId].etaMs = pathInfo.etaMs;

                        return { save: true, matchObj, data: { armata: p.armate[armyId], warBroadcast } };
                    });

                    if (updRes && updRes.warBroadcast) {
                        await redis.publish('match_ws_broadcast_channel', JSON.stringify(updRes.warBroadcast));
                    }

                    if (updRes && (updRes.error || (updRes.data && updRes.data.error))) {
                        const errMessage = updRes.error || updRes.data.error;
                        ws.send(JSON.stringify({ type: 'ERROR', error: errMessage }));
                        return;
                    }

                    if (updRes && updRes.armata) {
                        const armataObj = updRes.armata;
                        try {
                            // PULIZIA COMBATTIMENTI PENDENTI: se l'armata era in combattimento, eliminiamo le mosse di attacco per evitare combattimenti fantasma a distanza
                            const mossaAtkRes = await db.query(`SELECT id_mossa FROM mosse WHERE id_armata = $1 AND type_action = 'atk'`, [armyId]);
                            if (mossaAtkRes.rows.length > 0) {
                                for (const r of mossaAtkRes.rows) {
                                    await db.query(`DELETE FROM attacco WHERE id_mossa = $1`, [r.id_mossa]);
                                    await db.query(`DELETE FROM mosse WHERE id_mossa = $1`, [r.id_mossa]);
                                }
                                // Notifica frontend annullamento combattimento
                                const combatCancelPayload = {
                                    matchId: ws.matchId,
                                    payload: {
                                        type: 'COMBAT_CANCELLED',
                                        data: { armyId }
                                    }
                                };
                                await redis.publish('match_ws_broadcast_channel', JSON.stringify(combatCancelPayload));
                            }

                            const mossaRes = await db.query(`SELECT id_mossa FROM mosse WHERE id_armata = $1 AND type_action = 'mov'`, [armyId]);
                            const etaDate = new Date(Date.now() + borderEtaMs);
                            if (mossaRes.rows.length > 0) {
                                const id_mossa = mossaRes.rows[0].id_mossa;
                                await db.query(`DELETE FROM spostamenti WHERE id_mossa = $1`, [id_mossa]);
                                await db.query(`UPDATE mosse SET ttl = $1 WHERE id_mossa = $2`, [etaDate, id_mossa]);
                                await db.query(`INSERT INTO spostamenti (id_mossa, numero_coda, x_dest, y_dest, target_node, time_to_arrive) VALUES ($1, 1, $2, $3, $4, $5)`, [id_mossa, targetLng, targetLat, targetName, etaDate]);
                            } else {
                                const partitaRes = await db.query(`SELECT id_partita FROM partite WHERE id_partita_hash = $1`, [ws.matchId]);
                                if (partitaRes.rows.length > 0) {
                                    const partitaId = partitaRes.rows[0].id_partita;
                                    const insertMossa = await db.query(`INSERT INTO mosse (user_id, partita_id, type_action, id_armata, ttl) VALUES ((SELECT id_user FROM utenti WHERE username=$1), $2, 'mov', $3, $4) RETURNING id_mossa`, [ws.username, partitaId, armyId, etaDate]);
                                    const newIdMossa = insertMossa.rows[0].id_mossa;
                                    await db.query(`INSERT INTO spostamenti (id_mossa, numero_coda, x_dest, y_dest, target_node, time_to_arrive) VALUES ($1, 1, $2, $3, $4, $5)`, [newIdMossa, targetLng, targetLat, targetName, etaDate]);
                                }
                            }
                        } catch (dbErr) {
                            console.error("[SYS_ERR] Errore salvataggio movimento in DB:", dbErr);
                        }

                        const broadcastPayload = {
                            matchId: ws.matchId,
                            payload: {
                                type: 'TROOPS_MOVED',
                                data: {
                                    userId,
                                    armyId,
                                    targetName,
                                    targetCoords,
                                    etaMs: pathInfo.etaMs,
                                    path: pathInfo.path,
                                    startTime: armataObj.startTime,
                                    mode: payload.payload.mode
                                }
                            }
                        };
                        await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
                    }
                }

                if (payload.action === 'CANCEL_MISSION') {
                    console.log(`[WS_MATCH] CANCEL_MISSION ricevuto per armata:`, payload.payload);
                    const { armyId } = payload.payload;

                    const updRes = await updateMatch(ws.matchId, async (matchObj) => {
                        if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false };
                        const player = matchObj.match.player.find(p => p.username === ws.username);
                        if (!player || !player.armate || !player.armate[armyId]) return { save: false };

                        const army = player.armate[armyId];

                        if (army.status === 'in combattimento') {
                            army.status = 'standby';
                            delete army.targetName; delete army.targetCoords; delete army.missionMode; delete army.next_round_time;
                            return { save: true, matchObj, data: { action: 'combat_cancelled', army } };
                        } else if (army.status === 'moving' || army.status === 'moving_to_border' || army.status === "Pronto alla conquista") {
                            const now = Date.now();
                            let elapsed = 0; let returnPath = []; let currentLng, currentLat;
                            if (army.path && army.path.length > 1 && army.startTime && army.etaMs) {
                                const currentPos = calculateCurrentPosition(army.path, army.startTime, army.etaMs);
                                if (currentPos) {
                                    currentLng = currentPos.lng;
                                    currentLat = currentPos.lat;
                                    elapsed = currentPos.elapsed;
                                    returnPath.push([currentLng, currentLat]);
                                    for (let i = currentPos.currentIndex; i >= 0; i--) {
                                        returnPath.push(army.path[i]);
                                    }
                                }
                            } else {
                                army.status = 'standby';
                                delete army.path; delete army.startTime; delete army.etaMs; delete army.targetCoords; delete army.targetName; delete army.missionMode;
                                return { save: true, matchObj, data: { action: 'aborted', army } };
                            }
                            const returnEtaMs = Math.floor(elapsed);
                            army.currentLocation = `${currentLng},${currentLat}`; army.path = returnPath; army.startTime = now; army.etaMs = returnEtaMs;
                            army.targetCoords = returnPath[returnPath.length - 1]; army.targetName = "Ritorno"; army.status = 'moving';
                            return { save: true, matchObj, data: { action: 'returning', army, now, returnEtaMs } };
                        }
                        return { save: false };
                    });

                    if (updRes) {
                        if (updRes.action === 'combat_cancelled') {
                            try {
                                const mossaRes = await db.query(`SELECT id_mossa FROM mosse WHERE id_armata = $1 AND type_action = 'atk'`, [armyId]);
                                if (mossaRes.rows.length > 0) {
                                    const id_mossa = mossaRes.rows[0].id_mossa;
                                    await db.query(`DELETE FROM attacco WHERE id_mossa = $1`, [id_mossa]);
                                    await db.query(`DELETE FROM mosse WHERE id_mossa = $1`, [id_mossa]);
                                }
                                ws.send(JSON.stringify({ type: 'MISSION_CANCELLED', payload: { armyId, newLocation: updRes.army.currentLocation } }));
                                const broadcastPayload = { matchId: ws.matchId, payload: { type: 'COMBAT_CANCELLED', data: { userId: ws.username, armyId: armyId } } };
                                await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
                            } catch (dbErr) { console.error("[SYS_ERR] Errore annullamento combattimento in DB:", dbErr); }
                        } else if (updRes.action === 'aborted') {
                            ws.send(JSON.stringify({ type: 'MISSION_CANCELLED', payload: { armyId, newLocation: updRes.army.currentLocation } }));
                        } else if (updRes.action === 'returning') {
                            const { army, now, returnEtaMs } = updRes;
                            const etaDate = new Date(now + returnEtaMs);
                            try {
                                const mossaRes = await db.query(`SELECT id_mossa FROM mosse WHERE id_armata = $1 AND type_action = 'mov'`, [armyId]);
                                if (mossaRes.rows.length > 0) {
                                    const id_mossa = mossaRes.rows[0].id_mossa;
                                    await db.query(`DELETE FROM spostamenti WHERE id_mossa = $1`, [id_mossa]);
                                    await db.query(`UPDATE mosse SET ttl = $1 WHERE id_mossa = $2`, [etaDate, id_mossa]);
                                    await db.query(`INSERT INTO spostamenti (id_mossa, numero_coda, x_dest, y_dest, target_node, time_to_arrive) VALUES ($1, 1, $2, $3, $4, $5)`, [id_mossa, army.targetCoords[0], army.targetCoords[1], army.targetName, etaDate]);
                                } else {
                                    const partitaRes = await db.query(`SELECT id_partita FROM partite WHERE id_partita_hash = $1`, [ws.matchId]);
                                    if (partitaRes.rows.length > 0) {
                                        const partitaId = partitaRes.rows[0].id_partita;
                                        const insertMossa = await db.query(`INSERT INTO mosse (user_id, partita_id, type_action, id_armata, ttl) VALUES ((SELECT id_user FROM utenti WHERE username=$1), $2, 'mov', $3, $4) RETURNING id_mossa`, [ws.username, partitaId, armyId, etaDate]);
                                        const newIdMossa = insertMossa.rows[0].id_mossa;
                                        await db.query(`INSERT INTO spostamenti (id_mossa, numero_coda, x_dest, y_dest, target_node, time_to_arrive) VALUES ($1, 1, $2, $3, $4, $5)`, [newIdMossa, army.targetCoords[0], army.targetCoords[1], army.targetName, etaDate]);
                                    }
                                }
                            } catch (dbErr) { console.error("[SYS_ERR] Errore aggiornamento movimento di ritorno in DB:", dbErr); }
                            const broadcastPayload = { matchId: ws.matchId, payload: { type: 'TROOPS_MOVED', data: { userId, armyId, targetName: army.targetName, targetCoords: army.targetCoords, etaMs: returnEtaMs, path: army.path, startTime: now } } };
                            await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
                        }
                    }
                }
                if (payload.action === 'RESEARCH_TECH') {
                    const { structureId } = payload.payload;
                    try {
                        const rulesRawBase64 = await redis.get("assets:game_rules.json");
                        let structureDetails = null;
                        if (rulesRawBase64) {
                            const rules = JSON.parse(Buffer.from(rulesRawBase64, "base64").toString("utf-8"));
                            const estrattoriSheet = rules.sheets.find(s => s.name === "Estrattori");
                            const struttureSheet = rules.sheets.find(s => s.name === "Strutture");
                            const estrattoriLines = estrattoriSheet ? estrattoriSheet.lines : [];
                            const struttureLines = struttureSheet ? struttureSheet.lines : [];
                            structureDetails = estrattoriLines.find(l => l.id_extractor === structureId) || struttureLines.find(l => l.id_struttura === structureId);
                        }
                        if (!structureDetails) {
                            return ws.send(JSON.stringify({ type: 'ERROR', error: 'Tecnologia sconosciuta' }));
                        }
                        
                        const reqPrevStructure = structureDetails.richiede_struttura || structureDetails.richiede_estrattore;
                        const tier = structureDetails.tier || 1;
                        if (tier === 1) {
                            return ws.send(JSON.stringify({ type: 'ERROR', error: 'Le tecnologie di livello 1 sono già sbloccate di default' }));
                        }
                        
                        const researchCost = (structureDetails.costo_denaro || 0) * tier;
                        
                        const updRes = await updateMatch(ws.matchId, async (matchObj) => {
                            if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false, data: { error: 'Partita non trovata' } };
                            
                            const player = matchObj.match.player.find(p => p.username === ws.username);
                            if (!player) return { save: false, data: { error: 'Giocatore non trovato' } };
                            
                            player.technologies = player.technologies || [];
                            
                            if (player.technologies.includes(structureId)) {
                                return { save: false, data: { error: 'Tecnologia già ricercata' } };
                            }
                            
                            if (tier > 2 && reqPrevStructure && !player.technologies.includes(reqPrevStructure)) {
                                return { save: false, data: { error: `Devi prima ricercare ${reqPrevStructure}` } };
                            }
                            const reqDenaro = structureDetails.costo_denaro || 0;
                            const reqLegno = structureDetails.costo_legno || 0;
                            const reqMattoni = structureDetails.costo_mattoni || 0;
                            const reqAcciaio = structureDetails.costo_acciaio || 0;
                            const reqPetrolio = structureDetails.costo_petrolio || 0;
                            const reqPiombo = (structureDetails.costo_piombo || structureDetails.costo_piombio) || 0;
                            const reqGas = structureDetails.costo_gas || 0;
                            const reqUranio = structureDetails.costo_uranio || 0;
                            const reqOro = structureDetails.costo_oro || 0;

                            console.log(`[DEBUG RESEARCH] Player: ${ws.username}, Structure: ${structureId}`);
                            console.log(`[DEBUG RESEARCH] Risorse:`, player.risorse);
                            console.log(`[DEBUG RESEARCH] Requisiti:`, { reqDenaro, reqLegno, reqMattoni, reqAcciaio, reqPetrolio, reqPiombo, reqGas, reqUranio, reqOro });

                            if (
                                (player.risorse.denaro || 0) < reqDenaro ||
                                (player.risorse.legno || 0) < reqLegno ||
                                (player.risorse.mattone || 0) < reqMattoni ||
                                (player.risorse.acciaio || 0) < reqAcciaio ||
                                (player.risorse.petrolio || 0) < reqPetrolio ||
                                (player.risorse.piombo || 0) < reqPiombo ||
                                (player.risorse.gas || 0) < reqGas ||
                                (player.risorse.uranio || 0) < reqUranio ||
                                (player.risorse.oro || 0) < reqOro
                            ) {
                                return { save: false, data: { error: 'Risorse insufficienti per la ricerca' } };
                            }

                            player.risorse.denaro -= reqDenaro;
                            player.risorse.legno -= reqLegno;
                            player.risorse.mattone -= reqMattoni;
                            player.risorse.acciaio -= reqAcciaio;
                            player.risorse.petrolio -= reqPetrolio;
                            player.risorse.piombo -= reqPiombo;
                            player.risorse.gas -= reqGas;
                            player.risorse.uranio -= reqUranio;
                            player.risorse.oro -= reqOro;

                            player.technologies.push(structureId);

                            return { save: true, matchObj, data: { success: true, technologies: player.technologies, risorse: player.risorse } };
                        });
                        
                        console.log(`[RESEARCH_TECH] Result for ${ws.username}:`, updRes);

                        if (updRes && updRes.error) {
                            ws.send(JSON.stringify({ type: 'ERROR', error: updRes.error }));
                        } else if (updRes && updRes.success) {
                            ws.send(JSON.stringify({
                                type: 'RESEARCH_SUCCESS',
                                payload: { structureId, technologies: updRes.technologies, risorse: translateRedisToFe(updRes.risorse) }
                            }));
                            // Comunica anche in broadcast il cambio risorse? La UI dovrebbe aggiornarsi già dal RESEARCH_SUCCESS.
                            const broadcastPayload = { matchId: ws.matchId, payload: { type: 'MATCH_UPDATE', data: { action: 'resource_sync' } } };
                            await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
                        }
                    } catch (e) {
                        console.error("[SYS_ERR] Errore in RESEARCH_TECH:", e);
                        ws.send(JSON.stringify({ type: 'ERROR', error: 'Errore interno del server durante la ricerca' }));
                    }
                }

                if (payload.action === 'BUILD_STRUCTURE') {
                    console.log(`[WS_MATCH] Richiesta costruzione struttura ricevuta:`, payload.payload);
                    const { structureId, targetName, targetCoords } = payload.payload;

                    try {

                        const rulesRawBase64 = await redis.get("assets:game_rules.json");
                        let structureDetails = null;
                        if (rulesRawBase64) {
                            const rules = JSON.parse(Buffer.from(rulesRawBase64, "base64").toString("utf-8"));
                            const estrattoriSheet = rules.sheets.find(s => s.name === "Estrattori");
                            const struttureSheet = rules.sheets.find(s => s.name === "Strutture");
                            const estrattoriLines = estrattoriSheet ? estrattoriSheet.lines : [];
                            const struttureLines = struttureSheet ? struttureSheet.lines : [];
                            structureDetails = estrattoriLines.find(l => l.id_extractor === structureId) || struttureLines.find(l => l.id_struttura === structureId);
                        }
                        if (!structureDetails) {
                            return ws.send(JSON.stringify({ type: 'ERROR', error: 'Struttura sconosciuta' }));
                        }

                        const reqDenaro = structureDetails.costo_denaro || 0;
                        const reqLegno = structureDetails.costo_legno || 0;
                        const reqMattone = structureDetails.costo_mattoni || 0;
                        const reqAcciaio = structureDetails.costo_acciaio || 0;
                        const reqPiombo = structureDetails.costo_piombio || structureDetails.costo_piombo || 0;
                        const reqPetrolio = structureDetails.costo_petrolio || 0;
                        const baseName = structureId.split('_t')[0];
                        const reqPrevStructure = structureDetails.richiede_struttura || structureDetails.richiede_estrattore;

                        const regionId = getRegionIdByName(targetName);

                        const actualMatchId = ws.matchId;
                        const regionsResourcesStr = await redis.get(`match:${actualMatchId}:regions_resources`);
                        const regionsResources = regionsResourcesStr ? JSON.parse(regionsResourcesStr) : {};
                        const myRegionRes = regionsResources[regionId];

                        if (structureDetails.risorsa_estratta && myRegionRes) {
                            if (myRegionRes.more_common !== structureDetails.risorsa_estratta && myRegionRes.less_common !== structureDetails.risorsa_estratta) {
                                return ws.send(JSON.stringify({ type: 'ERROR', error: `In questo territorio non vi sono giacimenti di ${structureDetails.risorsa_estratta}.` }));
                            }
                        }

                        const updRes = await updateMatch(ws.matchId, async (matchObj) => {
                            if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false, data: { error: 'Partita non trovata' } };
                            if (!matchObj.match.struttura_partita || !matchObj.match.struttura_partita.startsWith('01')) {
                                return { save: false, data: { error: 'Costruzione non permessa: Partita non attiva' } };
                            }

                            const player = matchObj.match.player.find(p => p.username === ws.username);
                            if (!player || (!player.territori?.includes(regionId) && !Object.values(player.territori_dict || {}).some(list => list.includes(regionId)))) {
                                return { save: false, data: { error: 'Puoi costruire solo sui tuoi territori' } };
                            }

                            const tier = structureDetails.tier || 1;
                            const playerTechs = player.technologies || [];
                            if (tier > 1 && !playerTechs.includes(structureId)) {
                                return { save: false, data: { error: "Devi prima ricercare questa tecnologia nell'Albero Tecnologico!" } };
                            }

                            let strutture = player.strutture || [];
                            let replacedStructureId = null;

                            const hasSameBaseIdx = strutture.findIndex(s => s.structureId.split('_t')[0] === baseName && (s.regionId === regionId || s.targetName === targetName));

                            if (reqPrevStructure) {
                                const prevIdx = strutture.findIndex(s => s.structureId === reqPrevStructure && (s.regionId === regionId || s.targetName === targetName));
                                if (prevIdx === -1) {
                                    return { save: false, data: { error: `Devi prima costruire ${reqPrevStructure} in questa regione.` } };
                                }

                                const prevBaseName = reqPrevStructure.split('_t')[0];
                                if (prevBaseName === baseName) {
                                    replacedStructureId = strutture[prevIdx].id;
                                } else {
                                    if (hasSameBaseIdx !== -1) {
                                        return { save: false, data: { error: 'Hai già costruito questo tipo di struttura in questa regione.' } };
                                    }
                                }
                            } else {
                                if (hasSameBaseIdx !== -1) {
                                    return { save: false, data: { error: 'Hai già costruito questo tipo di struttura in questa regione.' } };
                                }
                            }

                            let resources = player.risorse;
                            if (!resources) return { save: false, data: { error: 'Risorse non trovate' } };

                            if (resources.denaro < reqDenaro || resources.legno < reqLegno || resources.mattone < reqMattone ||
                                resources.acciaio < reqAcciaio || resources.piombo < reqPiombo || resources.petrolio < reqPetrolio) {
                                return { save: false, data: { error: 'Risorse insufficienti per la costruzione' } };
                            }

                            resources.denaro -= reqDenaro;
                            resources.legno -= reqLegno;
                            resources.mattone -= reqMattone;
                            resources.acciaio -= reqAcciaio;
                            resources.piombo -= reqPiombo;
                            resources.petrolio -= reqPetrolio;

                            let multiplier = 1;
                            try {
                                const decodedMatch = Eru.decode_match(matchObj.match.struttura_partita);
                                multiplier = decodedMatch.multiplierValue || 1;
                            } catch (err) {}

                            const tempoCostruzioneHours = structureDetails.tempo_costruzione || 0;
                            const buildEtaMs = (tempoCostruzioneHours * 60 * 60 * 1000) / multiplier;
                            const isBuilding = buildEtaMs > 0;

                            let finalTargetCoords = targetCoords;
                            if (replacedStructureId) {
                                const oldStruct = strutture.find(s => s.id === replacedStructureId);
                                if (oldStruct && oldStruct.targetCoords) {
                                    finalTargetCoords = oldStruct.targetCoords;
                                }
                            }

                            const newStructure = {
                                id: require('crypto').randomUUID(),
                                structureId: structureId,
                                name: structureDetails.nome || structureDetails.name,
                                targetName: targetName,
                                regionId: regionId,
                                targetCoords: finalTargetCoords,
                                status: isBuilding ? 'building' : 'built',
                                owner: ws.username,
                                buildTime: Date.now(),
                                completionTime: isBuilding ? Date.now() + buildEtaMs : null
                            };

                            if (replacedStructureId) strutture = strutture.filter(s => s.id !== replacedStructureId);
                            strutture.push(newStructure);
                            player.strutture = strutture;
                            player.risorse = resources;

                            return { save: true, matchObj, data: { success: true, newStructure, replacedStructureId, resources } };
                        });

                        if (!updRes || updRes.error) {
                            const err = updRes ? updRes.error : 'Errore costruzione';
                            return ws.send(JSON.stringify({ type: 'ERROR', error: err }));
                        }

                        if (updRes.success) {
                            ws.send(JSON.stringify({ type: 'BUILD_SUCCESS', payload: updRes.newStructure, replacedStructureId: updRes.replacedStructureId }));
                            const broadcastPayload = {
                                matchId: ws.matchId,
                                targetUsers: [userId],
                                payload: { type: 'RESOURCES_UPDATED', data: { resources: translateRedisToFe(updRes.resources) } }
                            };
                            await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));

                            const broadcastStructurePayload = {
                                matchId: ws.matchId,
                                payload: { type: 'STRUCTURE_BUILT', data: updRes.newStructure, replacedStructureId: updRes.replacedStructureId }
                            };
                            await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastStructurePayload));
                        }
                    } catch (e) {
                        console.error("[SYS_ERR] Errore in BUILD_STRUCTURE:", e);
                        ws.send(JSON.stringify({ type: 'ERROR', error: 'Errore interno del server durante la costruzione' }));
                    }
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

            const activeMatchesKeys = await redis.keys('match:*:base');
            for (const key of activeMatchesKeys) {
                const matchIdHash = key.split(':')[1];
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
                                    completedStructures.push({ structure: s, owner: p.username });
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
                await db.query(`DELETE FROM spostamenti WHERE id_spostamento = $1`, [row.id_spostamento]);
                await db.query(`UPDATE mosse SET queue_order = 0 WHERE id_mossa = $1`, [row.id_mossa]);

                const matchObj = await getMatch(row.match_id);
                if (!matchObj || !matchObj.match || !matchObj.match.player) continue;
                if (!matchObj.match.struttura_partita || !matchObj.match.struttura_partita.startsWith('01')) continue;

                let army = null;
                let pIndex = -1;
                for (let i = 0; i < matchObj.match.player.length; i++) {
                    if (matchObj.match.player[i].username === row.username && matchObj.match.player[i].armate && matchObj.match.player[i].armate[row.id_armata]) {
                        army = matchObj.match.player[i].armate[row.id_armata];
                        pIndex = i;
                        break;
                    }
                }

                if (army) {
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

                    } else {
                        await updateMatch(row.match_id, (mObj) => {
                            const p = mObj.match.player.find(x => x.username === row.username);
                            if (p && p.armate && p.armate[row.id_armata]) {
                                p.armate[row.id_armata].status = 'standby';
                                if (p.armate[row.id_armata].path && p.armate[row.id_armata].path.length > 0) {
                                    const lastCoord = p.armate[row.id_armata].path[p.armate[row.id_armata].path.length - 1];
                                    p.armate[row.id_armata].currentLocation = `${lastCoord[0]},${lastCoord[1]}`;
                                } else if (p.armate[row.id_armata].targetCoords) {
                                    p.armate[row.id_armata].currentLocation = `${p.armate[row.id_armata].targetCoords[0]},${p.armate[row.id_armata].targetCoords[1]}`;
                                } else {
                                    p.armate[row.id_armata].currentLocation = p.armate[row.id_armata].targetName || row.target_node;
                                }

                                let finalCoords = p.armate[row.id_armata].targetCoords;
                                if (p.armate[row.id_armata].path && p.armate[row.id_armata].path.length > 0) {
                                    finalCoords = p.armate[row.id_armata].path[p.armate[row.id_armata].path.length - 1];
                                }

                                delete p.armate[row.id_armata].path;
                                delete p.armate[row.id_armata].etaMs;
                                delete p.armate[row.id_armata].startTime;
                                delete p.armate[row.id_armata].targetName;
                                delete p.armate[row.id_armata].missionMode;
                            }
                            return { save: true, matchObj: mObj };
                        });
                    }

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

            let multiplier = 1;
            if (row.struttura_partita) {
                try {
                    const decodedMatch = Eru.decode_match(row.struttura_partita);
                    multiplier = decodedMatch.multiplierValue || 1;
                } catch (err) { }
            }

            // Ricalcola il percorso
            try {
                const pathInfo = await calculatePath(startLng, startLat, row.target_node, row.x_dest, row.y_dest, multiplier);

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
        startSnapshotEngine();
        startMatchStateEngine();
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
