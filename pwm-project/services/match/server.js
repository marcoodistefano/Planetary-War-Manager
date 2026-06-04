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
const { calculatePath } = require("./middleware/movementLogic.js");
const { startTroopGenerator } = require("./middleware/troopGenerator.js");

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
         const armateStr = await redis.get(`match:${ws.matchId}:player:${ws.username}:armate`);
         const armateObj = armateStr ? JSON.parse(armateStr) : {};
         const armies = Object.values(armateObj);

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
         
         // TODO: Leggere dal file ETOPO reale in futuro
         let loc = armateObj[armyId].currentLocation;
         let startCoords = '12.000, 41.000';
         if (loc && typeof loc === 'string') startCoords = loc;
         else if (loc && loc.x !== undefined && loc.y !== undefined) startCoords = `${loc.x}, ${loc.y}`;
         
         const pathInfo = calculatePath(startCoords, targetCoords);
         
         armateObj[armyId].status = 'moving';
         armateObj[armyId].targetCoords = targetCoords;
         armateObj[armyId].targetName = targetName;
         armateObj[armyId].missionMode = payload.payload.mode;
         
         // Salva su Redis
         await redis.set(`match:${ws.matchId}:player:${ws.username}:armate`, JSON.stringify(armateObj));
         
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
               etaMs: pathInfo.etaMs
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

server.listen(PORT, () => {
  console.log(`[SYSTEM] Microservizio MATCH operativo su porta ${PORT} (HTTP + WS)`);
  // Avvio generatore automatico di truppe (differito)
  startTroopGenerator();
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
