const model = require("./matchModel");

const notImplemented = (res) => res.status(501).json({ error: "Hardware o Endpoint non implementato" });

const normalizeRegions = (ui) => {
  if (Array.isArray(ui.regioni) && ui.regioni.length > 0) {
    const uniqueRegions = [...new Set(ui.regioni.filter(Boolean))];

    if (uniqueRegions.includes("World") && uniqueRegions.length > 1) {
      return uniqueRegions.filter((region) => region !== "World");
    }

    return uniqueRegions;
  }

  if (typeof ui.regione === "string" && ui.regione.trim() !== "") {
    return [ui.regione];
  }

  return ["World"];
};

const create = async (req, res) => {
  try {
    const playerId = req.headers['x-user-id']; 
    if (!playerId) return res.status(401).json({ error: "Identità non verificabile." });

    const ui = req.body; // Dati grezzi dal frontend

    // MAPPATURA LOGICA: Traduciamo l'interfaccia nel linguaggio di Eru
    const gameMode = {
      nome_partita: ui.missione,
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
      regioni: normalizeRegions(ui)
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
const join = async (req, res) => {
  try {
    const playerId = req.headers['x-user-id']; 
    if (!playerId) return res.status(401).json({ error: "Identità non verificabile." });

    const joinData = await model.joinMatch({
      playerId: playerId,
      matchId: req.params.id //da vedere cosa arriva dal front: il matchhId è il codice a 10 caratteri, non l'UUID o il nome!
    });

    const statusCode = parseInt(joinData.status, 10) || 500;
    return res.status(statusCode).json(joinData);

  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito:", error);
    return res.status(500).json({ error: "Errore interno", details: error.message });
  } 
};
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