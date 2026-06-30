const model = require("./matchModel");
const { getAuthContextFromRequest } = require("../shared/authContext.js");
const redis = require("../shared/redisClient.js");
const { getMatch: getMatchFromRedis } = require("../shared/matchMonolithic.js");
const Eru = require("./middleware/Eru.js");
const db = require("../shared/postgresClient.js");


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

    const ui = req.body;

    // MAPPATURA LOGICA: Traduciamo l'interfaccia nel linguaggio di Eru
    const gameMode = {
      nome_partita: ui.missione,
      stato: ui.avvio === "Immediato" ? "In corso" : "In attesa",
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

    const leaveData = await model.leaveMatch(playerId, matchId);
    const statusCode = parseInt(leaveData.status, 10) || 500;
    return res.status(statusCode).json(leaveData);
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito leave:", error);
    return res
      .status(500)
      .json({ error: "Errore interno", details: error.message });
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
const getStatus = async (req, res) => {
  try {
    const matchId = req.params.id;
    if (!matchId) return res.status(400).json({ error: "Match id mancante." });

    const matchData = await getMatchFromRedis(matchId);
    if (!matchData || !matchData.match) {
      return res.status(404).json({ error: "Partita non trovata." });
    }

    const struttura = matchData.match.struttura_partita;
    let stato = "Sconosciuto";
    let decoded = null;
    if (struttura) {
      try {
        decoded = Eru.decode_match(struttura);
        stato = decoded.stato || "Sconosciuto";
      } catch (_) { /* ignora errori di decodifica */ }
    }

    return res.status(200).json({
      matchId,
      stato,
      struttura_partita: struttura,
      player_count: (matchData.match.player || []).filter(p => p.isOccupied).length,
      max_players: decoded ? decoded.maxPlayersCount : null,
      caratteristiche: matchData.match.caratteristiche || {},
    });
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito getStatus:", error);
    return res.status(500).json({ error: "Errore interno", details: error.message });
  }
};

const getResult = async (req, res) => {
  try {
    const matchId = req.params.id;
    if (!matchId) return res.status(400).json({ error: "Match id mancante." });

    const matchData = await getMatchFromRedis(matchId);
    if (!matchData || !matchData.match) {
      return res.status(404).json({ error: "Partita non trovata." });
    }

    const struttura = matchData.match.struttura_partita || "";
    const isFinished = struttura.startsWith('10') || struttura.startsWith('11');

    const players = (matchData.match.player || []).map(p => ({
      username: p.username,
      id_user: p.id_user,
      isOccupied: p.isOccupied || false,
      id_alleanza: p.id_alleanza || null,
      territori_count: p.territori_dict
        ? Object.values(p.territori_dict).reduce((sum, list) => sum + (list ? list.length : 0), 0)
        : (p.territori ? p.territori.length : 0),
    }));

    return res.status(200).json({
      matchId,
      isFinished,
      players,
    });
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito getResult:", error);
    return res.status(500).json({ error: "Errore interno", details: error.message });
  }
};

const getMatch = async (req, res) => {
  try {
    const matchId = req.params.id;
    if (!matchId) return res.status(400).json({ error: "Match id mancante." });

    const matchData = await getMatchFromRedis(matchId);
    if (!matchData || !matchData.match) {
      return res.status(404).json({ error: "Partita non trovata." });
    }

    // Restituisce il match monolitico senza i dati sensibili (armate, risorse private)
    const publicMatch = {
      id_partita: matchData.match.id_partita,
      id_partita_hash: matchData.match.id_partita_hash,
      id_partita_visualizzato: matchData.match.id_partita_visualizzato,
      struttura_partita: matchData.match.struttura_partita,
      caratteristiche: matchData.match.caratteristiche || {},
      created_at: matchData.match.created_at,
      updated_at: matchData.updated_at,
      player_count: (matchData.match.player || []).filter(p => p.isOccupied).length,
      players: (matchData.match.player || []).map(p => ({
        username: p.username,
        playerId: p.username,
        name: p.nationName || p.username,
        isBot: String(p.username).toLowerCase().includes('bot'),
        isOccupied: p.isOccupied || false,
        id_alleanza: p.id_alleanza || null,
      })),
    };

    return res.status(200).json({ data: publicMatch });
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito getMatch:", error);
    return res.status(500).json({ error: "Errore interno", details: error.message });
  }
};

// getHistory: la tabella storico partite non è ancora implementata nel DB.
// Restituisce i dati di base della partita dalla cache Redis.
const getHistory = async (req, res) => {
  try {
    const matchId = req.params.id;
    if (!matchId) return res.status(400).json({ error: "Match id mancante." });

    const { rows } = await db.query(
      `SELECT p.id_partita, p.id_partita_hash, p.id_partita_visualizzato, p.nome_partita,
              p.struttura_partita::text AS struttura_partita, p.created_at,
              COUNT(pp.user_id) AS player_count
       FROM partite p
       LEFT JOIN partecipanti_partite pp ON pp.partita_id = p.id_partita
       WHERE p.id_partita_hash = $1 OR p.id_partita_visualizzato = $1 OR p.id_partita::text = $1
       GROUP BY p.id_partita
       LIMIT 1`,
      [matchId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Partita non trovata." });
    }

    const row = rows[0];
    return res.status(200).json({
      data: {
        id_partita_hash: row.id_partita_hash,
        id_partita_visualizzato: row.id_partita_visualizzato,
        nome_partita: row.nome_partita,
        struttura_partita: row.struttura_partita,
        created_at: row.created_at,
        player_count: Number(row.player_count),
      },
    });
  } catch (error) {
    console.error("[SYS_ERR] Cortocircuito getHistory:", error);
    return res.status(500).json({ error: "Errore interno", details: error.message });
  }
};

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

const translateRedisToFe = (resources) => {
  return {
    denaro: (resources && resources.denaro) || 0,
    legno: (resources && resources.legno) || 0,
    piombo: (resources && resources.piombo) || 0,
    acciaio: (resources && resources.acciaio) || 0,
    mattoni: (resources && resources.mattone) || 0,
    petrolio: (resources && resources.petrolio) || 0,
    gas_naturale: (resources && resources.gas) || 0,
    uranio: (resources && resources.uranio) || 0,
    oro: (resources && resources.oro) || 0
  };
};

const getInitialState = async (req, res) => {
  try {
    const matchId = req.params.id;
    if (!matchId) return res.status(400).json({ error: "Match id mancante." });

    const auth = await getAuthContextFromRequest(req);
    const username = auth ? auth.username : null;

    const matchData = await getMatchFromRedis(matchId);
    if (!matchData || !matchData.match) {
      return res.status(404).json({ error: "Partita non trovata." });
    }

    let armies = [];
    let nations = [];
    let resources = translateRedisToFe({});
    let production = translateRedisToFe({});
    let structures = [];
    let technologies = [];
    let trainings = [];

    if (matchData && matchData.match && matchData.match.player) {
      nations = matchData.match.player;
      const myPlayer = nations.find(p => p.username === username);
      const myAllianceId = myPlayer ? myPlayer.id_alleanza : null;

      for (const p of nations) {
        if (p.armate) {
          const playerArmies = Object.values(p.armate).map(a => ({ ...a, owner: p.username }));
          armies = armies.concat(playerArmies);
        }
        if (p.strutture) {
          const isAlly = myAllianceId && String(p.id_alleanza) === String(myAllianceId);
          if (p.username === username || isAlly) {
            const playerStr = p.strutture.map(s => ({ ...s, owner: p.username }));
            structures = structures.concat(playerStr);
          }
        }
        if (p.username === username) {
          resources = translateRedisToFe(p.risorse);
          production = translateRedisToFe(p.produzione);
          technologies = p.technologies || [];
          trainings = p.addestramenti || [];
        }
      }
    }

    const actualMatchId = matchData.match.id_partita_hash;
    const regionsResourcesStr = await redis.get(`match:${actualMatchId}:regions_resources`);
    const regionsResources = regionsResourcesStr ? JSON.parse(regionsResourcesStr) : {};

    const leaderboardStr = await redis.get(`match:${actualMatchId}:leaderboard`);
    const leaderboard = leaderboardStr ? JSON.parse(leaderboardStr) : [];

    return res.status(200).json({
      data: {
        armies,
        nations,
        resources,
        production,
        structures,
        regionsResources,
        technologies,
        trainings,
        leaderboard
      }
    });
  } catch (error) {
    console.error("[SYS_ERR] getInitialState:", error);
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
  getGraveyard,
  getInitialState
};
