const model = require("./matchModel");
const { getAuthContextFromRequest } = require("../shared/authContext.js");
const redis = require("../shared/redisClient.js");
const { getMatch: getMatchFromRedis } = require("../shared/matchMonolithic.js");
const Eru = require("./middleware/Eru.js");
const db = require("../shared/postgresClient.js");
const { getArmyLocation, haversineDist, getNodeCoords } = require("./middleware/movementLogic.js");
const { getArmyVisionRadius, isAirArmy, isStealthArmy, radarRadiusMap, defaultVisionRadius } = require("./middleware/gameUtils.js");


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

    const matchData = await getMatchFromRedis(matchId);
    if (!matchData || !matchData.match) {
      return res.status(404).json({ error: "Partita non trovata." });
    }

    let username = null;
    if (auth && auth.ok) {
      const myPlayer = matchData.match.player ? matchData.match.player.find(p => p.id_user === auth.userId) : null;
      if (myPlayer) {
        username = myPlayer.username;
      } else {
        const userRow = await db.query(`SELECT username FROM utenti WHERE id_user = $1`, [auth.userId]);
        if (userRow.rows.length > 0) {
          username = userRow.rows[0].username;
        }
      }
    }

    let armies = [];
    let nations = [];
    let resources = translateRedisToFe({});
    let production = translateRedisToFe({});
    let structures = [];
    let technologies = [];
    let trainings = [];
    let truppe = {};

    if (matchData && matchData.match && matchData.match.player) {
      nations = matchData.match.player;
      const myPlayer = nations.find(p => p.username === username);
      const myAllianceId = myPlayer ? myPlayer.id_alleanza : null;

      const alliedUsers = new Set(
        nations
          .filter(p => p.username === username || (myAllianceId && String(p.id_alleanza) === String(myAllianceId)))
          .map(p => p.username)
      );

      const alliedArmiesVision = [];
      const alliedRadars = [];
      const alliedTerritoriesCoords = [];

      for (const p of nations) {
        if (!alliedUsers.has(p.username)) continue;

        if (p.armate) {
          Object.values(p.armate).forEach(a => {
            const loc = getArmyLocation(a);
            if (loc) {
              alliedArmiesVision.push({
                coords: loc,
                radius: getArmyVisionRadius(a)
              });
            }
          });
        }

        if (p.strutture) {
          p.strutture.forEach(s => {
            if (s.status === 'built' && s.structureId && s.structureId.startsWith('radar_')) {
              const radius = radarRadiusMap[s.structureId] || 500;
              if (s.targetCoords) {
                alliedRadars.push({
                  coords: s.targetCoords,
                  radius: radius,
                  isAntiAir: s.structureId.startsWith('radar_anti_aereo')
                });
              }
            }
          });
        }

        const pTerrNames = new Set();
        if (p.territori_dict) {
          Object.values(p.territori_dict).forEach(provs => {
            provs.forEach(t => pTerrNames.add(String(t).trim().toLowerCase()));
          });
        } else if (p.territori) {
          p.territori.forEach(t => pTerrNames.add(String(t).trim().toLowerCase()));
        }

        pTerrNames.forEach(nodeName => {
          const coords = getNodeCoords(nodeName);
          if (coords) {
            alliedTerritoriesCoords.push(coords);
          }
        });
      }

      for (const p of nations) {
        if (p.armate) {
          const playerArmies = Object.values(p.armate).map(a => ({ ...a, owner: p.username }));
          if (alliedUsers.has(p.username)) {
            armies = armies.concat(playerArmies);
          } else {
            const visibleEnemies = playerArmies.filter(enemy => {
              const enemyLoc = getArmyLocation(enemy);
              if (!enemyLoc) return false;

              for (const tCoord of alliedTerritoriesCoords) {
                if (haversineDist(enemyLoc[0], enemyLoc[1], tCoord[0], tCoord[1]) <= defaultVisionRadius) {
                  return true;
                }
              }

              for (const aVision of alliedArmiesVision) {
                if (haversineDist(enemyLoc[0], enemyLoc[1], aVision.coords[0], aVision.coords[1]) <= aVision.radius) {
                  return true;
                }
              }

              for (const radar of alliedRadars) {
                if (haversineDist(enemyLoc[0], enemyLoc[1], radar.coords[0], radar.coords[1]) <= radar.radius) {
                  if (isStealthArmy(enemy)) continue;
                  if (radar.isAntiAir && !isAirArmy(enemy)) continue;
                  if (!radar.isAntiAir && isAirArmy(enemy)) continue;
                  return true;
                }
              }

              return false;
            });
            armies = armies.concat(visibleEnemies);
          }
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
          truppe = Object.fromEntries(Object.entries(p.truppe || {}).filter(([k, v]) => typeof v === 'number'));
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
        leaderboard,
        truppe
      }
    });
  } catch (error) {
    console.error("[SYS_ERR] getInitialState:", error);
    return res.status(500).json({ error: "Errore interno", details: error.message });
  }
};


const tacticalDecision = async (req, res) => {
  try {
    const { id } = req.params;
    const { decisionType, choice, attackerArmyId, defenderArmyId } = req.body;
    const auth = await getAuthContextFromRequest(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ error: "Identita non verificabile." });
    const username = auth.userId;

    if (decisionType === 'PURSUIT') {
      if (choice === 'PURSUE') {
        const redis = require('../../shared/redisClient.js');
        const { getMatch, updateMatch } = require('../../shared/matchMonolithic.js');

        const { calculatePath, getArmyLocation } = require('./middleware/movementLogic.js');
        const { getArmyDomain, getArmyType } = require('./middleware/gameUtils.js');

        await updateMatch(id, async (mObj) => {
          const attackerPlayer = mObj.match.player.find(p => p.username === username);
          // Find defender army to get its location
          let defArmy = null;
          for (const p of mObj.match.player) {
            if (p.armate && p.armate[defenderArmyId]) {
              defArmy = p.armate[defenderArmyId];
              break;
            }
          }

          if (attackerPlayer && attackerPlayer.armate && attackerPlayer.armate[attackerArmyId] && defArmy) {
            const a = attackerPlayer.armate[attackerArmyId];
            const attLoc = getArmyLocation(a) || (a.currentLocation ? a.currentLocation.split(',').map(Number) : null);
            const defLoc = getArmyLocation(defArmy) || (defArmy.currentLocation ? defArmy.currentLocation.split(',').map(Number) : null);

            if (attLoc && defLoc) {
              const path = await calculatePath(attLoc[0], attLoc[1], defLoc[0], defLoc[1], getArmyDomain(a), getArmyType(a));

              a.status = 'Pronto all\'attacco';
              a.targetName = defenderArmyId;
              a.targetCoords = [defLoc[0], defLoc[1]];
              a.missionMode = 'attacco';
              a.path = path;
              a.startTime = new Date().toISOString();
            }
          }
          return { save: true, matchObj: mObj };
        });
        console.log(`[TACTICAL] ${username} ha deciso di INSEGUIRE ${defenderArmyId} con l'armata ${attackerArmyId}`);
        return res.status(200).json({ success: true, message: "Inseguimento avviato" });
      } else {
        // HOLD position
        console.log(`[TACTICAL] ${username} ha deciso di MANTENERE LA POSIZIONE con l'armata ${attackerArmyId}`);
        // L'armata rimane in standby o riprende l'ordine, ci penserà il loop di combattimento
        return res.status(200).json({ success: true, message: "Posizione mantenuta" });
      }
    }

    res.status(400).json({ error: "Tipo di decisione non supportato" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore interno" });
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
  getInitialState,
  tacticalDecision
};
