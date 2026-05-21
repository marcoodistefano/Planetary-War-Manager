const model = require("./matchModel");

const notImplemented = (res) => res.status(501).json({ error: "Hardware o Endpoint non implementato" });

const create = async (req, res) => {
  try {
    const playerId = req.headers['x-user-id']; 
    if (!playerId) return res.status(401).json({ error: "Identità non verificabile." });

    const ui = req.body; // Dati grezzi dal frontend

    // MAPPATURA LOGICA: Traduciamo l'interfaccia nel linguaggio di Eru
    const gameMode = {
      stato: "In attesa", 
      squad: ui.isSquad,
      alleanzeConsentite: ui.alleanze,
      ranked: ui.hasElo,
      alleanzeWin: ui.alleanze, // Default: se ci sono alleanze, possono vincere
      randomSpawn: true,        // Default di sistema
      maxPlayers: ui.maxPlayers,
      duration: ui.durata,
      moltiplicatoreTemporale: ui.moltiplicatore,
      modalita: ui.modalita,
      // ERU si aspetta un array di stringhe per le regioni
      regioni: [ui.regione] 
    };

    // Eseguiamo la creazione (Una sola volta!)
    const matchResult = await model.createMatch({
      playerId: playerId,
      gameMode: gameMode
    });

    const statusCode = parseInt(matchResult.status, 10) || 500;
    return res.status(statusCode).json(matchResult);

  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito:", error);
    return res.status(500).json({ error: "Errore interno", details: error.message });
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