const model = require("./matchModel");

const notImplemented = (res) => res.status(501).json({ error: "Hardware o Endpoint non implementato" });

const create = async (req, res) => {
  try {
    // 1. ISOLAMENTO AUTORIZZATIVO (Zero Trust tra Servizi)
    // Leggiamo l'identità garantita dal Gateway tramite l'header interno
    const playerId = req.headers['x-user-id']; 

    if (!playerId) {
      console.warn("[SECURITY_BREACH] Richiesta rifiutata: ID Utente mancante dall'header interno.");
      return res.status(401).json({ error: "Accesso negato: Identità non verificabile." });
    }

    // 2. INCAPSULAMENTO E CHIAMATA AL MODEL (CPU/IO)
    const matchResult = await model.createMatch({
      playerId: playerId,
      gameMode: req.body // Il payload validato da Sauron
    });

    // 3. MULTIPLAXER DELLA RISPOSTA (Cast dei Tipi)
    // Trasformiamo la stringa di stato in un vero Integer HTTP
    const statusCode = parseInt(matchResult.status, 10) || 500;

    if (statusCode === 200) {
      // Circuito Chiuso: Successo
      return res.status(200).json({
        message: "Match istanziato con successo nel cluster",
        data: matchResult // Contiene matchId e altri metadati
      });
    } else {
      // Errore logico dal Model (es. "Utente già in partita")
      return res.status(statusCode).json({
        error: matchResult.message
      });
    }

  } catch (error) {
    // 4. GESTIONE KERNEL PANIC
    console.error("[SYS_ERR] Cortocircuito nel Match Controller:", error);
    return res.status(500).json({
      error: "Errore interno del server durante l'elaborazione del segnale",
      details: error.message,
    });
  } 
};

// Placeholder per le espansioni future
const join = async (req, res) => notImplemented(res);
const leave = async (req, res) => notImplemented(res);
const getPlayers = async (req, res) => notImplemented(res);
const getStatus = async (req, res) => notImplemented(res);
const getResult = async (req, res) => notImplemented(res);
const getMatch = async (req, res) => notImplemented(res);
const getHistory = async (req, res) => notImplemented(res);

module.exports = { 
  create, 
  join, 
  leave, 
  getPlayers, 
  getStatus, 
  getResult, 
  getMatch, 
  getHistory 
};