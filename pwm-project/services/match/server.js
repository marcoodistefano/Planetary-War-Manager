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
const { calculatePath, getBorderIntersection } = require("./middleware/movementLogic.js");
const { startTroopGenerator } = require("./middleware/troopGenerator.js");
const { loadMinimumPathToRedis } = require("./middleware/loadPathToRedis.js");
const { startCombatLoop } = require("./middleware/combatLogic.js");
const Eru = require('./middleware/Eru.js');

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
         const keys = await redis.keys(`match:${ws.matchId}:player:*:armate`);
         let armies = [];
         for (const key of keys) {
            const armateStr = await redis.get(key);
            if (armateStr) {
               const playerId = key.split(':')[3];
               const armateObj = JSON.parse(armateStr);
               const playerArmies = Object.values(armateObj).map(a => ({...a, owner: playerId}));
               armies = armies.concat(playerArmies);
            }
         }

         const nationsStr = await redis.get(`match:${ws.matchId}:nations`);
         const nations = nationsStr ? JSON.parse(nationsStr) : [];

         ws.send(JSON.stringify({ type: 'INITIAL_STATE', payload: { armies, nations } }));
         return;
      }

      if (payload.action === 'SAVE_ARMIES') {
         // Sincronizza lo stato armate dal frontend (che invia un array)
         const dict = {};
         (payload.payload.armies || []).forEach(a => dict[a.id] = a);
         await redis.set(`match:${ws.matchId}:player:${ws.username}:armate`, JSON.stringify(dict));
         return;
      }

      if (payload.action === 'MOVE_TROOPS') {
         const { armyId, targetName, targetCoords } = payload.payload;
         const armateStr = await redis.get(`match:${ws.matchId}:player:${ws.username}:armate`);
         let armateObj = armateStr ? JSON.parse(armateStr) : {};
         
         if (!armateObj[armyId]) {
             ws.send(JSON.stringify({ type: 'ERROR', error: 'Armata non trovata' }));
             return;
         }
         
         // --- Parsing Coordinate ---
         let loc = armateObj[armyId].currentLocation;
         let startLng = 12.0, startLat = 41.0;
         if (loc && typeof loc === 'string') {
             const pts = loc.split(',').map(s => parseFloat(s.trim()));
             if (pts.length === 2) { startLng = pts[0]; startLat = pts[1]; }
         } else if (loc && loc.x !== undefined && loc.y !== undefined) {
             startLng = loc.x; startLat = loc.y;
         }
         
         let targetLng = 12.0, targetLat = 41.0;
         if (typeof targetCoords === 'string') {
             const pts = targetCoords.split(',').map(s => parseFloat(s.trim()));
             if (pts.length === 2) { targetLng = pts[0]; targetLat = pts[1]; }
         }

          let multiplier = 1;
          try {
              const matchDataRaw = await redis.get(`match:${ws.matchId}`);
              if (matchDataRaw) {
                  const matchObj = JSON.parse(matchDataRaw);
                  if (matchObj.struttura_partita) {
                      const decodedMatch = Eru.decode_match(matchObj.struttura_partita);
                      multiplier = decodedMatch.multiplierValue || 1;
                  }
              }
          } catch(err) {
              console.error("[SYS_WARN] Impossibile ottenere il moltiplicatore:", err);
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

          // Check war status / attack
          try {
              const nationsCache = await redis.get(`match:${ws.matchId}:nations`);
              if (nationsCache) {
                  const nations = JSON.parse(nationsCache);
                  const targetNation = nations.find(n => n.territories_flat && n.territories_flat.includes(targetName));
                  if (targetNation && targetNation.isOccupied && targetNation.playerId && targetNation.playerId !== ws.username && !targetNation.playerId.includes('bot')) {
                      isAttack = true;
                      targetPlayerId = targetNation.playerId;
                      // Controllo se sono già in guerra (MVP assume boolean globale o check basico)
                      // Idealmente qui andrebbe un check su `relazioni_diplomatiche`
                      isInWar = targetNation.inWar === true;
                  }
              }
          } catch (e) {
              console.error("Errore in validazione attacco:", e);
          }

          if (isAttack && !isInWar && pathInfo.path.length > 0) {
              const borderInfo = getBorderIntersection(pathInfo.path, targetName);
              if (borderInfo) {
                  // Calcola ETA parziale al confine
                  const speedMultiplier = pathInfo.etaMs / pathInfo.distance;
                  borderEtaMs = Math.floor(borderInfo.distanceToBorder * speedMultiplier);
                  armateObj[armyId].status = 'moving_to_border';
              } else {
                  armateObj[armyId].status = "Pronto all'attacco";
              }
          } else if (isAttack && isInWar) {
              armateObj[armyId].status = "Pronto all'attacco";
          } else {
              armateObj[armyId].status = 'moving';
          }

          armateObj[armyId].targetCoords = targetCoords;
          armateObj[armyId].targetName = targetName;
          armateObj[armyId].missionMode = payload.payload.mode;
          armateObj[armyId].path = pathInfo.path;
          armateObj[armyId].startTime = Date.now();
          armateObj[armyId].etaMs = pathInfo.etaMs;
          
          // Salva su Redis sovrascrivendo l'eventuale mossa vecchia
          await redis.set(`match:${ws.matchId}:player:${ws.username}:armate`, JSON.stringify(armateObj));
         
         // Inserimento o aggiornamento in DB (PostgreSQL)
         try {
             const db = require('../shared/postgresClient.js');
             // Cerca mossa esistente
             const mossaRes = await db.query(
                `SELECT id_mossa FROM mosse WHERE id_armata = $1 AND type_action = 'mov'`, 
                [armyId]
             );

             const etaDate = new Date(Date.now() + borderEtaMs);

             if (mossaRes.rows.length > 0) {
                 const id_mossa = mossaRes.rows[0].id_mossa;
                 // Aggiorna lo spostamento in db (cancella i vecchi e ricrea o aggiorna)
                 await db.query(`DELETE FROM spostamenti WHERE id_mossa = $1`, [id_mossa]);
                 await db.query(`UPDATE mosse SET ttl = $1 WHERE id_mossa = $2`, [etaDate, id_mossa]);
                 await db.query(
                     `INSERT INTO spostamenti (id_mossa, numero_coda, x_dest, y_dest, target_node, time_to_arrive) VALUES ($1, 1, $2, $3, $4, $5)`,
                     [id_mossa, targetLng, targetLat, targetName, etaDate]
                 );
             } else {
                 // Estrai la partita id associata al matchId visualizzato
                 const partitaRes = await db.query(`SELECT id_partita FROM partite WHERE id_partita_hash = $1`, [ws.matchId]);
                 if (partitaRes.rows.length > 0) {
                     const partitaId = partitaRes.rows[0].id_partita;
                     const insertMossa = await db.query(
                         `INSERT INTO mosse (user_id, partita_id, type_action, id_armata, ttl) VALUES ((SELECT id_user FROM utenti WHERE username=$1), $2, 'mov', $3, $4) RETURNING id_mossa`,
                         [ws.username, partitaId, armyId, etaDate]
                     );
                     const newIdMossa = insertMossa.rows[0].id_mossa;
                     await db.query(
                         `INSERT INTO spostamenti (id_mossa, numero_coda, x_dest, y_dest, target_node, time_to_arrive) VALUES ($1, 1, $2, $3, $4, $5)`,
                         [newIdMossa, targetLng, targetLat, targetName, etaDate]
                     );
                 }
             }
         } catch(dbErr) {
             console.error("[SYS_ERR] Errore salvataggio movimento in DB:", dbErr);
         }

         // Notifica a tutti i giocatori del match (Broadcast)
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
               startTime: armateObj[armyId].startTime
             }
           }
         };
         await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
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
      let startLng = 12.0, startLat = 41.0;
      if (typeof army.currentLocation === 'string') {
        const pts = army.currentLocation.split(',').map(s => parseFloat(s.trim()));
        if (pts.length === 2) { startLng = pts[0]; startLat = pts[1]; }
      } else if (army.currentLocation && army.currentLocation.x !== undefined) {
        startLng = army.currentLocation.x;
        startLat = army.currentLocation.y;
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
        army.startTime = new Date(row.time_to_arrive).getTime() - pathInfo.etaMs;
        
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
