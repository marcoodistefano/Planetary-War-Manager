const crypto = require("crypto");
const db = require("../../shared/postgresClient.js");
const redisClient = require("../../shared/redisClient.js");

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const TTL_SECONDS = toInt(process.env.CHAT_TTL_SECONDS, 86400);
const CACHE_TTL_SECONDS = toInt(process.env.CHAT_CACHE_TTL_SECONDS, 3600);
const MAX_MESSAGES = toInt(process.env.CHAT_MAX_MESSAGES, 500);
const MAX_BYTES = toInt(process.env.CHAT_MAX_BYTES, 5 * 1024 * 1024);
const MAX_MESSAGE_LENGTH = toInt(process.env.CHAT_MAX_MESSAGE_LENGTH, 2000);
const RATE_LIMIT_PER_SEC = toInt(process.env.CHAT_RATE_LIMIT_PER_SEC, 5);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const WS_CHANNEL = "ws_broadcast_channel";

const LUA_PUSH_AND_TRIM = `
local listKey = KEYS[1]
local bytesKey = KEYS[2]
local payload = ARGV[1]
local maxMessages = tonumber(ARGV[2])
local maxBytes = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

redis.call("RPUSH", listKey, payload)
redis.call("EXPIRE", listKey, ttl)

local bytes = tonumber(redis.call("GET", bytesKey) or "0")
bytes = bytes + string.len(payload)
redis.call("SET", bytesKey, bytes)
redis.call("EXPIRE", bytesKey, ttl)

local len = redis.call("LLEN", listKey)
while len > maxMessages do
  local removed = redis.call("LPOP", listKey)
  if removed then
    bytes = bytes - string.len(removed)
  end
  len = len - 1
end

while bytes > maxBytes do
  local removed = redis.call("LPOP", listKey)
  if not removed then
    break
  end
  bytes = bytes - string.len(removed)
end

redis.call("SET", bytesKey, bytes)
return len
`;

const normalizeTipo = (tipo) => {
  if (
    tipo === 1 ||
    tipo === "1" ||
    tipo === "alleanza" ||
    tipo === "alliance"
  ) {
    return { code: 1, label: "alleanza" };
  }
  if (tipo === 2 || tipo === "2" || tipo === "globale" || tipo === "global") {
    return { code: 2, label: "globale" };
  }
  return { code: 0, label: "privata" };
};

const buildChatListKey = ({
  matchId,
  tipoCode,
  destinatario,
  senderId,
  recipientId,
}) => {
  if (tipoCode === 2) {
    return `chat:match:${matchId}:global`;
  }
  if (tipoCode === 1) {
    return `chat:match:${matchId}:alliance:${destinatario}`;
  }
  const ids = [String(senderId), String(recipientId)].sort();
  return `chat:match:${matchId}:direct:${ids[0]}:${ids[1]}`;
};

const resolveMatchId = async (matchId) => {
  if (!matchId) return null;
  const cacheKey = `user_session:match_unito${matchId}`;
  const cached = await redisClient.get(cacheKey);
  if (cached) return cached;

  const { rows } = await db.query(
    "SELECT id_partita FROM partite WHERE id_partita_visualizzato = $1 LIMIT 1",
    [matchId],
  );

  const resolved = rows[0]?.id_partita;
  if (!resolved) return null;

  await redisClient.setEx(cacheKey, CACHE_TTL_SECONDS, resolved);
  if (String(resolved) !== String(matchId)) {
    await redisClient.setEx(
      `chat:match:alias:${resolved}`,
      CACHE_TTL_SECONDS,
      resolved,
    );
  }
  return resolved;
};

const ensureUserInMatch = async ({ userId, matchId }) => {
  if (!userId || !matchId) return false;
  const participantsKey = `running_match:${matchId}:participants`;

  const isMember = await redisClient.sIsMember(participantsKey, userId);
  if (isMember) return true;

  const hasCache = await redisClient.exists(participantsKey);
  if (hasCache) {
    const { rows } = await db.query(
      "SELECT 1 FROM partecipanti_partite WHERE partita_id = (SELECT id_partita FROM partite WHERE id_partita_visualizzato = $1) AND user_id = $2",
      [matchId, userId],
    );
    if (rows.length > 0) {
      await redisClient.sAdd(participantsKey, userId);
      return true;
    }
    return false;
  }

  const { rows } = await db.query(
    "SELECT user_id FROM partecipanti_partite WHERE partita_id = (SELECT id_partita FROM partite WHERE id_partita_visualizzato = $1) ",
    [matchId],
  );

  if (rows.length === 0) return false;
  const members = rows.map((row) => row.user_id);
  const multi = redisClient.multi();
  multi.sAdd(participantsKey, members);
  multi.expire(participantsKey, CACHE_TTL_SECONDS);
  await multi.exec();
  return members.includes(userId);
};

const getParticipants = async (matchId) => {
  const participantsKey = `running_match:${matchId}:participants`;
  const hasCache = await redisClient.exists(participantsKey);
  if (hasCache) {
    return await redisClient.sMembers(participantsKey);
  }

  const { rows } = await db.query(
    "SELECT user_id FROM partecipanti_partite WHERE partita_id = (SELECT id_partita FROM partite WHERE id_partita_visualizzato = $1) ",
    [matchId],
  );
  const members = rows.map((row) => row.user_id);
  if (members.length === 0) return [];

  const multi = redisClient.multi();
  multi.sAdd(participantsKey, members);
  multi.expire(participantsKey, CACHE_TTL_SECONDS);
  await multi.exec();
  return members;
};

const getAllianceMembers = async (matchId, allianceId) => {
  const cacheKey = `match:${matchId}:alliance:${allianceId}:members`;
  const hasCache = await redisClient.exists(cacheKey);
  if (hasCache) {
    return await redisClient.sMembers(cacheKey);
  }

  const { rows } = await db.query(
    "SELECT user_id FROM partecipanti_partite WHERE partita_id = (SELECT id_partita FROM partite WHERE id_partita_visualizzato = $1) AND id_alleanza = $2",
    [matchId, allianceId],
  );
  const members = rows.map((row) => row.user_id);
  if (members.length === 0) return [];

  const multi = redisClient.multi();
  multi.sAdd(cacheKey, members);
  multi.expire(cacheKey, CACHE_TTL_SECONDS);
  await multi.exec();
  return members;
};

const resolveUserIdByUsername = async (matchId, username) => {
  if (!username) return null;
  const normalized = String(username).trim();
  if (!normalized) return null;

  const cacheKey = `chat:match:${matchId}:user:by-username:${normalized.toLowerCase()}`;
  const cached = await redisClient.get(cacheKey);
  if (cached) return cached;

  const { rows } = await db.query(
    "SELECT u.id_user FROM utenti u INNER JOIN partecipanti_partite p ON p.user_id = u.id_user WHERE u.username = $1 AND p.partita_id = (SELECT id_partita FROM partite WHERE id_partita_visualizzato = $2) LIMIT 1",
    [normalized, matchId],
  );

  const userId = rows[0]?.id_user || null;
  if (userId) {
    await redisClient.setEx(cacheKey, CACHE_TTL_SECONDS, userId);
  }

  return userId;
};

const resolveUsernameByUserId = async (userId) => {
  if (!userId) return null;

  const cacheKey = `chat:user:by-id:${String(userId).trim()}`;
  const cached = await redisClient.get(cacheKey);
  if (cached) return cached;

  const { rows } = await db.query(
    "SELECT username FROM utenti WHERE id_user = $1 LIMIT 1",
    [userId],
  );

  const username = rows[0]?.username || null;
  if (username) {
    await redisClient.setEx(cacheKey, CACHE_TTL_SECONDS, username);
  }

  return username;
};

const rateLimitUser = async (userId, matchId) => {
  const rateKey = `chat:rate:${matchId}:${userId}`;
  const count = await redisClient.incr(rateKey);
  if (count === 1) {
    await redisClient.expire(rateKey, 1);
  }
  return count <= RATE_LIMIT_PER_SEC;
};

const storeMessageInRedis = async (listKey, message) => {
  const bytesKey = `${listKey}:bytes`;
  const payload = JSON.stringify(message);
  await redisClient.eval(LUA_PUSH_AND_TRIM, {
    keys: [listKey, bytesKey],
    arguments: [
      payload,
      String(MAX_MESSAGES),
      String(MAX_BYTES),
      String(TTL_SECONDS),
    ],
  });
};

const publishMessage = async ({ matchId, targetUsers, payload }) => {
  if (!Array.isArray(targetUsers) || targetUsers.length === 0) return;
  await redisClient.publish(
    WS_CHANNEL,
    JSON.stringify({ matchId, targetUsers, payload }),
  );
};

const persistMessage = async ({
  idMex,
  userId,
  matchId,
  content,
  timestamp,
  tipoLabel,
  recipients,
}) => {
  const client = await db.connect();
  const uniqueRecipients = [...new Set(recipients)].filter(Boolean);

  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO messaggi (id_mex, id_user_send, id_partita, content, time_stamp) VALUES ($1, $2, (SELECT id_partita FROM partite WHERE id_partita_visualizzato = $3), $4, $5);"[
        (idMex, userId, matchId, content, timestamp)
      ],
    );

    if (uniqueRecipients.length > 0) {
      await client.query(
        "INSERT INTO chat (id_mex, id_user_receiver, tipo_chat) SELECT $1, UNNEST($2::uuid[]), $3 ON CONFLICT DO NOTHING",
        [idMex, uniqueRecipients, tipoLabel],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const persistMessageAsync = (payload) => {
  setImmediate(async () => {
    try {
      await persistMessage(payload);
    } catch (error) {
      console.error("[SYS_ERR] Persistenza messaggio fallita:", error);
    }
  });
};

const resolveRecipients = async ({
  matchId,
  tipoCode,
  destinatario,
  senderId,
}) => {
  if (tipoCode === 2) {
    const participants = await getParticipants(matchId);
    if (participants.length === 0) {
      return { ok: false, status: 404, error: "Nessun partecipante trovato" };
    }
    const uniqueParticipants = [...new Set(participants)];
    if (!uniqueParticipants.includes(senderId)) {
      uniqueParticipants.push(senderId);
    }
    return {
      ok: true,
      recipients: uniqueParticipants,
      dbRecipients: uniqueParticipants.filter((id) => id !== senderId),
    };
  }

  if (tipoCode === 1) {
    const members = await getAllianceMembers(matchId, destinatario);
    if (members.length === 0) {
      return { ok: false, status: 404, error: "Alleanza non valida o vuota" };
    }
    const uniqueMembers = [...new Set(members)];
    if (!uniqueMembers.includes(senderId)) {
      return {
        ok: false,
        status: 403,
        error: "Utente non appartenente all'alleanza",
      };
    }
    return {
      ok: true,
      recipients: uniqueMembers,
      dbRecipients: uniqueMembers.filter((id) => id !== senderId),
    };
  }

  const recipientId = await resolveUserIdByUsername(matchId, destinatario);
  if (!recipientId) {
    return { ok: false, status: 404, error: "Destinatario non valido" };
  }

  const recipients = [senderId, recipientId];
  return {
    ok: true,
    recipients: [...new Set(recipients)],
    dbRecipients: [recipientId],
    recipientId,
  };
};

const processMessage = async ({
  userId,
  matchId,
  content,
  destinatario,
  tipo,
}) => {
  if (!userId) {
    return { ok: false, status: 401, error: "Identita mancante" };
  }

  const resolvedMatchId = await resolveMatchId(matchId);
  if (!resolvedMatchId) {
    return { ok: false, status: 404, error: "Partita non trovata" };
  }

  const text = String(content ?? "").trim();
  if (!text) {
    return { ok: false, status: 400, error: "Messaggio vuoto" };
  }

  if (Buffer.byteLength(text, "utf8") > MAX_MESSAGE_LENGTH) {
    return { ok: false, status: 413, error: "Messaggio troppo lungo" };
  }

  const tipoInfo = normalizeTipo(tipo);
  let destinatarioValue = destinatario;

  if (tipoInfo.code === 2) {
    destinatarioValue = "ALL";
  }

  if (typeof destinatarioValue === "string") {
    destinatarioValue = destinatarioValue.trim();
  }

  if (
    tipoInfo.code !== 2 &&
    (!destinatarioValue || String(destinatarioValue).trim() === "")
  ) {
    return { ok: false, status: 400, error: "Destinatario mancante" };
  }

  const isMember = await ensureUserInMatch({
    userId,
    matchId: resolvedMatchId,
  });
  if (!isMember) {
    return { ok: false, status: 403, error: "Utente non in partita" };
  }

  const allowed = await rateLimitUser(userId, resolvedMatchId);
  if (!allowed) {
    return { ok: false, status: 429, error: "Troppi messaggi inviati" };
  }

  const recipientsResult = await resolveRecipients({
    matchId: resolvedMatchId,
    tipoCode: tipoInfo.code,
    destinatario: destinatarioValue,
    senderId: userId,
  });

  if (!recipientsResult.ok) {
    return recipientsResult;
  }

  const { recipients, dbRecipients, recipientId } = recipientsResult;
  const idMex = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  const message = {
    id_mex: idMex,
    id_user_send: userId,
    sender_username: await resolveUsernameByUserId(userId),
    id_partita: resolvedMatchId,
    content: text,
    time_stamp: timestamp,
    tipo: tipoInfo.code,
    destinatario: destinatarioValue,
  };

  const listKey = buildChatListKey({
    matchId: resolvedMatchId,
    tipoCode: tipoInfo.code,
    destinatario: destinatarioValue,
    senderId: userId,
    recipientId,
  });

  await storeMessageInRedis(listKey, message);
  await publishMessage({
    matchId: resolvedMatchId,
    targetUsers: recipients,
    payload: { type: "NEW_MESSAGE", data: message },
  });

  persistMessageAsync({
    idMex,
    userId,
    matchId: resolvedMatchId,
    content: text,
    timestamp,
    tipoLabel: tipoInfo.label,
    recipients: dbRecipients,
  });

  return { ok: true, message };
};

const processSYSMessage = async (userId, matchId, destinatario, dest_tipo, tipo, content) => {
  //non ho bisogno di verificare l'identità del mittente visto che sono solo messaggi di sistema  
  const text = String(content ?? "").trim();
  if (!text) {
    return { ok: false, status: 400, error: "Messaggio vuoto" };
  }

  if (Buffer.byteLength(text, "utf8") > MAX_MESSAGE_LENGTH) {
    text = text.substring(0, MAX_MESSAGE_LENGTH);
    console.log("[SYS_WARN] Messaggio di sistema troncato per superamento lunghezza massima:", text);
  }
  if(tipo !== "[SYS]"){
    return { ok: false, status: 400, error: "Tipo di messaggio non valido per SYS" };
  }
  if(dest_tipo === "ALL"){
    const participants = await getParticipants(matchId);
    if(participants.length === 0){
      return { ok: false, status: 404, error: "Nessun partecipante trovato" };
    }
    //eliminazione match?
  }
  if(dest_tipo === "ALLIANCE"){
    const members = await getAllianceMembers(matchId, destinatario);
    if(members.length === 0){
      return { ok: false, status: 404, error: "Alleanza non valida o vuota" };
    }
  }
  if(dest_tipo === "PLAYER"){
    const recipientId = await resolveUserIdByUsername(matchId, destinatario);
    if (!recipientId) {
      return { ok: false, status: 404, error: "Destinatario non valido" };
    }
  }
  if (typeof destinatarioValue === "string") {
    destinatarioValue = destinatarioValue.trim();
  }
  const isMember = await ensureUserInMatch({
    userId,
    matchId: resolvedMatchId,
  });
  if (!isMember) {
    return { ok: false, status: 403, error: "Utente non in partita" };
  }

  const recipientsResult = await resolveRecipients({
    matchId: resolvedMatchId,
    tipoCode: tipoInfo.code,
    destinatario: destinatarioValue,
    senderId: userId,
  });

  if (!recipientsResult.ok) {
    return recipientsResult;
  }

  const { recipients, dbRecipients, recipientId } = recipientsResult;
  const idMex = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  const message = {
    id_mex: idMex,
    id_user_send: userId,
    id_partita: resolvedMatchId,
    content: text,
    time_stamp: timestamp,
    tipo: tipoInfo.code,
    destinatario: destinatarioValue,
  };

  const listKey = buildChatListKey({
    matchId: resolvedMatchId,
    tipoCode: tipoInfo.code,
    destinatario: destinatarioValue,
    senderId: userId,
    recipientId,
  });

  await storeMessageInRedis(listKey, message);
  await publishMessage({
    matchId: resolvedMatchId,
    targetUsers: recipients,
    payload: { type: "NEW_MESSAGE", data: message },
  });

  persistMessageAsync({
    idMex,
    userId,
    matchId: resolvedMatchId,
    content: text,
    timestamp,
    tipoLabel: tipoInfo.label,
    recipients: dbRecipients,
  });

  return { ok: true, message };
};

const getRecentMessages = async ({
  userId,
  matchId,
  tipo,
  destinatario,
  limit,
}) => {
  if (!userId) {
    return { ok: false, status: 401, error: "Identita mancante" };
  }

  const resolvedMatchId = await resolveMatchId(matchId);
  if (!resolvedMatchId) {
    return { ok: false, status: 404, error: "Partita non trovata" };
  }

  const isMember = await ensureUserInMatch({
    userId,
    matchId: resolvedMatchId,
  });
  if (!isMember) {
    return { ok: false, status: 403, error: "Utente non in partita" };
  }

  const tipoInfo = normalizeTipo(tipo);
  let destinatarioValue = destinatario;
  let recipientId = null;

  if (tipoInfo.code === 2) {
    destinatarioValue = "ALL";
  }

  if (typeof destinatarioValue === "string") {
    destinatarioValue = destinatarioValue.trim();
  }

  if (
    tipoInfo.code === 1 &&
    (!destinatarioValue || String(destinatarioValue).trim() === "")
  ) {
    return { ok: false, status: 400, error: "Destinatario mancante" };
  }

  if (tipoInfo.code === 1) {
    const members = await getAllianceMembers(
      resolvedMatchId,
      destinatarioValue,
    );
    if (!members.includes(userId)) {
      return {
        ok: false,
        status: 403,
        error: "Utente non appartenente all'alleanza",
      };
    }
  }

  if (tipoInfo.code === 0) {
    recipientId = await resolveUserIdByUsername(
      resolvedMatchId,
      destinatarioValue,
    );
    if (!recipientId) {
      return { ok: false, status: 404, error: "Destinatario non valido" };
    }
  }

  const listKey = buildChatListKey({
    matchId: resolvedMatchId,
    tipoCode: tipoInfo.code,
    destinatario: destinatarioValue,
    senderId: userId,
    recipientId,
  });

  const safeLimit = Math.min(
    Math.max(toInt(limit, DEFAULT_LIMIT), 1),
    MAX_LIMIT,
  );
  const items = await redisClient.lRange(listKey, -safeLimit, -1);
  const parsed = items.map((item) => {
    try {
      return JSON.parse(item);
    } catch (error) {
      return { content: String(item) };
    }
  });

  return { ok: true, items: parsed };
};

const authorizeWsConnection = async ({ userId, matchId }) => {
  const resolvedMatchId = await resolveMatchId(matchId);
  if (!resolvedMatchId) {
    return { ok: false, status: 404, error: "Partita non trovata" };
  }

  const isMember = await ensureUserInMatch({
    userId,
    matchId: resolvedMatchId,
  });
  if (!isMember) {
    return { ok: false, status: 403, error: "Accesso negato alla partita" };
  }

  return { ok: true, matchId: resolvedMatchId };
};

module.exports = {
  processMessage,
  getRecentMessages,
  authorizeWsConnection,
  resolveMatchId,
  ensureUserInMatch,
};
