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
const { calculatePath, getBorderIntersection, getNodeCoords } = require("./middleware/movementLogic.js");
const { startTroopGenerator } = require("./middleware/troopGenerator.js");
const { loadMinimumPathToRedis } = require("./middleware/loadPathToRedis.js");
const { startCombatLoop } = require("./middleware/combatLogic.js");
const { startFogOfWarEngine } = require("./middleware/fogOfWarEngine.js");
const { startCombatTriggerEngine } = require("./middleware/combatTriggerEngine.js");
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
      
      if (payload.action === 'GET_INITIAL_STATE') {
         const { getMatch } = require('../shared/matchMonolithic.js');
         const matchData = await getMatch(ws.matchId);
         
         let armies = [];
         let nations = [];
         let resources = translateRedisToFe({});
         let production = translateRedisToFe({});
         let structures = [];

         if (matchData && matchData.match && matchData.match.player) {
             nations = matchData.match.player;
             for (const p of nations) {
                 if (p.armate) {
                     const playerArmies = Object.values(p.armate).map(a => ({...a, owner: p.username}));
                     armies = armies.concat(playerArmies);
                 }
                 if (p.strutture) {
                     const playerStr = p.strutture.map(s => ({...s, owner: p.username}));
                     structures = structures.concat(playerStr);
                 }
                 if (p.username === ws.username) {
                     resources = translateRedisToFe(p.risorse);
                     production = translateRedisToFe(p.produzione);
                 }
             }
         }

         ws.send(JSON.stringify({ 
           type: 'INITIAL_STATE', 
           payload: { armies, nations, resources, production, structures } 
         }));
         return;
      }

      if (payload.action === 'SAVE_ARMIES') {
         const { updateMatch } = require('../shared/matchMonolithic.js');
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
         return;
      }

if (payload.action === 'MOVE_TROOPS') {
         const { armyId, targetName, targetCoords } = payload.payload;
         const { getMatch, updateMatch } = require('../shared/matchMonolithic.js');
         
         const matchData = await getMatch(ws.matchId);
         if (!matchData || !matchData.match || !matchData.match.player) {
             ws.send(JSON.stringify({ type: 'ERROR', error: 'Partita non trovata' }));
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
         
         const armyState = armata.status;
         if ((armyState === 'moving' || armyState === 'moving_to_border' || armyState === "Pronto all'attacco") && armata.path && armata.path.length > 1 && armata.startTime && armata.etaMs) {
             const now = Date.now();
             const elapsed = now - armata.startTime;
             let progress = Math.max(0, Math.min(1, elapsed / armata.etaMs));
             if (progress < 1) {
                 const path = armata.path;
                 let totalDistance = 0;
                 const segmentDistances = [];
                 for (let i = 0; i < path.length - 1; i++) {
                    const dx = path[i+1][0] - path[i][0];
                    const dy = path[i+1][1] - path[i][1];
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    segmentDistances.push(dist);
                    totalDistance += dist;
                 }
                 const targetDistance = progress * totalDistance;
                 let currentDist = 0;
                 let currentIndex = 0;
                 let segmentProgress = 0;
                 for (let i = 0; i < segmentDistances.length; i++) {
                    if (currentDist + segmentDistances[i] >= targetDistance || i === segmentDistances.length - 1) {
                       currentIndex = i;
                       segmentProgress = segmentDistances[i] > 0 ? (targetDistance - currentDist) / segmentDistances[i] : 0;
                       break;
                    }
                    currentDist += segmentDistances[i];
                 }
                 const p1 = path[currentIndex];
                 const p2 = path[currentIndex + 1] || p1;
                 startLng = p1[0] + (p2[0] - p1[0]) * segmentProgress;
                 startLat = p1[1] + (p2[1] - p1[1]) * segmentProgress;
             } else {
                 const lastPoint = armata.path[armata.path.length - 1];
                 startLng = lastPoint[0];
                 startLat = lastPoint[1];
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
             const decodedMatch = Eru.decode_match(matchData.match.struttura_partita);
             multiplier = decodedMatch.multiplierValue || 1;
         }
         
         let pathInfo = { isValid: false, distance: 0, etaMs: 0, path: [] };
         try {
             pathInfo = await calculatePath(startLng, startLat, targetName, targetLng, targetLat, multiplier);
         } catch (e) {
             console.error("Errore durante calculatePath:", e);
         }
         
         let targetPlayerId = null;
         let isInWar = false;
         let isAttack = false;
         let borderEtaMs = pathInfo.etaMs;
         
         const updRes = await updateMatch(ws.matchId, async (matchObj) => {
             if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false };
             
             const { getRegionForNode } = require('./middleware/movementLogic.js');
             const regionId = getRegionForNode(targetName) || targetName;
             let targetNation = matchObj.match.player.find(n => n.territori_dict && Object.values(n.territori_dict).some(list => list.includes(regionId)));
             if (!targetNation && targetName !== regionId) {
                 targetNation = matchObj.match.player.find(n => n.territori_dict && Object.values(n.territori_dict).some(list => list.includes(targetName)));
             }
             if (!targetNation) {
                 targetNation = matchObj.match.player.find(n => n.territori && n.territori.includes(targetName));
             }
             if (targetNation && targetNation.isOccupied && targetNation.username && targetNation.username !== ws.username) {
                 isAttack = true;
                 targetPlayerId = targetNation.username;
                 isInWar = targetNation.inWarWith && targetNation.inWarWith.includes(ws.username);
             }
             
             if (!isAttack && payload.payload.mode === 'attack') {
                 for (const n of matchObj.match.player) {
                     if (n.username === ws.username) continue;
                     if (n.armate && n.armate[targetName]) {
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
             p.armate[armyId].status = (isAttack || (isAttack && pathInfo.path.length > 0)) ? "Pronto all'attacco" : "moving";
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
         
         if (updRes && updRes.armata) {
             const armataObj = updRes.armata;
             try {
                 const db = require('../shared/postgresClient.js');
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
             } catch(dbErr) {
                 console.error("[SYS_ERR] Errore salvataggio movimento in DB:", dbErr);
             }
             
             const broadcastPayload = {
               matchId: ws.matchId,
               targetUsers: [userId],
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
         const { updateMatch } = require('../shared/matchMonolithic.js');
         
         const updRes = await updateMatch(ws.matchId, async (matchObj) => {
             if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false };
             const player = matchObj.match.player.find(p => p.username === ws.username);
             if (!player || !player.armate || !player.armate[armyId]) return { save: false };
             
             const army = player.armate[armyId];
             
             if (army.status === 'in combattimento') {
                 army.status = 'standby';
                 delete army.targetName; delete army.targetCoords; delete army.missionMode; delete army.next_round_time;
                 return { save: true, matchObj, data: { action: 'combat_cancelled', army } };
             } else if (army.status === 'moving' || army.status === 'moving_to_border' || army.status === "Pronto all'attacco") {
                 const now = Date.now();
                 let elapsed = 0; let returnPath = []; let currentLng, currentLat;
                 if (army.path && army.path.length > 1 && army.startTime && army.etaMs) {
                     elapsed = now - army.startTime;
                     let progress = Math.max(0, Math.min(1, elapsed / army.etaMs));
                     if (progress < 1) {
                         let totalDistance = 0; const segmentDistances = [];
                         for (let i = 0; i < army.path.length - 1; i++) {
                            const dx = army.path[i+1][0] - army.path[i][0]; const dy = army.path[i+1][1] - army.path[i][1];
                            const dist = Math.sqrt(dx*dx + dy*dy); segmentDistances.push(dist); totalDistance += dist;
                         }
                         const targetDistance = progress * totalDistance;
                         let currentDist = 0; let currentIndex = 0; let segmentProgress = 0;
                         for (let i = 0; i < segmentDistances.length; i++) {
                            if (currentDist + segmentDistances[i] >= targetDistance || i === segmentDistances.length - 1) {
                               currentIndex = i; segmentProgress = segmentDistances[i] > 0 ? (targetDistance - currentDist) / segmentDistances[i] : 0; break;
                            }
                            currentDist += segmentDistances[i];
                         }
                         const p1 = army.path[currentIndex]; const p2 = army.path[currentIndex + 1] || p1;
                         currentLng = p1[0] + (p2[0] - p1[0]) * segmentProgress; currentLat = p1[1] + (p2[1] - p1[1]) * segmentProgress;
                         returnPath.push([currentLng, currentLat]);
                         for (let i = currentIndex; i >= 0; i--) returnPath.push(army.path[i]);
                     } else {
                         currentLng = army.path[army.path.length - 1][0]; currentLat = army.path[army.path.length - 1][1];
                         returnPath = [...army.path].reverse();
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
                     const db = require('../shared/postgresClient.js');
                     const mossaRes = await db.query(`SELECT id_mossa FROM mosse WHERE id_armata = $1 AND type_action = 'atk'`, [armyId]);
                     if (mossaRes.rows.length > 0) {
                         const id_mossa = mossaRes.rows[0].id_mossa;
                         await db.query(`DELETE FROM attacco WHERE id_mossa = $1`, [id_mossa]);
                         await db.query(`DELETE FROM mosse WHERE id_mossa = $1`, [id_mossa]);
                     }
                     ws.send(JSON.stringify({ type: 'MISSION_CANCELLED', payload: { armyId, newLocation: updRes.army.currentLocation } }));
                     const broadcastPayload = { matchId: ws.matchId, targetUsers: [userId], payload: { type: 'COMBAT_CANCELLED', data: { userId: ws.username, armyId: armyId } } };
                     await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
                 } catch(dbErr) { console.error("[SYS_ERR] Errore annullamento combattimento in DB:", dbErr); }
             } else if (updRes.action === 'aborted') {
                 ws.send(JSON.stringify({ type: 'MISSION_CANCELLED', payload: { armyId, newLocation: updRes.army.currentLocation } }));
             } else if (updRes.action === 'returning') {
                 const { army, now, returnEtaMs } = updRes;
                 const etaDate = new Date(now + returnEtaMs);
                 try {
                     const db = require('../shared/postgresClient.js');
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
                 } catch(dbErr) { console.error("[SYS_ERR] Errore aggiornamento movimento di ritorno in DB:", dbErr); }
                 const broadcastPayload = { matchId: ws.matchId, targetUsers: [userId], payload: { type: 'TROOPS_MOVED', data: { userId, armyId, targetName: army.targetName, targetCoords: army.targetCoords, etaMs: returnEtaMs, path: army.path, startTime: now } } };
                 await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
             }
         }
      }
      if (payload.action === 'BUILD_STRUCTURE') {
         console.log(`[WS_MATCH] Richiesta costruzione struttura ricevuta:`, payload.payload);
         const { structureId, targetName, targetCoords } = payload.payload;

         try {
             const { updateMatch } = require('../shared/matchMonolithic.js');
             
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

             const { getRegionIdByName } = require('./middleware/movementLogic.js');
             const regionId = getRegionIdByName(targetName);

             const updRes = await updateMatch(ws.matchId, async (matchObj) => {
                 if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false, data: { error: 'Partita non trovata' } };
                 if (!matchObj.match.struttura_partita || !matchObj.match.struttura_partita.startsWith('01')) {
                     return { save: false, data: { error: 'Costruzione non permessa: Partita non attiva' } };
                 }

                 const player = matchObj.match.player.find(p => p.username === ws.username);
                 if (!player || !player.territori || !player.territori.includes(regionId)) {
                     return { save: false, data: { error: 'Puoi costruire solo sui tuoi territori' } };
                 }

                 let strutture = player.strutture || [];
                 const existingIdx = strutture.findIndex(s => s.structureId.split('_t')[0] === baseName && (s.regionId === regionId || s.targetName === targetName));
                 let replacedStructureId = null;

                 if (existingIdx !== -1) {
                     const existingStructure = strutture[existingIdx];
                     if (reqPrevStructure) {
                         if (existingStructure.structureId !== reqPrevStructure) return { save: false, data: { error: `Devi prima costruire ${reqPrevStructure} in questa regione.` } };
                         replacedStructureId = existingStructure.id;
                     } else {
                         return { save: false, data: { error: 'Hai già costruito questo tipo di struttura in questa regione.' } };
                     }
                 } else {
                     if (reqPrevStructure) return { save: false, data: { error: `Devi prima costruire ${reqPrevStructure} in questa regione.` } };
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

                 const newStructure = {
                     id: require('crypto').randomUUID(),
                     structureId: structureId,
                     name: structureDetails.nome || structureDetails.name,
                     targetName: targetName,
                     regionId: regionId,
                     targetCoords: targetCoords,
                     status: 'built',
                     owner: ws.username,
                     buildTime: Date.now()
                 };

                 if (replacedStructureId) strutture = strutture.filter(s => s.id !== replacedStructureId);
                 strutture.push(newStructure);
                 player.strutture = strutture;
                 player.risorse = resources;

                 return { save: true, matchObj, data: { success: true, newStructure, replacedStructureId, resources } };
             });

             if (!updRes || updRes.error || (updRes.data && updRes.data.error)) {
                 const err = updRes ? (updRes.error || updRes.data.error) : 'Errore costruzione';
                 return ws.send(JSON.stringify({ type: 'ERROR', error: err }));
             }

             if (updRes.data && updRes.data.success) {
                 ws.send(JSON.stringify({ type: 'BUILD_SUCCESS', payload: updRes.data.newStructure, replacedStructureId: updRes.data.replacedStructureId }));
                 const broadcastPayload = {
                     matchId: ws.matchId,
                     targetUsers: [userId],
                     payload: { type: 'RESOURCES_UPDATED', data: { resources: translateRedisToFe(updRes.data.resources) } }
                 };
                 await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));

                 const broadcastStructurePayload = {
                     matchId: ws.matchId,
                     payload: { type: 'STRUCTURE_BUILT', data: updRes.data.newStructure, replacedStructureId: updRes.data.replacedStructureId }
                 };
                 await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastStructurePayload));
             }
         } catch (e) {
             console.error("[SYS_ERR] Errore in BUILD_STRUCTURE:", e);
             ws.send(JSON.stringify({ type: 'ERROR', error: 'Errore interno del server durante la costruzione' }));
         }
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
const startArrivalEngine = () => {
  setInterval(async () => {
    try {
      const db = require('../shared/postgresClient.js');
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

        const { getMatch, updateMatch } = require('../shared/matchMonolithic.js');
        const matchObj = await getMatch(row.match_id);
        if (!matchObj || !matchObj.match || !matchObj.match.player) continue;

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
            const { getRegionForNode } = require('./middleware/movementLogic.js');
            const regionId = getRegionForNode(row.target_node) || row.target_node;
            
            let targetNation = matchObj.match.player.find(n => n.territori_dict && Object.values(n.territori_dict).some(list => list.includes(regionId)));
            if (!targetNation && row.target_node !== regionId) {
                 targetNation = matchObj.match.player.find(n => n.territori_dict && Object.values(n.territori_dict).some(list => list.includes(row.target_node)));
            }

            if (targetNation && targetNation.username && targetNation.username !== row.username) {
                isEnemyTerritory = true;
            }

            if (army.missionMode === 'attack' || isEnemyTerritory) {
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
              targetUsers: [row.username],
              payload: {
                type: 'TROOPS_ARRIVED',
                payload: { armyId: row.id_armata }
              }
            };
            const redis = require('ioredis');
            const redisClient = new redis({ host: process.env.REDIS_HOST || 'redis', port: process.env.REDIS_PORT || 6379 });
            await redisClient.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
            redisClient.disconnect();
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
    const db = require("../shared/postgresClient.js");
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
      
      const redisKey = `match:${row.id_partita_hash}:player:${row.username}:armate`;
      const armateStr = await redis.get(redisKey);
      if (!armateStr) continue;

      let armateObj = JSON.parse(armateStr);
      if (!armateObj[row.id_armata]) continue;

      let army = armateObj[row.id_armata];
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
          } catch(err) {}
      }

      // Ricalcola il percorso
      try {
        const pathInfo = await calculatePath(startLng, startLat, row.target_node, row.x_dest, row.y_dest, multiplier);
        
        army.status = 'moving';
        army.targetCoords = `${row.x_dest},${row.y_dest}`;
        army.targetName = row.target_node;
        army.path = pathInfo.path;
        // missionMode potrebbe essere perso se non storicizzato in mosse, assumiamo 'move'
        army.missionMode = 'move';
        army.etaMs = pathInfo.etaMs;
        army.startTime = new Date(row.ttl).getTime() - pathInfo.etaMs;
        
        await redis.set(redisKey, JSON.stringify(armateObj));
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
    startArrivalEngine();
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
