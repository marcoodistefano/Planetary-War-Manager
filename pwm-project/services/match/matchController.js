const model = require("./matchModel");
const { getAuthContextFromRequest } = require("../shared/authContext.js");
const redis = require("../shared/redisClient.js");

const notImplemented = (res) =>
  res.status(501).json({ error: "Hardware o Endpoint non implementato" });

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
    const auth = await getAuthContextFromRequest(req);
    if (!auth.ok)
      return res
        .status(auth.status || 401)
        .json({ error: "Identita non verificabile." });
    const playerId = auth.userId;

    const ui = req.body; // Dati grezzi dal frontend

    // MAPPATURA LOGICA: Traduciamo l'interfaccia nel linguaggio di Eru
    const gameMode = {
      nome_partita: ui.missione,
      stato: "In attesa",
      squad: ui.isSquad,
      alleanzeConsentite: ui.alleanze,
      ranked: ui.hasElo,
      alleanzeWin: ui.alleanze, // Default: se ci sono alleanze, possono vincere
      randomSpawn: true, // Default di sistema
      maxPlayers: ui.maxPlayers,
      duration: ui.durata,
      moltiplicatoreTemporale: ui.moltiplicatore,
      modalita: ui.modalita,
      // ERU si aspetta un array di stringhe per le regioni
      regioni: normalizeRegions(ui),
    };

    // Eseguiamo la creazione (Una sola volta!)
    const matchResult = await model.createMatch({
      playerId: playerId,
      gameMode: gameMode,
    });

    const statusCode = parseInt(matchResult.status, 10) || 500;
    return res.status(statusCode).json(matchResult);
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito:", error);
    return res
      .status(500)
      .json({ error: "Errore interno", details: error.message });
  }
};

const join = async (req, res) => {
  try {
    const auth = await getAuthContextFromRequest(req);
    if (!auth.ok)
      return res
        .status(auth.status || 401)
        .json({ error: "Identita non verificabile." });
    const playerId = auth.userId;

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
    return res
      .status(500)
      .json({ error: "Errore interno", details: error.message });
  }
};

const joinable = async (req, res) => {
  //get partite joinable, disponibile all'utente per GET visualizzazione partite joinable.
  //il client fa una GET a /match/joinable ogni X secondi. OPPURE WS?
  //ALLA PRIMA INTERAZIONE (ALL'AVVIO) SI PRENDONO LE INFO DAL DB.
  //L'UTENTE CHIAMANTE DEVE CONTATTARE REDIS.
  //TO UPDATE
  try {
    const auth = await getAuthContextFromRequest(req);
    const playerId = auth.ok ? auth.userId : null;

    const result = await model.listJoinableMatches(playerId);
    const statusCode = parseInt(result.status, 10) || 500;
    return res.status(statusCode).json(result);
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito joinable:", error);
    return res
      .status(500)
      .json({ error: "Errore interno", details: error.message });
  }
};
const leave = async (req, res) => {
  try {
    const auth = await getAuthContextFromRequest(req);
    if (!auth.ok)
      return res
        .status(auth.status || 401)
        .json({ error: "Identita non verificabile." });
    const playerId = auth.userId;
    const matchId = req.params.id;
    if (!matchId) return res.status(400).json({ error: "Match id mancante." });
    const redisKey = `match:${matchId}`;

    // 1. Verifica esistenza partita e stato da Redis
    const cachedMatch = await redis.get(redisKey);
    if (!cachedMatch) {
      return { status: "404", message: "Partita non trovata." };
    }
    const red = redis.set(`match:${matchId}:${playerId}`, "Offline");
    if (red)
      return res.status(200).json({ message: "Richiesta di leave inviata." });
    else
      return res
        .status(500)
        .json({ error: "Errore durante l'ingresso nella partita" });
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito leave:", error);
    return res
      .status(500)
      .json({ error: "Errore interno", details: error.message });
  }
};

const joinMatch = async (playerId, matchId) => {
  try {
    const auth = await getAuthContextFromRequest(req);
    if (!auth.ok)
      return { status: "401", message: "Identita non verificabile." };
    const playerId = auth.userId;
    const matchId = req.params.id;
    if (!matchId) return { status: "400", message: "Match id mancante." };
    const redisKey = `match:${matchId}`;

    // 1. Verifica esistenza partita e stato da Redis
    const cachedMatch = await redis.get(redisKey);
    if (!cachedMatch) {
      return { status: "404", message: "Partita non trovata." };
    }
    const red = redis.set(`match:${matchId}:${playerId}`, "Online"); // Indica che il player è in joinato DA VEDERE IL PERCORSO CORRETTO
    if (red)
      return res
        .status(200)
        .json({ message: "Ingresso avvenuto con successo" });
    else
      return res
        .status(500)
        .json({ error: "Errore durante l'ingresso nella partita" });
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito joinMatch:", error);
    return { status: "500", message: "Errore interno", details: error.message };
  }
};

const getPlayers = async (req, res) => {
  try {
    const matchId = req.params.id;
    if (!matchId) return res.status(400).json({ error: "Match id mancante." });
    const result = await model.getMatchPlayers(matchId);
    const statusCode = parseInt(result.status, 10) || 500;
    return res.status(statusCode).json(result);
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito getPlayers:", error);
    return res
      .status(500)
      .json({ error: "Errore interno", details: error.message });
  }
};
const getStatus = async (req, res) => notImplemented(res);
const getResult = async (req, res) => notImplemented(res);
const getMatch = async (req, res) => notImplemented(res);
const getHistory = async (req, res) => notImplemented(res);

const CreateAlliance = async (req, res) => {
  try {
    const auth = await getAuthContextFromRequest(req);
    if (!auth.ok)
      return res
        .status(auth.status || 401)
        .json({ error: "Identita non verificabile." });
    const playerId = auth.userId;
    const matchId = req.params.id;
    const allianceName = req.body?.allianceName || req.body?.nome_alleanza;
    if (!matchId) return res.status(400).json({ error: "Match id mancante." });
    if (!allianceName || !String(allianceName).trim()) {
      return res.status(400).json({ error: "Nome alleanza mancante." });
    }
    const result = await model.createAlliance(
      playerId,
      matchId,
      String(allianceName).trim(),
    );
    const statusCode = parseInt(result.status, 10) || 500;
    return res.status(statusCode).json(result);
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito CreateAlliance:", error);
    return res
      .status(500)
      .json({ error: "Errore interno", details: error.message });
  }
};

const getAlliance = async (req, res) => {
  try {
    const matchId = req.params.id;
    const auth = await getAuthContextFromRequest(req);
    if (!auth.ok)
      return res
        .status(auth.status || 401)
        .json({ error: "Identita non verificabile." });
    if (!matchId) return res.status(400).json({ error: "Match id mancante." });
    const result = await model.getMatchAlliance(matchId);
    const statusCode = parseInt(result.status, 10) || 500;
    return res.status(statusCode).json(result);
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito getAlliance:", error);
    return res
      .status(500)
      .json({ error: "Errore interno", details: error.message });
  }
};

const JoinAlliance = async (req, res) => {
  try {
    const auth = await getAuthContextFromRequest(req);
    if (!auth.ok)
      return res
        .status(auth.status || 401)
        .json({ error: "Identita non verificabile." });
    const playerId = auth.userId;
    const matchId = req.params.id;
    const allianceId = req.params.id_alliance;
    if (!matchId || !allianceId)
      return res
        .status(400)
        .json({ error: "Match id o Alliance id mancante." });
    const result = await model.joinAlliance(playerId, matchId, allianceId);
    const statusCode = parseInt(result.status, 10) || 500;
    return res.status(statusCode).json(result);
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito JoinAlliance:", error);
    return res
      .status(500)
      .json({ error: "Errore interno", details: error.message });
  }
};

const LeaveAlliance = async (req, res) => {
  try {
    const auth = await getAuthContextFromRequest(req);
    if (!auth.ok)
      return res
        .status(auth.status || 401)
        .json({ error: "Identita non verificabile." });
    const playerId = auth.userId;
    const matchId = req.params.id;
    const allianceId = req.params.id_alliance;
    if (!matchId || !allianceId)
      return res
        .status(400)
        .json({ error: "Match id o Alliance id mancante." });
    const result = await model.leaveAlliance(playerId, matchId, allianceId);
    const statusCode = parseInt(result.status, 10) || 500;
    return res.status(statusCode).json(result);
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito LeaveAlliance:", error);
    return res
      .status(500)
      .json({ error: "Errore interno", details: error.message });
  }
};

const KickAlliance = async (req, res) => {
  try {
    const auth = await getAuthContextFromRequest(req);
    if (!auth.ok)
      return res
        .status(auth.status || 401)
        .json({ error: "Identita non verificabile." });
    const playerId = auth.userId;
    const targetPlayerId = req.body.targetPlayerId; // L'ID del giocatore da espellere è passato come id_alliance
    const motivation = req.body.motivation; // Motivazione opzionale per l'espulsione
    const matchId = req.params.id;
    const allianceId = req.params.id_alliance;
    if (!matchId || !allianceId || !targetPlayerId)
      return res
        .status(400)
        .json({ error: "Match id, player target o Alliance id mancante." });
    const result = await model.kickAlliance(playerId, matchId, allianceId, targetPlayerId, motivation);
    const statusCode = parseInt(result.status, 10) || 500;
    return res.status(statusCode).json(result);
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito KickAlliance:", error);
    return res
      .status(500)
      .json({ error: "Errore interno", details: error.message });
  }
};

const getGraveyard = async (req, res) => {
  try {
    const matchId = req.params.id;
    const username = req.params.username;
    
    if (!matchId || !username) {
      return res.status(400).json({ error: "Match id o username mancante." });
    }
    
    const result = await model.getGraveyard(matchId, username);
    const statusCode = parseInt(result.status, 10) || 500;
    return res.status(statusCode).json(result);
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito getGraveyard:", error);
    return res.status(500).json({ error: "Errore interno", details: error.message });
  }
};

module.exports = {
  create,
  join,
  joinable,
  leave,
  getPlayers,
  getStatus,
  getResult,
  getMatch,
  getHistory,
  getAlliance,
  CreateAlliance,
  JoinAlliance,
  LeaveAlliance,
  KickAlliance,
  getGraveyard
};
