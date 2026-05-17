const nodemailer = require("nodemailer");
const aslan = require("../middleware/Aslan.js");
const Eru = require("../middleware/Eru_recostructor.js");
const db = require("../../shared/postgresClient.js");
const redisClient = require("../../shared/redisClient.js");
const { JsonWebTokenError } = require("jsonwebtoken");
const HOST = process.env.HOST || "localhost:3001";
const DOMAIN = process.env.DOMAIN || "PWM";
const FRONTEND_URL = (process.env.FRONTEND_URL || `http://${HOST}`).replace(
  /\/$/,
  "",
);
const SMTP_HOST =
  process.env.SMTP_HOST || process.env.MAIL_HOST || "smtp.ethereal.email";
const SMTP_PORT = Number(process.env.SMTP_PORT || process.env.MAIL_PORT || 587);
const SMTP_SECURE =
  process.env.SMTP_SECURE === "true" ||
  SMTP_PORT === 465 ||
  process.env.MAIL_SECURE === "true";
const SMTP_TLS_REJECT_UNAUTHORIZED =
  process.env.SMTP_TLS_REJECT_UNAUTHORIZED === "true";
const SMTP_USER =
  process.env.SMTP_USER ||
  process.env.MAIL_USER ||
  "benny.waelchi78@ethereal.email";
const SMTP_PASS =
  process.env.SMTP_PASS || process.env.MAIL_PASS || "gutRxGp5JfjD9C9cbf";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || `noreply@${DOMAIN}`;

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

const registerUser = async ({ username, email, password, region }) => {
  const passwordHash = await aslan.hash_password(password);
  const normalizeReg = aslan.normalizeRegion(region);
  console.log(
    `Registrazione utente: username="${username}", email="${email}", regione="${region}" (normalizzata: "${normalizeReg}")`,
  );
  if (region === null) {
    console.log("Regione non fornita, non procedo.");
    return {
      status: 400,
      error: "Regione non fornita",
    };
  }
  try {
    const { rows } = await db.query(
      "INSERT INTO utenti (username, email, password_hash, reg) VALUES ($1, $2, $3, $4) RETURNING id_user",
      [username, email, passwordHash, normalizeReg],
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

const recoveryPassword = async ({ email }) => {
  const { rows } = await db.query(
    "SELECT username FROM utenti WHERE email = $1 LIMIT 1",
    [email],
  );

  const user = rows[0];
  if (!user) {
    return { status: 400, message: "Email non valida" };
  }

  const username = user.username;
  const token = await aslan.generate_secure_token(32);
  const expireTime = new Date(Date.now() + 600000);

  try {
    await db.query(
      "INSERT INTO password_recovery_tokens (username, token, expire_time) VALUES ($1, $2, $3)",
      [username, token, expireTime],
    );
  } catch (error) {
    console.error(
      "Errore durante la creazione del token di recupero password:",
      error,
    );
    return { status: 500, message: "Errore interno del server" };
  }

  if (!SMTP_USER || !SMTP_PASS) {
    console.error(
      "Configurazione SMTP incompleta: controlla SMTP_USER e SMTP_PASS",
    );
    return { status: 500, message: "Configurazione email non completata" };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    tls: {
      rejectUnauthorized: SMTP_TLS_REJECT_UNAUTHORIZED,
    },
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  const resetLink = `${FRONTEND_URL}/login/recovery/password?token=${token}`;
  const mailOptions = {
    from: `"supporto" <${SMTP_FROM}>`,
    to: email,
    subject: "Token di recupero password",
    text: `Hai richiesto il reset della password. Usa questo link entro 10 minuti: ${resetLink}`,
    html: `<p>Hai richiesto il reset della password.</p>
           <p><a href="${resetLink}">Clicca qui per reimpostare la tua password</a></p>
           <p>Il link scade tra 10 minuti.</p>`,
  };
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email di recupero password inviata a:", email);
    console.log("Risultato invio email:", info);
    return { status: 200, message: "Email di recupero password inviata" };
  } catch (error) {
    console.error(
      "Errore durante l'invio dell'email di recupero password:",
      error,
    );

    // try {
    //   await db.query(
    //     "DELETE FROM password_recovery_tokens WHERE token = $1",
    //     [token],
    //   );
    // } catch (cleanupError) {
    //   console.error("Errore durante la rimozione del token non inviato:", cleanupError);
    // }

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
  if (!updated) {
    return { status: 400, error: "Utente o email non validi" };
  }
  return { status: 200, message: "Password reimpostata con successo" };
};

const resetPasswordToken = async ({ username, email, newPassword, token }) => {
  const { rows } = await db.query(
    "SELECT token FROM password_recovery_tokens WHERE token = $1 LIMIT 1",
    [token],
  );
  if (rows.length === 0) {
    return { status: 404, error: "Token non trovato" };
  }
  const passwordHash = await aslan.hash_password(newPassword);
  const { rows: updateRows } = await db.query(
    "UPDATE utenti SET password_hash = $1, last_password_change = NOW() WHERE username = $2 AND email = $3 RETURNING id_user",
    [passwordHash, username, email],
  );
  const updated = updateRows[0];
  if (!updated) {
    return { status: 400, error: "Utente o email non validi" };
  }
  try {
    await db.query("DELETE FROM password_recovery_tokens WHERE token = $1", [
      token,
    ]);
    console.log(`Token "${token}" eliminato dopo l'uso.`);
  } catch (error) {
    console.error(
      "Errore durante la cancellazione del token di recupero password:",
      error,
    );
    return { status: 500, error: "Errore interno del server" };
  }
  return { status: 200, message: "Password reimpostata con successo" };
};

const createAccessSession = async ({ userId, ipAddress, cookieToken }) => {
  const { rows } = await db.query(
    "INSERT INTO accessi (user_id, ip_address, cookie_token) VALUES ($1, $2, $3) RETURNING id_access, login_time",
    [userId, ipAddress, cookieToken],
  );
  if (rows.length === 0) {
    console.error(
      "Errore durante la creazione della sessione di accesso: nessuna riga restituita",
    );
    return null;
  }
  return rows[0];
};

const deleteAccessSessionByCookieToken = async (cookieToken) => {
  await db.query("DELETE FROM accessi WHERE cookie_token = $1", [cookieToken]);
};
const buildMatchMap = (rows) => {
  if (!Array.isArray(rows)) return {};
  return rows.reduce((acc, row, index) => {
    const decodedMatch = Eru.procedure_recreate_field(row.struttura_partita);
    acc[`match${index + 1}`] = {
      ...row,
      struttura_partita: decodedMatch,
    };
    return acc;
  }, {});
};

const buildHome = async (U_ID) => {
  try {
    const cachedData = await fetchFromRedis(U_ID);
    if (cachedData) {
      console.log("Dati della home page recuperati da Redis per U_ID:", U_ID);
      return {
        status: 200,
        message: "Benvenuto nella home page protetta!",
        data: cachedData,
      };
    }
    //SI TENTA A PRIORI DI RECUPERARE LE INFO DA REDIS, SE NON CI SONO SI VA A DB E SI POPOLA REDIS PER LE PROSSIME VOLTE.
    //REDIS, AD OGNI MODO, IMPLEMENTA UNA CASH: SE L'UTENTE NON EFFETTUA RICHIESTE PER UN PO' DI TEMPO, LE INFO SI ELIMINANO E SI VA A DB.
    // 1. LEADERBOARD REGIONALE
    else {

      const user_profile_query = await db.query(
        `SELECT username, reg, elo_rating, avatar_id FROM utenti WHERE id_user = $1`,
        [U_ID]
      );
      const currentUser = user_profile_query.rows[0];

      const leaderboard_regionale = await db.query(
        `SELECT username, reg, elo_rating
      FROM utenti
      WHERE reg = (SELECT reg FROM utenti WHERE id_user = $1)
      ORDER BY elo_rating DESC
      LIMIT 10;`,
        [U_ID],
      );

      // 2. LEADERBOARD GLOBALE
      const leaderboard_globale = await db.query(
        `SELECT username, reg, elo_rating
      FROM utenti
      ORDER BY elo_rating DESC
      LIMIT 10;`,
      );

      // 3. POSIZIONE UTENTE (Risolto Syntax Error)
      const user_position = await db.query(
        `SELECT (COUNT(id_user) + 1) AS user_rank
      FROM utenti
      WHERE elo_rating > (
          SELECT elo_rating 
          FROM utenti 
          WHERE id_user = $1
      );`,
        [U_ID],
      );
      const match_attivi = await db.query(
          `SELECT 
            m.nome_partita AS nome_match, 
            m.struttura_partita, 
            m.created_at AS data_creazione, 
            m.id_host,
            (SELECT count(user_id) FROM partecipanti_partite p2 WHERE p2.partita_id = m.id_partita) AS numero_partecipanti
        FROM partecipanti_partite p
        INNER JOIN partite m ON p.partita_id = m.id_partita
        WHERE p.user_id = $1 
          AND substring(m.struttura_partita::text from 1 for 2) IN ('00', '01')
        ORDER BY m.created_at DESC`,
          [U_ID],
        );
      //QUESTA QUERY SI FA A REDIS: è lui che tiene traccia immediata dei match creati.
      const last_created_match = await db.query(
          `SELECT 
            m.nome_partita AS nome_match, 
            m.struttura_partita, 
            m.created_at AS data_creazione, 
            m.id_host,
            (SELECT count(user_id) FROM partecipanti_partite p2 WHERE p2.partita_id = m.id_partita) AS numero_partecipanti
        FROM partecipanti_partite p
        INNER JOIN partite m ON p.partita_id = m.id_partita
        WHERE p.user_id = $1 
          AND substring(m.struttura_partita::text from 1 for 2) IN ('00', '01')
        ORDER BY m.created_at DESC 
        LIMIT 10;`,
          [U_ID],
        );
      const friends_information = await db.query(
        `SELECT 
          u.username, 
          u.reg, 
          u.elo_rating, 
          u.avatar_id, 
          u.codice_amico
      FROM amici a
      INNER JOIN utenti u ON a.id_amico = u.id_user
      WHERE a.id_user = $1;`,
        [U_ID],
      );
      const decompress_match_attivi = buildMatchMap(match_attivi.rows);
      const decompress_match_unito = buildMatchMap(last_created_match.rows);
      const Information = {
        user_profile: currentUser,
        leaderboard_regionale: leaderboard_regionale.rows,
        leaderboard_globale: leaderboard_globale.rows,
        user_position: user_position.rows[0]?.user_rank,
        match_attivi: decompress_match_attivi,
        last_created_match: decompress_match_unito,
        friends_information: friends_information.rows,
      };
      console.log("Informazioni per la home page:", Information);
      const redis_response = await fetchToRedis(U_ID, Information);//VANNO FETCHATE SOLO LE INFO RELATIVE ALL'UTENTE. REDIS MEMORIZZA GIA' LE INFO DELLE PARTITE ATTIVE E DI QUELLE APPENA CREATE (SI DEVE MODIFICARE LA QUERY CHE LE RECUPERA, IN MODO CHE SIANO SOLO QUELLE RELATIVE ALL'UTENTE)
      return { status: 200, message: "Benvenuto nella home page protetta!", data: Information};
    }
  } catch (error) {
    console.error("Errore generato dentro buildHome:", error);
    return { status: 500, error: "Errore interno del server" };
  }
};
const fetchToRedis = async (U_ID, Information) => {
  const redis_response = await redisClient.setEx(
    `home_info:${U_ID}`,
    3600,
    JSON.stringify(Information),
  );
  console.log("Dati della home page salvati in Redis per U_ID:", U_ID, "Risposta Redis:", redis_response);
  return redis_response;
};
const fetchFromRedis = async (U_ID) => {
  const data = await redisClient.get(`home_info:${U_ID}`);
  console.log("Dati della home page recuperati da Redis per U_ID:", U_ID, "Dati:", data);
  return data ? JSON.parse(data) : null;
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
  buildHome,
};
