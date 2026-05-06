const Sauron = require("./middleware/Sauron.js");
const authModel = require("./authModel.js");
const redisClient = require("../shared/redisClient.js");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const JWT_SECRET = process.env.JWT_SECRET || "CHIAVE_SEGRETA_TEMPORANEA_SUPER_SICURA";
const SESSION_TTL = 86400; // 24 ore in secondi

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

    // 1. Prepara il payload per Redis
    const sessionData = {
      userId: userId,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.headers["user-agent"] || "Unknown",
      createdAt: new Date().toISOString()
    };

    // 2. Salva la sessione in Redis con Scadenza (TTL)
    await redisClient.setEx(`session:${sessionId}`, SESSION_TTL, JSON.stringify(sessionData));
    
    // 3. Aggiungi il sessionId al Set dell'utente per tracciamento
    await redisClient.sAdd(`user_sessions:${userId}`, sessionId);

    // 4. Genera il JWT
    const token = jwt.sign(
      { sub: userId, jti: sessionId }, 
      JWT_SECRET, 
      { expiresIn: "24h" }
    );

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

    const reset = await authModel.resetPassword({
      username: result.data.username,
      email: result.data.email,
      newPassword: result.data.newPassword,
    });

    if (!reset.ok) {
      return res.status(400).json({ isValid: false, errors: [reset.error] });
    }

    // --- REVOCA DI TUTTE LE SESSIONI REDIS ---
    const userId = reset.uuid;
    
    // 1. Recupera tutte le sessioni attive dell'utente
    const activeSessions = await redisClient.sMembers(`user_sessions:${userId}`);
    
    if (activeSessions.length > 0) {
      // 2. Formatta le chiavi (es. "session:1234")
      const sessionKeys = activeSessions.map(id => `session:${id}`);
      
      // 3. Elimina fisicamente i payload delle sessioni
      await redisClient.del(sessionKeys);
      
      // 4. Svuota l'elenco delle sessioni dell'utente
      await redisClient.del(`user_sessions:${userId}`);
      console.log(`--- Revocate ${activeSessions.length} sessioni per l'utente ${userId} ---`);
    }

    return res.json({ message: "Password aggiornata. Tutte le sessioni precedenti sono state revocate." });
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
};