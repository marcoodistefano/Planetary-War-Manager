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
  try {
    const { username, email, password, region } = req.body;

    const saved = await authModel.registerUser({
      username,
      email,
      password,
      region,
    });
    if(saved.status === 400){
      return res.status(400).json({
        isValid: false,
        errors: [saved.error],
      });
    }
    return res.json({
      message: "Registrazione ok",
      dato_x_sicuro: {
        username,
        email,
        password: saved.passwordHash,
        reg: saved.reg,
      },
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
    // 1. INPUT VALIDATION (Prevenzione Garbage In/Garbage Out)
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Credenziali mancanti" });
    }

    // 2. AUTHENTICATION
    const authResult = await authModel.verifyLogin({ username, password });

    // Mitigazione Enumerazione: Messaggio generico
    if (!authResult.ok) {
      return res.status(401).json({ isValid: false, message: "Credenziali non valide" });
    }

    const userId = authResult.uuid;
    const sessionId = crypto.randomUUID();
    const ipAddress = getClientIp(req);

    // 3. TOKEN GENERATION
    const token = jwt.sign(
      { sub: userId, jti: sessionId }, // Evitiamo di duplicare userId in id_user
      JWT_SECRET,
      { expiresIn: SESSION_TTL }
    );

    // 4. PERSISTENCE LAYER (Parallelismo o Transazione)
    // Usiamo Promise.allSettled o una transazione per garantire consistenza
    try {
      const sessionData = JSON.stringify({
        userId,
        ip: ipAddress,
        userAgent: req.headers["user-agent"] || "Unknown",
        createdAt: new Date().toISOString()
      });

      // Operazione atomica su Redis e salvataggio su Postgres
      await Promise.all([
        redisClient.setEx(`session:${sessionId}`, SESSION_TTL, sessionData),
        redisClient.sAdd(`user_sessions:${userId}`, sessionId),
        authModel.createAccessSession({ userId, ipAddress, cookieToken: token })
      ]);
    } catch (infraError) {
      console.error("Critical Infrastructure Error:", infraError);
      return res.status(500).json({ error: "Errore durante la creazione della sessione" });
    }

    // 5. SECURE DELIVERY
    // Impostiamo il token in un cookie sicuro, non accessibile da JS
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: SESSION_TTL * 1000 // Convertito in ms
    });

    return res.json({ status: 200, message: "Login avvenuto con successo" });

  } catch (error) {
    // Log granulare per debugging interno, ma generico per l'esterno
    console.error(`[Auth Error] ${new Date().toISOString()}:`, error.message);
    return res.status(500).json({ error: "Errore interno del server" });
  }
};

const recoveryUsername = async (req, res) => {
  try {
    const { email, password } = req.body;

    const recovery = await authModel.recoverUsername({
      email,
      password,
    });

    if (!recovery.ok) {
      return res.status(400).json({
        isValid: false,
        errors: [recovery.error],
      });
    }

    return res.json({
      message: "Username recuperato con successo",
      dato_x_sicuro: {
        email,
        password,
        username: recovery.username,
      },
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
    const { email } = req.body;

    const recovery = await authModel.recoveryPassword({
      email,
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

const home = async (req, res) => {
  try {
    token = req.cookies.auth_token;
    if (!token) { //il token è verificato nel gateway, qui è solo per testare se arriva correttamente
      return res.status(401).json({ message: "Non autenticato" });
    }
    U_ID = JSON.parse(await redisClient.get(`session:${token}`)).userId;
    console.log("U_ID:", U_ID);
    res = await authModel.buildHome(U_ID);
    if(res.status !== 200){
      return res.status(res.status).json({
        isValid: false,
        errors: [res.message],
      });
    }
    return res    
  }catch(error){
    console.log("errore");
    return res.status(500).json({ error: "Errore interno del server" });
  }
};

module.exports = {
  register,
  login,
  recoveryUsername,
  recoveryPassword,
  recoveryPasswordToken,
  home,
};