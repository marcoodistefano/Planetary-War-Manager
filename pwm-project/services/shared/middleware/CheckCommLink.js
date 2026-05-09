const jwt = require('jsonwebtoken');
const redisClient = require('../redisClient'); // Importa il client dalla cartella genitore

// Assicurati di usare la stessa variabile d'ambiente usata in authController
const JWT_SECRET =
  process.env.JWT_SECRET ||
  process.env.SECRET_KEY ||
  "CHIAVE_SEGRETA_TEMPORANEA_SUPER_SICURA";

const checkCommLink = async (req, res, next) => {
  try {
    // 1. Estrai il token dall'header Authorization (Formato: "Bearer <token>")
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Accesso negato. Nessun segnale COMM-LINK rilevato (Token mancante)." });
    }

    const token = authHeader.split(' ')[1];

    // 2. Verifica la firma e la scadenza matematica del JWT
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: "Segnale COMM-LINK corrotto o scaduto." });
    }

    // 3. Estrai l'ID della sessione (jti) e l'UUID dell'utente (sub)
    const sessionId = decoded.jti;
    if (!sessionId) {
      return res.status(401).json({ error: "Anomalia nel token (jti mancante)." });
    }

    // 4. Interroga Redis per verificare che la sessione sia ancora viva
    const sessionDataString = await redisClient.get(`session:${sessionId}`);
    
    if (!sessionDataString) {
      // Il JWT è matematicamente valido, ma la sessione su Redis è stata eliminata!
      return res.status(401).json({ error: "Sessione terminata o revocata. Effettua nuovamente il login." });
    }

    // 5. Accesso Autorizzato: Inietta i dati dell'utente nella richiesta
    // Così i controller successivi sapranno esattamente chi sta facendo l'azione
    req.user = {
      uuid: decoded.sub,
      sessionId: sessionId,
      sessionData: JSON.parse(sessionDataString) // Contiene IP, UserAgent, ecc.
    };

    // 6. Passa il comando al prossimo controller
    next();
    
  } catch (error) {
    console.error("--- Errore CheckCommLink ---", error);
    return res.status(500).json({ error: "Errore interno del sistema di autenticazione." });
  }
};

module.exports = checkCommLink;