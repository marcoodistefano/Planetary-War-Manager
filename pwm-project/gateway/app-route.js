const express = require("express");
const http = require("http");
const net = require("net");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const redisClient = require("./services/shared/redisClient.js");
const app = express();
const controller = require("./app-controller.js");

// 1. CONFIGURAZIONE TARGET E PORTE
// Ho separato i servizi HTTP da quelli WebSocket per massima chiarezza
const SERVICE_TARGETS = {
  user: process.env.AUTH_SERVICE_URL || "http://user-service:3000",
  match: process.env.MATCH_SERVICE_URL || "http://match-service:3004", 
  chat: process.env.CHAT_SERVICE_URL || "http://chat-service:3001",
  movement: process.env.MOVEMENT_SERVICE_URL || "http://movement-service:3002",
  combat: process.env.COMBAT_SERVICE_URL || "http://combat-service:3003",
};

const JWT_SECRET = process.env.JWT_SECRET || process.env.SECRET_KEY || "CHIAVE_SEGRETA_TEMPORANEA_SUPER_SICURA";

// 2. DEFINIZIONE ROTTE
const PUBLIC_PATHS = [
  "/health",
  "/login",
  "/recovery-password",
  "/registration",
  "/auth/login",
  "/auth/logout",
  "/auth/register",
  "/auth/login/recovery/password"
];

// 3. FUNZIONI DI SUPPORTO (Unrolled e Semplificate)

// Controlla se una rotta è pubblica esplorando l'array con un semplice loop
const isPublicPath = (pathname) => {
  for (let i = 0; i < PUBLIC_PATHS.length; i++) {
    const publicPath = PUBLIC_PATHS[i];
    if (pathname === publicPath || pathname.startsWith(publicPath + "/")) {
      return true;
    }
  }
  return false;
};

// Controlla ESATTAMENTE le 3 rotte che hai richiesto per i WebSocket
const isWebSocketRoute = (pathname) => {
  if (pathname.startsWith("/chat")) return true;
  if (pathname.startsWith("/movement")) return true;
  if (pathname.startsWith("/combat")) return true;
  return false;
};

// Verifica l'header dell'upgrade
const isWebSocketUpgrade = (req) => {
  const upgradeHeader = req.headers.upgrade;
  if (!upgradeHeader) return false;
  
  const headerLower = upgradeHeader.toLowerCase();
  if (headerLower === "websocket") return true;
  
  return false;
};

// Estrazione Cookie semplificata senza 'reduce'
const parseCookies = (cookieHeader) => {
  if (!cookieHeader) return {};

  const cookiesObj = {};
  const cookieParts = cookieHeader.split(";");

  for (let i = 0; i < cookieParts.length; i++) {
    const item = cookieParts[i].trim();
    const keyValue = item.split("=");
    const rawKey = keyValue[0];
    
    if (rawKey) {
      // Ricostruisce il valore nel caso contenga il simbolo '='
      const rawValue = keyValue.slice(1).join("=");
      cookiesObj[rawKey] = decodeURIComponent(rawValue || "");
    }
  }

  return cookiesObj;
};

// Estrazione token lineare passo-passo
const extractTokenFromRequest = (req) => {
  // Passaggio 1: Controllo Header Authorization
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    return token.trim();
  }

  // Passaggio 2: Controllo Cookie
  const cookieHeader = req.headers.cookie;
  const cookies = parseCookies(cookieHeader);
  if (cookies.auth_token) {
    return cookies.auth_token;
  }

  // Passaggio 3: Controllo parametri URL (Query String)
  const rawUrlString = req.url || req.originalUrl || "/";
  const parsedUrl = new URL(rawUrlString, "http://localhost");
  
  const tokenFromQuery = parsedUrl.searchParams.get("token");
  if (tokenFromQuery) return tokenFromQuery;

  const authTokenFromQuery = parsedUrl.searchParams.get("auth_token");
  if (authTokenFromQuery) return authTokenFromQuery;

  // Nessun token trovato
  return null;
};

// Validazione Token passo-passo
const validateSessionToken = async (token) => {
  if (!token) {
    return { ok: false, status: 401, error: "Token mancante" };
  }

  // 1. Verifica della firma matematica (JWT)
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return { ok: false, status: 401, error: "Token non valido o scaduto" };
  }

  // 2. Estrazione ID di sessione
  const sessionId = decoded.jti;
  if (!sessionId) {
    return { ok: false, status: 401, error: "Sessione mancante nel token" };
  }

  // 3. Verifica esistenza nel Database Redis
  const sessionKey = "session:" + sessionId;
  const sessionDataString = await redisClient.get(sessionKey);
  
  if (!sessionDataString) {
    return { ok: false, status: 401, error: "Sessione terminata o non valida" };
  }

  // 4. Parsing dei dati Redis
  let sessionData;
  try {
    sessionData = JSON.parse(sessionDataString);
  } catch (error) {
    sessionData = sessionDataString; // Fallback se non è JSON
  }

  return { ok: true, decoded: decoded, sessionId: sessionId, sessionData: sessionData };
};

// --- MIDDLEWARE EXPRESS ---
app.use(cors());

// Parse JSON solo se non è un WebSocket (che romperebbe lo stream)
app.use((req, res, next) => {
  const rawUrlString = req.url || "/";
  const parsedUrl = new URL(rawUrlString, "http://localhost");
  const pathname = parsedUrl.pathname;

  const isWsUpgrade = isWebSocketUpgrade(req);
  const isWsRoute = isWebSocketRoute(pathname);

  if (isWsUpgrade && isWsRoute) {
    // Salta il body parser per mantenere intatto il buffer TCP
    return next();
  } else {
    // Applica il body parser standard
    return express.json()(req, res, next);
  }
});

// 1. MIDDLEWARE: Normalizzazione
const normalizeRequest = async (req, res, next) => {
  if (req.path === "/health") return next();
  if (req.method === "OPTIONS") return res.sendStatus(204);

  try {
    const safeRequest = await controller.normalizePayload(req);
    if (!safeRequest.isValid) {
      return res.status(400).json(safeRequest.body);
    }
    
    req.safeRequest = safeRequest;
    return next();
  } catch (error) {
    console.error("Errore nel controller gateway:", error);
    return res.status(500).json({ error: "Errore interno del gateway" });
  }
};

// 2. MIDDLEWARE: Autenticazione Centrale
const requireJwt = async (req, res, next) => {
  const rawUrlString = req.originalUrl || "/";
  const parsedUrl = new URL(rawUrlString, "http://localhost");
  const pathname = parsedUrl.pathname;

  // Se la rotta è pubblica (login, register), passa oltre
  if (isPublicPath(pathname)) {
    return next();
  }

  // Altrimenti, esigi il JWT e verificalo
  const token = extractTokenFromRequest(req);
  const validation = await validateSessionToken(token);

  if (validation.ok === false) {
    console.warn("Accesso negato HTTP. Path:", pathname, "- Motivo:", validation.error);
    return res.status(validation.status).json({ error: validation.error });
  }

  // Salviamo i dati per i servizi a valle
  req.user = {
    uuid: validation.decoded.sub,
    sessionId: validation.sessionId,
    sessionData: validation.sessionData,
  };

  return next();
};

// 3. MIDDLEWARE: Inoltro HTTP
const forwardToService = async (req, res) => {
  if (req.path === "/health") return res.json({ status: "ok" });

  const routeGroup = req.safeRequest?.routeGroup; // es. "auth"
  let targetBaseUrl = null;

  if (routeGroup) {
    targetBaseUrl = SERVICE_TARGETS[routeGroup];
  }

  if (!targetBaseUrl) {
    return res.status(404).json({ error: "Microservizio non trovato per questa route" });
  }

  const rawUrlString = req.originalUrl;
  const targetUrl = new URL(rawUrlString, targetBaseUrl);

  // Prepariamo gli header sicuri
  const cleanHeaders = {};
  const badHeaders = ["connection", "content-length", "host", "keep-alive", "transfer-encoding", "upgrade"];
  
  const headerKeys = Object.keys(req.headers);
  for (let i = 0; i < headerKeys.length; i++) {
    const key = headerKeys[i];
    const lowerKey = key.toLowerCase();
    
    if (!badHeaders.includes(lowerKey)) {
      cleanHeaders[key] = req.headers[key];
    }
  }

  // ---> PATCH DI SICUREZZA: INIEZIONE IDENTITÀ (TRUSTED HEADERS) <---
  if (req.user) {
    // Trasmettiamo l'identità ai microservizi a valle tramite header custom
    cleanHeaders["x-user-id"] = req.user.uuid;
    cleanHeaders["x-session-id"] = req.user.sessionId;
  }

  const hasBody = req.safeRequest.body && Object.keys(req.safeRequest.body).length > 0;
  if (hasBody) {
    cleanHeaders["content-type"] = "application/json";
  }

  try {
    const fetchOptions = {
      method: req.method,
      headers: cleanHeaders
    };

    if (hasBody && req.method !== "GET" && req.method !== "HEAD") {
      fetchOptions.body = JSON.stringify(req.safeRequest.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const responsePayload = await response.text();

    // Copiamo gli header di risposta
    response.headers.forEach((value, key) => {
      if (!badHeaders.includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    return res.status(response.status).send(responsePayload);
  } catch (error) {
    console.error("Errore nel forwarding HTTP:", error);
    return res.status(502).json({ error: "Impossibile contattare il servizio di destinazione HTTP" });
  }
};

app.use(normalizeRequest);
app.use(requireJwt);
app.use(forwardToService);

// --- SEZIONE WEBSOCKET (LAYER 4 TCP) ---
const activeSockets = new Set();
const server = http.createServer(app);

const rejectUpgrade = (socket, message) => {
  const payload = JSON.stringify({ error: message });
  const responseString = 
    "HTTP/1.1 401 Unauthorized\r\n" +
    "Connection: close\r\n" +
    "Content-Type: application/json\r\n" +
    "Content-Length: " + Buffer.byteLength(payload) + "\r\n" +
    "\r\n" +
    payload;
  
  socket.write(responseString);
  socket.destroy();
};

server.on("upgrade", async (req, socket, head) => {
  // 1. Controllo base protocollo
  if (!isWebSocketUpgrade(req)) {
    return rejectUpgrade(socket, "Upgrade richiesto non valido");
  }

  // 2. Controllo rotta autorizzata
  const parsedUrl = new URL(req.url, "http://localhost");
  const pathname = parsedUrl.pathname;
  
  if (!isWebSocketRoute(pathname)) {
    return rejectUpgrade(socket, "Route non autorizzata per WebSocket. Usa /chat, /movement o /combat");
  }

  // 3. Validazione Sicurezza (Il JWT deve essere valido prima di aprire il tunnel)
  const token = extractTokenFromRequest(req);
  const validation = await validateSessionToken(token);
  
  if (validation.ok === false) {
    console.warn("Accesso negato WS. Path:", pathname, "- Motivo:", validation.error);
    return rejectUpgrade(socket, validation.error);
  }

  // 4. Determinazione del target basato sul path
  let targetBaseUrlStr = null;
  if (pathname.startsWith("/chat")) targetBaseUrlStr = SERVICE_TARGETS.chat;
  else if (pathname.startsWith("/movement")) targetBaseUrlStr = SERVICE_TARGETS.movement;
  else if (pathname.startsWith("/combat")) targetBaseUrlStr = SERVICE_TARGETS.combat;

  if (!targetBaseUrlStr) {
    return rejectUpgrade(socket, "Servizio WebSocket di destinazione sconosciuto");
  }

  // 5. Connessione Fisica TCP (Piping)
  const targetUrl = new URL(targetBaseUrlStr);
  const targetPort = targetUrl.port || 80;
  const targetHostName = targetUrl.hostname;
  const targetHostHeader = targetUrl.host;

  const targetSocket = net.connect(targetPort, targetHostName, () => {
    // Scrittura manuale della richiesta HTTP per il microservizio interno
    const requestLine = req.method + " " + req.url + " HTTP/1.1\r\n";
    let headerLines = "";
    
    // Passaggio degli header sicuri
    const headerKeys = Object.keys(req.headers);
    for (let i = 0; i < headerKeys.length; i++) {
      const key = headerKeys[i];
      if (key.toLowerCase() !== "host") {
        headerLines += key + ": " + req.headers[key] + "\r\n";
      }
    }
    
    headerLines += "Host: " + targetHostHeader + "\r\n";
    headerLines += "\r\n"; // Fine degli header

    targetSocket.write(requestLine + headerLines);
    if (head && head.length > 0) {
      targetSocket.write(head);
    }

    // Cablaggio bidirezionale completato
    socket.pipe(targetSocket);
    targetSocket.pipe(socket);
  });

  // Gestione error e cleanup
  activeSockets.add(socket);
  activeSockets.add(targetSocket);

  socket.on("close", () => activeSockets.delete(socket));
  targetSocket.on("close", () => activeSockets.delete(targetSocket));

  targetSocket.on("error", () => socket.destroy());
  socket.on("error", () => targetSocket.destroy());
});

// --- GESTIONE SHUTDOWN ---
const shutdown = (signal) => {
  console.log("Segnale", signal, "ricevuto. Chiusura del server HTTP...");
  server.close();

  console.log("Taglio le connessioni socket attive:", activeSockets.size);
  for (const socket of activeSockets) {
    try {
      socket.end();
      socket.destroy();
    } catch (e) {}
  }

  redisClient.quit();
  setTimeout(() => process.exit(0), 3000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

const PORT = parseInt(process.env.PORT || "3001", 10);
server.listen(PORT, () => console.log("Gateway attivo su porta", PORT));