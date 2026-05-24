const jwt = require("jsonwebtoken");
const redisClient = require("./redisClient");

const JWT_SECRET =
  process.env.JWT_SECRET ||
  process.env.SECRET_KEY ||
  "CHIAVE_SEGRETA_TEMPORANEA_SUPER_SICURA";

const parseCookies = (cookieHeader) => {
  if (!cookieHeader) return {};

  const cookies = {};
  const cookieParts = String(cookieHeader).split(";");

  for (let i = 0; i < cookieParts.length; i += 1) {
    const item = cookieParts[i].trim();
    const eqIndex = item.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = item.slice(0, eqIndex).trim();
    const rawValue = item.slice(eqIndex + 1);
    cookies[key] = decodeURIComponent(rawValue || "");
  }

  return cookies;
};

const extractTokenFromRequest = (req) => {
  const authHeader = req?.headers?.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const cookieHeader = req?.headers?.cookie;
  const cookies = parseCookies(cookieHeader);
  if (cookies.auth_token) {
    return cookies.auth_token;
  }

  const rawUrlString = req?.originalUrl || req?.url || "/";
  const parsedUrl = new URL(rawUrlString, "http://localhost");
  const tokenFromQuery = parsedUrl.searchParams.get("token");
  if (tokenFromQuery) return tokenFromQuery;

  const authTokenFromQuery = parsedUrl.searchParams.get("auth_token");
  if (authTokenFromQuery) return authTokenFromQuery;

  return null;
};

const getAuthContextFromRequest = async (req) => {
  const token = extractTokenFromRequest(req);
  if (!token) {
    return { ok: false, status: 401, error: "Token mancante" };
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return { ok: false, status: 401, error: "Token non valido o scaduto" };
  }

  const sessionId = decoded?.jti;
  if (!sessionId) {
    return { ok: false, status: 401, error: "Sessione mancante nel token" };
  }

  const sessionDataRaw = await redisClient.get(`session:${sessionId}`);
  if (!sessionDataRaw) {
    return { ok: false, status: 401, error: "Sessione terminata o non valida" };
  }

  let sessionData = null;
  try {
    sessionData = JSON.parse(sessionDataRaw);
  } catch (error) {
    sessionData = null;
  }

  const userIdFromSession =
    sessionData && typeof sessionData.userId === "string"
      ? sessionData.userId
      : null;
  const userIdFromToken =
    decoded && typeof decoded.sub === "string" ? decoded.sub : null;

  if (userIdFromSession && userIdFromToken && userIdFromSession !== userIdFromToken) {
    return { ok: false, status: 401, error: "Identita sessione non coerente" };
  }

  let userId = userIdFromSession || null;
  if (!userId && userIdFromToken) {
    const isSessionLinked = await redisClient.sIsMember(
      `user_sessions:${userIdFromToken}`,
      sessionId,
    );
    if (isSessionLinked) {
      userId = userIdFromToken;
    }
  }

  if (!userId) {
    return { ok: false, status: 401, error: "Identita utente non risolvibile" };
  }

  return {
    ok: true,
    userId,
    sessionId,
    sessionData,
    decoded,
  };
};

module.exports = {
  extractTokenFromRequest,
  getAuthContextFromRequest,
};
