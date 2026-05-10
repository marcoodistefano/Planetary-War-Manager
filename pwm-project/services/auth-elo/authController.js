const Sauron = require("./middleware/Sauron.js");
const authModel = require("./authModel.js");
const redisClient = require("../shared/redisClient.js");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const JWT_SECRET =
  process.env.JWT_SECRET ||
  process.env.SECRET_KEY ||
  "CHIAVE_SEGRETA_TEMPORANEA_SUPER_SICURA";
const SESSION_TTL = 86400; // 24 ore in secondi

const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const forwardedIp = String(forwardedValue ?? "")
    .split(",")[0]
    .trim();
  return forwardedIp || req.ip || req.connection?.remoteAddress || null;
};

const register = async (req, res) => {
  console.log("--- Ricevuto dato grezzo ---");
  console.log(req.body);

  try {
    const result = await Sauron.process_register(req.body);
    if (!result.isValid) return res.status(400).json(result);

    const saved = await authModel.registerUser({
      username: result.data.username,
      email: result.data.email,
      password: result.data.password,
    });

    result.data.password = saved.passwordHash;

    console.log("--- Dato X sicuro generato ---");
    console.log(result.data);

    return res.json({
      message: "Registrazione ok",
      dato_x_sicuro: result.data,
    });
  } catch (error) {
    if (error && error.code === "USER_EXISTS") {
      return res.status(409).json({
        isValid: false,
        errors: [error.message],
      });
    }

    console.error("--- Errore durante l'elaborazione ---");
    console.error(error);
    return res.status(500).json({
      error: "Errore interno del server",
      details: error.message,
    });
  }
};

const login = async (req, res) => {
  try {
    const result = await Sauron.process_login(req.body);

    if (!result.isValid) {
      return res.status(400).json(result);
    }

    const authResult = await authModel.verifyLogin({
      username: result.data.username,
      password: result.data.password,
    });

    if (!authResult.ok) {
      return res.status(401).json({ isValid: false, errors: [authResult.error] });
    }

    // --- INIZIO PROTOCOLLO DI SESSIONE REDIS & JWT ---
    const sessionId = crypto.randomUUID();
    const userId = authResult.uuid;
    const ipAddress = getClientIp(req);
    const expireTime = new Date(Date.now() + SESSION_TTL * 1000);

    // 1. Prepara il payload per Redis
    const sessionData = {
      userId: userId,
      ip: ipAddress,
      userAgent: req.headers["user-agent"] || "Unknown",
      createdAt: new Date().toISOString(),
    };

    // 2. Salva la sessione in Redis con Scadenza (TTL)
    await redisClient.setEx(
      `session:${sessionId}`,
      SESSION_TTL,
      JSON.stringify(sessionData),
    );
    
    // 3. Aggiungi il sessionId al Set dell'utente per tracciamento
    await redisClient.sAdd(`user_sessions:${userId}`, sessionId);

    // 4. Genera il JWT
    const token = jwt.sign(
      { sub: userId, id_user: userId, jti: sessionId },
      JWT_SECRET,
      { expiresIn: SESSION_TTL },
    );

    // 5. Persisti la sessione anche su Postgres (tabella accessi)
    try {
      await authModel.createAccessSession({
        userId,
        ipAddress,
        cookieToken: sessionId,
        expireTime,
      });
    } catch (dbError) {
      // Manteniamo consistenza: se non scriviamo sul DB, invalidiamo la sessione Redis
      await redisClient.del(`session:${sessionId}`);
      await redisClient.sRem(`user_sessions:${userId}`, sessionId);
      throw dbError;
    }

    return res.json({
      message: "Login avvenuto con successo",
      token: token // Inviamo il token al frontend
    });

  } catch (error) {
    console.error("--- Errore durante l'elaborazione ---");
    console.error(error);
    return res.status(500).json({ error: "Errore interno del server" });
  }
};

const recoveryUsername = async (req, res) => {
  console.log("--- Ricevuto dato da recupero username ---");
  console.log(req.body);

  try {
    const result = await Sauron.process_recovery_username(req.body);

    if (!result.isValid) {
      console.log("--- Validazione fallita ---");
      return res.status(400).json(result);
    }

    const recovery = await authModel.recoverUsername({
      email: result.data.email,
      password: result.data.password,
    });

    if (!recovery.ok) {
      return res.status(400).json({
        isValid: false,
        errors: [recovery.error],
      });
    }

    result.data.username = recovery.username;

    return res.json({
      message: "Username recuperato con successo",
      dato_x_sicuro: result.data,
    });
  } catch (error) {
    console.error("--- Errore durante l'elaborazione ---");
    console.error(error);
    return res.status(500).json({
      error: "Errore interno del server",
      details: error.message,
    });
  }
};

const recoveryPassword = async (req, res) => {
  try {
    const result = await Sauron.process_recovery_password(req.body);

    if (!result.isValid) {
      return res.status(400).json(result);
    }

    const recovery = await authModel.recoveryPassword({
      email: result.data.email,
    });

    if (recovery.status !== 200) {
      return res.status(recovery.status).json({
        isValid: false,
        errors: [recovery.message],
      });
    }

    return res.json({
      message: recovery.message,
    });
  } catch (error) {
    console.error("--- Errore durante l'elaborazione ---");
    console.error(error);
    return res.status(500).json({ error: "Errore interno del server" });
  }
};

const recoveryPasswordToken = async (req, res) => {
  try {
    const result = await Sauron.process_recovery_password(req.body);
    if (!result.isValid) {
      return res.status(400).json(result);
    }
    const { token } = req.params;
    const { newPassword } = req.body;

    // Verifica se il token è valido e non è scaduto
    const tokenData = await redisClient.get(`password_recovery:${token}`);
    if (!tokenData) {
      return res.status(400).json({ isValid: false, errors: ["Token non valido o scaduto"] });
    }
    
    const { username, email } = JSON.parse(tokenData);

    // Resetta la password
    const resetResult = await authModel.resetPasswordToken({
      username,
      email,
      newPassword,
      tokenData,
    });

    if (!resetResult.ok) {
      return res.status(400).json({ isValid: false, errors: [resetResult.error] });
    }

    // Invalida il token dopo averlo utilizzato
    await redisClient.del(`password_recovery:${token}`);

    return res.json({ message: "Password reimpostata con successo" });
  } catch (error) {
    console.error("--- Errore durante l'elaborazione ---");
    console.error(error);
    return res.status(500).json({ error: "Errore interno del server" });
  }
};

module.exports = {
  register,
  login,
  recoveryUsername,
  recoveryPassword,
  recoveryPasswordToken
};