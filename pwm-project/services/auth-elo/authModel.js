const aslan = require("./middleware/Aslan.js");
const db = require("../shared/postgresClient.js");

const mapUniqueViolation = (error) => {
  if (!error || error.code !== "23505") return null;

  const constraint = String(error.constraint || "").toLowerCase();
  const detail = String(error.detail || "");

  if (constraint.includes("username") || detail.includes("(username)")) {
    return "Username già in uso";
  }
  if (constraint.includes("email") || detail.includes("(email)")) {
    return "Email già in uso";
  }
  return "Utente già esistente";
};

const registerUser = async ({ username, email, password }) => {
  const passwordHash = await aslan.hash_password(password);

  try {
    const { rows } = await db.query(
      "INSERT INTO utenti (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id_user",
      [username, email, passwordHash],
    );
    return { passwordHash, uuid: rows[0]?.id_user };
  } catch (error) {
    const mapped = mapUniqueViolation(error);
    if (mapped) {
      const err = new Error(mapped);
      err.code = "USER_EXISTS";
      throw err;
    }
    throw error;
  }
};

const verifyLogin = async ({ username, password }) => {
  const { rows } = await db.query(
    "SELECT id_user, password_hash FROM utenti WHERE username = $1 LIMIT 1",
    [username],
  );

  const user = rows[0];
  if (!user) {
    return { ok: false, error: "Credenziali non valide" };
  }

  const isMatch = await aslan.verify_password(password, user.password_hash);
  if (!isMatch) {
    return { ok: false, error: "Credenziali non valide" };
  }

  return { ok: true, uuid: user.id_user };
};

// recoverUsername rimane invariato...
const recoverUsername = async ({ email, password }) => {
  const { rows } = await db.query(
    "SELECT username, password_hash FROM utenti WHERE email = $1 LIMIT 1",
    [email],
  );

  const user = rows[0];
  if (!user) {
    return { ok: false, error: "Email non valida" };
  }

  const isMatch = await aslan.verify_password(password, user.password_hash);
  if (!isMatch) {
    return { ok: false, error: "Credenziali non valide" };
  }

  return { ok: true, username: user.username };
};

const resetPassword = async ({ username, email, newPassword }) => {
  const passwordHash = await aslan.hash_password(newPassword);

  const { rows } = await db.query(
    "UPDATE utenti SET password_hash = $1, last_password_change = NOW() WHERE username = $2 AND email = $3 RETURNING id_user",
    [passwordHash, username, email],
  );

  const updated = rows[0];
  if (!updated) {
    return { ok: false, error: "Utente o email non validi" };
  }

  return { ok: true, passwordHash, uuid: updated.id_user };
};

const createAccessSession = async ({ userId, ipAddress, cookieToken, expireTime }) => {
  const { rows } = await db.query(
    "INSERT INTO accessi (user_id, ip_address, cookie_token, expire_time) VALUES ($1, $2, $3, $4) RETURNING id_access, login_time, expire_time",
    [userId, ipAddress, cookieToken, expireTime],
  );

  return rows[0];
};

module.exports = {
  registerUser,
  verifyLogin,
  recoverUsername,
  resetPassword,
  createAccessSession,
};