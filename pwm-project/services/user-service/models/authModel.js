const nodemailer = require("nodemailer");
const aslan = require("../middleware/Aslan.js");
const db = require("../../shared/postgresClient.js");

const HOST = process.env.HOST || "localhost:3001";
const DOMAIN = process.env.DOMAIN || "PWM";
const FRONTEND_URL = (process.env.FRONTEND_URL || `http://${HOST}`).replace(/\/$/, "");
const SMTP_HOST = process.env.SMTP_HOST || process.env.MAIL_HOST || "smtp.ethereal.email";
const SMTP_PORT = Number(process.env.SMTP_PORT || process.env.MAIL_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === "true" || SMTP_PORT === 465 || process.env.MAIL_SECURE === "true";
const SMTP_TLS_REJECT_UNAUTHORIZED = process.env.SMTP_TLS_REJECT_UNAUTHORIZED === "true";
const SMTP_USER = process.env.SMTP_USER || process.env.MAIL_USER || "benny.waelchi78@ethereal.email";
const SMTP_PASS = process.env.SMTP_PASS || process.env.MAIL_PASS || "gutRxGp5JfjD9C9cbf";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || `noreply@${DOMAIN}`;
const MAX_USERNAME_LENGTH = 32;

const mapUniqueViolation = (error) => {
  if (!error || error.code !== "23505") return null;
  const constraint = String(error.constraint || "").toLowerCase();
  const detail = String(error.detail || "");

  if (constraint.includes("username") || detail.includes("(username)")) return "Username già in uso";
  if (constraint.includes("email") || detail.includes("(email)")) return "Email già in uso";
  return "Utente già esistente";
};

const registerUser = async ({ username, email, password, region }) => {
  if (typeof username !== "string" || username.trim().length === 0) {
    return { status: 400, error: "Username non fornito" };
  }

  if (username.length > MAX_USERNAME_LENGTH) {
    return {
      status: 400,
      error: `Username troppo lungo (massimo ${MAX_USERNAME_LENGTH} caratteri)`,
    };
  }

  const passwordHash = await aslan.hash_password(password);
  const normalizeReg = aslan.normalizeRegion(region);
  
  if (region === null) {
    return { status: 400, error: "Regione non fornita" };
  }
  const friend_ID = aslan.generate_secure_token(10); //NB, si deve utilizzare UUID, ci potrebbero essere collisioni o attese troppo lunghe per 
  //la conferma da parte del DB del token univoco.
  try {
    const { rows } = await db.query(
      "INSERT INTO utenti (username, email, password_hash, reg, codice_amico) VALUES ($1, $2, $3, $4, $5) RETURNING id_user",
      [username, email, passwordHash, normalizeReg, friend_ID],
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
  if (!user) return { ok: false, error: "Credenziali non valide" };

  const isMatch = await aslan.verify_password(password, user.password_hash);
  if (!isMatch) return { ok: false, error: "Credenziali non valide" };

  return { ok: true, uuid: user.id_user };
};

const recoverUsername = async ({ email, password }) => {
  const { rows } = await db.query(
    "SELECT username, password_hash FROM utenti WHERE email = $1 LIMIT 1",
    [email],
  );

  const user = rows[0];
  if (!user) return { ok: false, error: "Email non valida" };

  const isMatch = await aslan.verify_password(password, user.password_hash);
  if (!isMatch) return { ok: false, error: "Credenziali non valide" };

  return { ok: true, username: user.username };
};

const recoveryPassword = async ({ email }) => {
  const { rows } = await db.query(
    "SELECT id_user, username FROM utenti WHERE email = $1 LIMIT 1",
    [email],
  );

  const user = rows[0];
  if (!user) return { status: 400, message: "Email non valida" };

  const id_user = user.id_user;
  const token = await aslan.generate_secure_token(32);
  const expireTime = new Date(Date.now() + 600000);

  try {
    await db.query(
      "INSERT INTO password_recovery_tokens (token, id_user, expire_time) VALUES ($1, $2, $3)",
      [token, id_user, expireTime],
    );
  } catch (error) {
    console.error("Errore durante la creazione del token:", error);
    return { status: 500, message: "Errore interno del server" };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE,
    tls: { rejectUnauthorized: SMTP_TLS_REJECT_UNAUTHORIZED },
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const resetLink = `${FRONTEND_URL}/login/recovery/password?token=${token}`;
  const mailOptions = {
    from: `"Supporto Comando PWM" <${SMTP_FROM}>`,
    to: email,
    subject: "PWM - Protocollo di Recupero Password",
    html: `
      <div style="font-family: 'Courier New', Courier, monospace; background-color: #0b1121; padding: 40px; color: #e2e8f0; text-align: center;">
        <div style="max-width: 500px; margin: 0 auto; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 30px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5), 0 2px 4px -1px rgba(0, 0, 0, 0.3);">
          
          <h1 style="color: #38bdf8; font-size: 24px; font-weight: bold; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 2px;">
            Planetary War<br>Manager
          </h1>
          <p style="font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-top: 0; margin-bottom: 30px;">
            Strategia, alleanze, conquista
          </p>

          <div style="text-align: left; background-color: #1e293b; padding: 20px; border-radius: 6px; border-left: 4px solid #38bdf8; margin-bottom: 30px;">
            <p style="margin-top: 0; font-size: 16px;">Comandante,</p>
            <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">
              Abbiamo ricevuto una richiesta di attivazione del protocollo di emergenza per il ripristino delle tue credenziali di accesso al network.
            </p>
          </div>

          <a href="${resetLink}" style="display: inline-block; background-color: #0284c7; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 4px; font-weight: bold; font-size: 15px; letter-spacing: 1px; margin-bottom: 25px; border: 1px solid #38bdf8; text-transform: uppercase;">
            Autenticazione Rete
          </a>

          <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin-bottom: 0;">
            Attenzione: Questo link di sicurezza ha una validità massima di <strong>10 minuti</strong>.<br>
            Se non hai richiesto tu il ripristino, ignora questo messaggio. La tua postazione di comando rimane sicura.
          </p>
        </div>
        
        <div style="margin-top: 30px; font-size: 10px; color: #475569; text-transform: uppercase;">
          <p>&copy; 2026 Planetary War Manager /// Strategic Command<br>SYS.VER 1.0.4 - COMM-LINK ONLINE</p>
        </div>
      </div>
    `,
  };
  try {
    await transporter.sendMail(mailOptions);
    return { status: 200, message: "Email di recupero password inviata" };
  } catch (error) {
    console.error("Errore durante l'invio dell'email:", error);
    return { status: 500, message: "Errore interno del server" };
  }
};

const resetPassword = async ({ username, email, newPassword }) => {
  const passwordHash = await aslan.hash_password(newPassword);

  const { rows } = await db.query(
    "UPDATE utenti SET password_hash = $1, last_password_change = NOW() WHERE username = $2 AND email = $3 RETURNING id_user",
    [passwordHash, username, email],
  );

  const updated = rows[0];
  if (!updated) return { status: 400, error: "Utente o email non validi" };
  
  return { status: 200, message: "Password reimpostata con successo" };
};

const resetPasswordToken = async ({ newPassword, token }) => {
  const { rows } = await db.query(
    "SELECT id_user FROM password_recovery_tokens WHERE token = $1 AND expire_time > NOW() LIMIT 1",
    [token],
  );
  if (rows.length === 0) return { status: 404, error: "Token non valido o scaduto" };
  
  const id_user = rows[0].id_user;
  const passwordHash = await aslan.hash_password(newPassword);
  
  const { rows: updateRows } = await db.query(
    "UPDATE utenti SET password_hash = $1, last_password_change = NOW() WHERE id_user = $2 RETURNING id_user",
    [passwordHash, id_user],
  );
  
  const updated = updateRows[0];
  if (!updated) return { status: 400, error: "Utente o email non validi" };
  
  try {
    await db.query("DELETE FROM password_recovery_tokens WHERE token = $1", [token]);
  } catch (error) {
    return { status: 500, error: "Errore interno del server" };
  }
  return { status: 200, message: "Password reimpostata con successo" };
};

const createAccessSession = async ({ userId, ipAddress, cookieToken }) => {
  const { rows } = await db.query(
    "INSERT INTO accessi (user_id, ip_address, cookie_token) VALUES ($1, $2, $3) RETURNING id_access, login_time",
    [userId, ipAddress, cookieToken],
  );
  if (rows.length === 0) return null;
  return rows[0];
};

const deleteAccessSessionByCookieToken = async (cookieToken) => {
  await db.query("DELETE FROM accessi WHERE cookie_token = $1", [cookieToken]);
};

module.exports = {
  registerUser,
  verifyLogin,
  recoverUsername,
  recoveryPassword,
  resetPassword,
  resetPasswordToken,
  createAccessSession,
  deleteAccessSessionByCookieToken,
};