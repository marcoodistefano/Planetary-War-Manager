const WebSocket = require("ws");

const baseUrl = process.env.GATEWAY_URL || "http://localhost";
const matchId = process.env.MATCH_ID;
const authToken = process.env.AUTH_TOKEN;
const destinatario = process.env.DESTINATARIO || "ALL";
const tipoRaw = process.env.TIPO || (destinatario === "ALL" ? "2" : "0");
const content = process.env.CONTENT || `test-${Date.now()}`;

const tipo = Number.parseInt(tipoRaw, 10);
const wsUrl = baseUrl.replace(/^http/, "ws") + `/chat/${matchId}`;

const requiredEnv = [
  { key: "MATCH_ID", value: matchId },
  { key: "AUTH_TOKEN", value: authToken },
];

for (const entry of requiredEnv) {
  if (!entry.value) {
    console.error(`[TEST] Missing env: ${entry.key}`);
    process.exit(1);
  }
}

const authHeader = `Bearer ${authToken}`;

const payload = {
  tipo,
  destinatario,
  content,
};

const waitForMessage = (ws, timeoutMs) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    reject(new Error("Timeout waiting for WS message"));
  }, timeoutMs);

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());
      resolve(data);
    } catch (error) {
      resolve({ raw: message.toString() });
    } finally {
      clearTimeout(timer);
    }
  });

  ws.on("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
});

const fetchHistory = async () => {
  const historyUrl = new URL("/chat/history", baseUrl);
  historyUrl.searchParams.set("matchId", matchId);
  historyUrl.searchParams.set("tipo", String(tipo));
  historyUrl.searchParams.set("destinatario", destinatario);

  const response = await fetch(historyUrl.toString(), {
    headers: { Authorization: authHeader },
  });

  if (!response.ok) {
    throw new Error(`History request failed: ${response.status}`);
  }

  return await response.json();
};

const run = async () => {
  console.log("[TEST] Connecting to", wsUrl);

  const ws = new WebSocket(wsUrl, {
    headers: { Authorization: authHeader },
  });

  ws.on("open", () => {
    console.log("[TEST] WS open, sending payload");
    ws.send(JSON.stringify(payload));
  });

  let wsMessage;
  try {
    wsMessage = await waitForMessage(ws, 10000);
    console.log("[TEST] WS message received:", wsMessage);
  } catch (error) {
    console.error("[TEST] WS error:", error.message);
  }

  try {
    const history = await fetchHistory();
    const items = Array.isArray(history.items) ? history.items : [];
    const found = items.some((item) => item && item.content === content);
    console.log("[TEST] History contains message:", found);
    ws.close();

    if (!found) {
      process.exit(1);
    }
  } catch (error) {
    ws.close();
    console.error("[TEST] History error:", error.message);
    process.exit(1);
  }

  process.exit(0);
};

run().catch((error) => {
  console.error("[TEST] Fatal error:", error.message);
  process.exit(1);
});
