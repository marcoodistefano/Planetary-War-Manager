const express = require("express");
const http = require("http");
const cors = require("cors");
const { WebSocketServer } = require("ws");
const redisClient = require("../shared/redisClient.js");
const { getAuthContextFromRequest } = require("../shared/authContext.js");
const chatModel = require("./models/chatModel.js");
const { initDispatcher } = require("./Dispatcher/webDispatcher.js");

// Importazione corretta delle rotte (Write-Path HTTP)
const chatRoutes = require("./routes/chat.routes.js");

// ============================================================================
// 1. INIZIALIZZAZIONE LAYER 7 (HTTP REST)
// ============================================================================
const app = express();

app.use(cors());
app.use(express.json()); // Body parser per i payload delle POST

// Sonda diagnostica per il Gateway/Load Balancer
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Montaggio del bus HTTP
// Nota: Il Gateway inoltra la richiesta mantenendo il path, es: "/chat/message"
app.use(chatRoutes);

// ============================================================================
// 2. CREAZIONE DEL MOTORE FISICO (Server HTTP Crudo)
// ============================================================================
// Separiamo il server HTTP dal framework Express per poter intercettare
// gli eventi di rete a basso livello.
const server = http.createServer(app);

// ============================================================================
// 3. INIZIALIZZAZIONE LAYER 4 (TUNNEL TCP / WEBSOCKET)
// ============================================================================
// noServer: true indica che non intercetterà tutto il traffico, ma solo quello
// che noi gli diremo esplicitamente di processare.
const wss = new WebSocketServer({ noServer: true });

// Mappa in RAM per tenere traccia dei socket aperti.
// Struttura: Map<UserId, Set<WebSocket>> (Supporta multi-device per utente)
const clientSockets = new Map();

const extractMatchId = (rawUrl) => {
  const parsed = new URL(rawUrl || "/", "http://localhost");
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts[0] !== "chat") return null;
  if (parts[1]) return parts[1];
  return parsed.searchParams.get("matchId") || parsed.searchParams.get("id_partita");
};

wss.on("connection", async (ws, req, userId, rawMatchId) => {
  try {
    const authResult = await chatModel.authorizeWsConnection({
      userId,
      matchId: rawMatchId,
    });

    if (!authResult.ok) {
      ws.close(1008, authResult.error || "Accesso negato");
      return;
    }

    ws.userId = userId;
    ws.matchId = authResult.matchId;

    console.log(`[WS] Link TCP stabilito per l'utente: ${userId} (match ${ws.matchId})`);

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

      const payloadMatchId = ws.matchId || payload.matchId || payload.id_partita;

      try {
        const result = await chatModel.processMessage({
          userId: ws.userId,
          matchId: payloadMatchId,
          destinatario: payload.destinatario,
          tipo: payload.tipo,
          content: payload.content || payload.message || payload.text,
        });

        if (!result.ok) {
          ws.send(JSON.stringify({ type: "ERROR", error: result.error }));
        }
      } catch (error) {
        console.error("[SYS_ERR] WS message error:", error);
        ws.send(JSON.stringify({ type: "ERROR", error: "Errore interno" }));
      }
    });

    ws.on("close", () => {
      console.log(`[WS] Link TCP interrotto per l'utente: ${userId}`);
      const userSockets = clientSockets.get(userId);
      if (userSockets) {
        userSockets.delete(ws);
        if (userSockets.size === 0) {
          clientSockets.delete(userId);
        }
      }
    });
  } catch (error) {
    console.error("[SYS_ERR] WS init error:", error);
    ws.close(1011, "Errore interno");
  }
});

// ============================================================================
// 4. DEMULTIPLEXER E SECURITY (Intercettazione Upgrade)
// ============================================================================
server.on("upgrade", async (request, socket, head) => {
  try {
    const auth = await getAuthContextFromRequest(request);
    if (!auth.ok) {
      console.warn("[SECURITY] Tentativo di tunnel WS rifiutato:", auth.error);
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
    console.error("[SYS_ERR] WS upgrade error:", error);
    socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
    socket.destroy();
  }
});

// ============================================================================
// 5. ACCENSIONE DEL SISTEMA E GRACEFUL SHUTDOWN
// ============================================================================
const PORT = parseInt(process.env.PORT || "3001", 10);

server.listen(PORT, () => {
  console.log(`[SYSTEM] Microservizio CHAT operativo su porta ${PORT} (HTTP + WS)`);
});

initDispatcher(clientSockets).catch((error) => {
  console.error("[SYS_ERR] Impossibile avviare il WS dispatcher:", error);
});

// Esportiamo la Mappa dei Socket nel caso in cui i tuoi Worker/Controller 
// debbano importarla per inviare messaggi push (es. clientSockets.get(targetId).forEach(ws => ws.send(...)))
module.exports = { clientSockets };

// Gestione corretta dello spegnimento (SIGTERM generato da Docker)
process.on("SIGTERM", () => {
  console.log("[SYSTEM] Ricevuto segnale di shutdown. Chiusura dei circuiti...");
  
  // Chiude tutti i tunnel WebSocket in modo pulito per evitare ghost sockets
  wss.clients.forEach((client) => {
    client.close();
  });
  
  server.close(() => {
    console.log("[SYSTEM] Server arrestato in modo sicuro.");
    process.exit(0);
  });
});