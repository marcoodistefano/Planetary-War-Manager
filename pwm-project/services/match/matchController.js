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

    const matchId = req.params.id || req.body?.matchId;
    if (!matchId) return res.status(400).json({ error: "Match id mancante." });

    const joinData = await model.join_Match(playerId, matchId);

    const statusCode = parseInt(joinData.status, 10) || 500;
    return res.status(statusCode).json(joinData);
    //al join devo verificare che, se la partita è startata (totalmente e non è più possibile unirsi in termini di tempo) o di numero di giocatori, venga restituito un errore specifico (es. 403) con messaggio chiaro (es. "Partita già iniziata, non è più possibile unirsi.")
    //e occorre updetare REDIS!
    //TO UPDATE
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito:", error);
    return res.status(500).json({ error: "Errore interno", details: error.message });
  } 
};

const joinable = async (req, res) => {//get partite joinable, disponibile all'utente per GET visualizzazione partite joinable.
  //il client fa una GET a /match/joinable ogni X secondi. OPPURE WS? 
  //ALLA PRIMA INTERAZIONE (ALL'AVVIO) SI PRENDONO LE INFO DAL DB.
  //L'UTENTE CHIAMANTE DEVE CONTATTARE REDIS.
  //TO UPDATE
  try {
    const result = await model.listJoinableMatches();
    const statusCode = parseInt(result.status, 10) || 500;
    return res.status(statusCode).json(result);
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito joinable:", error);
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
  joinable,
  leave, 
  getPlayers, 
  getStatus, 
  getResult, 
  getMatch, 
  getHistory 
};