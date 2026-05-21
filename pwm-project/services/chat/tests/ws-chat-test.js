const WebSocket = require("ws");
const db = require("../../shared/postgresClient.js");

const baseUrl = process.env.GATEWAY_URL || "http://localhost";
const matchId = process.env.MATCH_ID || "	rotyYaAEri";
const authToken = process.env.AUTH_TOKEN;
const destinatario = process.env.DESTINATARIO || "ALL";
const tipoRaw = process.env.TIPO || (destinatario === "ALL" ? "2" : "0");
const content = process.env.CONTENT || `test-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const wsTimeoutMs = toInt(process.env.WS_TIMEOUT_MS, 10000);
const dbTimeoutMs = toInt(process.env.DB_TIMEOUT_MS, 10000);
const dbPollMs = toInt(process.env.DB_POLL_MS, 300);
const checkHistory = ["1", "true", "yes"].includes(String(process.env.CHECK_HISTORY || "").toLowerCase());

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const decodeJwtPayload = (token) => {
  if (!token) return null;
  const raw = token.replace(/^Bearer\s+/i, "");
  const parts = raw.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(payload);
  } catch (error) {
    return null;
  }
};

const resolveUserIdFromToken = (token) => {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return payload.sub || payload.id_user || payload.userId || payload.id || null;
};

const waitForMessage = (ws, { timeoutMs, content: expectedContent }) => new Promise((resolve, reject) => {
  const cleanup = () => {
    clearTimeout(timer);
    ws.removeListener("message", onMessage);
    ws.removeListener("error", onError);
  };

  const timer = setTimeout(() => {
    cleanup();
    reject(new Error("Timeout waiting for WS message"));
  }, timeoutMs);

  const onMessage = (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (error) {
      return;
    }

    if (data?.type === "ERROR") {
      cleanup();
      reject(new Error(data.error || "WS error"));
      return;
    }

    if (data?.type === "NEW_MESSAGE" && data?.data?.content === expectedContent) {
      cleanup();
      resolve(data);
    }
  };

  const onError = (error) => {
    cleanup();
    reject(error);
  };

  ws.on("message", onMessage);
  ws.on("error", onError);
});

const waitForDbInsert = async ({ idMex, matchId, userId, content: expectedContent }) => {
  const started = Date.now();

  while (Date.now() - started < dbTimeoutMs) {
    let row = null;

    if (idMex) {
      const result = await db.query(
        "SELECT id_mex, id_user_send, id_partita, content, time_stamp FROM messaggi WHERE id_mex = $1",
        [idMex],
      );
      row = result.rows[0] || null;
    } else if (matchId && expectedContent) {
      const params = [matchId, expectedContent];
      let query = "SELECT id_mex, id_user_send, id_partita, content, time_stamp FROM messaggi WHERE id_partita = $1 AND content = $2";
      if (userId) {
        params.push(userId);
        query += " AND id_user_send = $3";
      }
      query += " ORDER BY time_stamp DESC LIMIT 1";
      const result = await db.query(query, params);
      row = result.rows[0] || null;
    }

    if (row) {
      const matchesUser = userId ? String(row.id_user_send) === String(userId) : true;
      const matchesMatch = matchId ? String(row.id_partita) === String(matchId) : true;
      const matchesContent = expectedContent ? row.content === expectedContent : true;

      if (matchesUser && matchesMatch && matchesContent) {
        return row;
      }
    }

    await sleep(dbPollMs);
  }

  return null;
};

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
    wsMessage = await waitForMessage(ws, { timeoutMs: wsTimeoutMs, content });
    console.log("[TEST] WS message received:", wsMessage);
  } catch (error) {
    console.error("[TEST] WS error:", error.message);
    ws.close();
    await db.end().catch(() => undefined);
    process.exit(1);
  }

  try {
    if (checkHistory) {
      const history = await fetchHistory();
      const items = Array.isArray(history.items) ? history.items : [];
      const found = items.some((item) => item && item.content === content);
      console.log("[TEST] History contains message:", found);
      if (!found) {
        throw new Error("History missing message");
      }
    }

    const wsData = wsMessage?.data || {};
    const messageId = wsData.id_mex || null;
    const messageMatchId = wsData.id_partita || matchId;
    const messageUserId = wsData.id_user_send || resolveUserIdFromToken(authToken);

    if (!messageId && !(messageMatchId && content)) {
      throw new Error("Missing identifiers for DB validation");
    }

    console.log("[TEST] Waiting for DB insert...");
    const row = await waitForDbInsert({
      idMex: messageId,
      matchId: messageMatchId,
      userId: messageUserId,
      content,
    });

    if (!row) {
      throw new Error("DB insert not found for test message");
    }

    console.log("[TEST] DB insert verified:", {
      id_mex: row.id_mex,
      id_user_send: row.id_user_send,
      id_partita: row.id_partita,
    });
  } catch (error) {
    console.error("[TEST] Validation error:", error.message);
    ws.close();
    await db.end().catch(() => undefined);
    process.exit(1);
  }

  ws.close();
  await db.end().catch(() => undefined);
  process.exit(0);
};

run().catch((error) => {
  console.error("[TEST] Fatal error:", error.message);
  process.exit(1);
});
