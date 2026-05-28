const aslan = require("./middleware/Aslan.js");
const db = require("../shared/postgresClient.js");
const redis = require("../shared/redisClient.js"); // Client Redis collegato
const Eru = require("./middleware/Eru.js");

let hasAbbandonoAlleanzaAtColumnCache = null;

const hasAbbandonoAlleanzaAtColumn = async (client = db) => {
  if (hasAbbandonoAlleanzaAtColumnCache !== null) {
    return hasAbbandonoAlleanzaAtColumnCache;
  }

  try {
    const { rows } = await client.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_name = 'partecipanti_partite'
         AND column_name = 'abbandono_alleanza_at'
       LIMIT 1;`,
    );
    hasAbbandonoAlleanzaAtColumnCache = rows.length > 0;
  } catch (error) {
    hasAbbandonoAlleanzaAtColumnCache = false;
  }

  return hasAbbandonoAlleanzaAtColumnCache;
};

// Helper: write match state under three Redis keys (internal id, hash, visual id)
const setMatchCacheAllIds = async ({
  id_partita,
  id_partita_hash,
  id_partita_visualizzato,
  stateObj,
  ttlSeconds = 86400,
}) => {
  try {
    const payload =
      typeof stateObj === "string" ? stateObj : JSON.stringify(stateObj || {});
    const keys = [
      `match:${id_partita}`,
      `match:${id_partita_hash}`,
      `match:${id_partita_visualizzato}`,
    ];
    const ops = keys.map((k) => redis.set(k, payload));
    await Promise.all(ops);
    // apply TTL to non-empty keys
    await Promise.all(keys.map((k) => redis.expire(k, ttlSeconds)));
  } catch (e) {
    console.error("[SYS_WARN] setMatchCacheAllIds failed:", e.message);
  }
};

// ============================================================================
// 1. CREAZIONE PARTITA (Postgres + Istanza Redis)
// ============================================================================
const createMatch = async ({ playerId, gameMode }) => {
  try {
    // A. Controllo Pre-Flight (Check partite attive dell'host)
    const activeMatches = await db.query(
      `SELECT count(p.id_partita) FROM partite p 
       WHERE p.id_host = $1 AND substring(p.struttura_partita::text from 1 for 2) IN ('00', '01');`,
      [playerId],
    );

    if (
      activeMatches.rows &&
      activeMatches.rows.length > 0 &&
      parseInt(activeMatches.rows[0].count) > 0
    ) {
      return {
        status: "400",
        message: "Hai già una partita attiva come host.",
      };
    }

    // B. Generazione Frame a 56-Bit via Eru
    gameMode.stato = "In attesa";
    const eruRes = Eru.procedure_create_match({ body: gameMode });
    if (eruRes.binary_match.length !== 56)
      throw new Error("Errore critico di clock nel Multiplexer Eru.");

    // C. Generazione Identificativi
    const id_partita_hash = await aslan.generateSecureToken(255); //L'hash della partita deve essere calcolato passando come parametri TUTTE le info della partita!
    //ad ora è un token casuale, ma è da modificare.
    //TO UPDATE
    const id_partita_visualizzato = await aslan.generateSecureToken(10);

    // D. Transazione SQL (Persistenza)
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const matchInsert = await client.query(
        `INSERT INTO partite (nome_partita, id_partita_hash, id_partita_visualizzato, id_host, struttura_partita, has_elo) 
         VALUES ($1, $2, $3, $4, $5::bit(56), $6)
         RETURNING id_partita;`,
        [
          gameMode.nome_partita || "Operazione senza nome",
          id_partita_hash,
          id_partita_visualizzato,
          playerId,
          eruRes.binary_match,
          gameMode.hasElo || false,
        ],
      );

      const partitaId = matchInsert.rows[0].id_partita;

      await client.query(
        `INSERT INTO partecipanti_partite (partita_id, user_id) VALUES ($1, $2);`,
        [partitaId, playerId],
      );

      await client.query("COMMIT");

      // Invalida la home dell'host: la lista delle partite create deve rigenerarsi subito
      await redis.del(`home_info:${playerId}`);

      // E. ISTANZIAZIONE REDIS (Iniezione in Memoria Volatile)
      // La partita viene caricata in Redis sotto tutte e tre le chiavi
      // (id_partita, id_partita_hash, id_partita_visualizzato)
      const matchCache = {
        id_partita: partitaId,
        id_partita_hash: id_partita_hash,
        id_partita_visualizzato: id_partita_visualizzato,
        struttura_partita: eruRes.binary_match,
        created_at: new Date().toISOString(),
      };
      await setMatchCacheAllIds({
        id_partita: partitaId,
        id_partita_hash: id_partita_hash,
        id_partita_visualizzato: id_partita_visualizzato,
        stateObj: matchCache,
      });

      console.log(
        `[SYS_OK] Partita istanziata su Postgres e caricata in cache Redis: ${id_partita_hash}`,
      );

      return {
        status: "200",
        message: "Partita creata e istanziata correttamente.",
        matchId: id_partita_hash,
      };
    } catch (dbError) {
      await client.query("ROLLBACK");
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("[SYS_ERR] Errore durante createMatch:", error);
    return {
      status: "500",
      message:
        "Errore interno durante la creazione e istanziazione della partita.",
    };
  }
};

// ============================================================================
// 2. JOIN ALLA PARTITA E AGGIORNAMENTO CACHE
// ============================================================================
const join_Match = async (playerId, id_partita_hash) => {
  try {
    const client = await db.connect();
    const redisKey = `match:${id_partita_hash}:status`;

    try {
      await client.query("BEGIN");

      // 1. Lock riga database
      const matchQuery = await client.query(
        `SELECT id_partita, struttura_partita::text AS struct FROM partite WHERE id_partita_hash = $1 FOR UPDATE;`,
        [id_partita_hash],
      );

      if (matchQuery.rows.length === 0)
        throw { customStatus: "404", message: "Partita non trovata." };
      const partitaId = matchQuery.rows[0].id_partita;
      const currentStruct = matchQuery.rows[0].struct;

      // 2. Verifica se utente già presente
      const checkUser = await client.query(
        `SELECT 1 FROM partecipanti_partite WHERE partita_id = $1 AND user_id = $2`,
        [partitaId, playerId],
      );
      if (checkUser.rows.length > 0)
        throw { customStatus: "400", message: "Sei già in questa partita." };

      // 3. Inserimento e conteggio
      await client.query(
        `INSERT INTO partecipanti_partite (partita_id, user_id) VALUES ($1, $2);`,
        [partitaId, playerId],
      );
      const countRes = await client.query(
        `SELECT count(*) FROM partecipanti_partite WHERE partita_id = $1;`,
        [partitaId],
      );
      const playerCount = parseInt(countRes.rows[0].count);

      // 4. Check Avvio con Eru
      const eru_start = Eru.check_start_match(currentStruct, playerCount);

      if (eru_start.status === 200) {
        // A. Aggiornamento Postgres (Stato -> IN_CORSO)
        await client.query(
          `UPDATE partite SET struttura_partita = $1::bit(56) WHERE id_partita_hash = $2;`,
          [eru_start.struttura_partita, id_partita_hash],
        );

        // B. Sincronizzazione Redis
        // Sovrascriviamo il frame in cache con il nuovo stato "IN_CORSO"
        const matchCache = {
          id_partita: partitaId,
          id_partita_hash: id_partita_hash,
          id_partita_visualizzato: id_partita_visualizzato,
          struttura_partita: eru_start.struttura_partita,
          updated_at: new Date().toISOString(),
        };
        await setMatchCacheAllIds({
          id_partita: partitaId,
          id_partita_hash: id_partita_hash,
          id_partita_visualizzato: id_partita_visualizzato,
          stateObj: matchCache,
        });

        console.log(
          `[SYS_EVENT] Match ${id_partita_hash} AVVIATO. Cache Redis aggiornata.`,
        );
      }

      await client.query("COMMIT");

      // Anche il join cambia la home dell'utente: rimuoviamo il cache snapshot
      await redis.del(`home_info:${playerId}`);
      return {
        status: "200",
        message: "Join completato.",
        structure: eru_start.struttura_partita,
      };
    } catch (innerError) {
      await client.query("ROLLBACK");
      if (innerError.customStatus)
        return { status: innerError.customStatus, message: innerError.message };
      throw innerError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("[SYS_ERR] Errore durante join_Match:", error);
    return { status: "500", message: "Errore durante il join alla partita." };
  }
};

// ============================================================================
// 3. LISTA PARTITE JOINABILI (MINIMAL) [SOLO IN FASE DI CARICAMENTO REDIS]
// ============================================================================
const listJoinableMatches = async () => {
  //ALLA PRIMA INTERAZIONE (ALL'AVVIO) SI PRENDONO LE INFO DAL DB.
  //L'UTENTE CHIAMANTE DEVE CONTATTARE REDIS.
  //TO UPDATE
  try {
    //IF NOT IN REDIS...ELSE RETURN FROM REDIS
    const query = `
      SELECT
        m.id_partita,
        m.id_partita_hash,
        m.id_partita_visualizzato,
        m.nome_partita,
        m.struttura_partita::text AS struttura_partita,
        m.created_at,
        COUNT(p.user_id) AS player_count
      FROM partite m
      LEFT JOIN partecipanti_partite p ON p.partita_id = m.id_partita
      WHERE substring(m.struttura_partita::text from 1 for 2) IN ('00', '01')
      GROUP BY m.id_partita
      ORDER BY m.created_at DESC;
    `;

    const { rows } = await db.query(query);
    const matches = rows
      .map((row) => {
        const decoded = Eru.decode_match(row.struttura_partita);
        const playerCount = Number(row.player_count);
        const maxPlayersCount = decoded.maxPlayersCount || 0;
        const canJoin =
          maxPlayersCount === 0 ? true : playerCount < maxPlayersCount;

        return {
          id_partita_hash: row.id_partita_hash,
          id_partita_visualizzato: row.id_partita_visualizzato,
          nome_partita: row.nome_partita,
          stato: decoded.stato,
          player_count: playerCount,
          max_players: decoded.maxPlayers,
          max_players_count: maxPlayersCount,
          created_at: row.created_at,
          can_join: canJoin,
        };
      })
      .filter((row) => row.can_join);

    return { status: "200", matches };
  } catch (error) {
    console.error("[SYS_ERR] Errore durante listJoinableMatches:", error);
    return {
      status: "500",
      message: "Errore durante il caricamento delle partite.",
    };
  }
};
const getMatchPlayers = async (matchId) => {
  try {
    const cachedPlayers = await redis.get(`match:${matchId}:players`);
    if (cachedPlayers) {
      console.log(
        `[SYS_CACHE] Players per match ${matchId} recuperati da Redis.`,
      );
      return { status: "200", players: JSON.parse(cachedPlayers) };
    } else {
      const query = `
        SELECT u.username, u.avatar_id
        FROM partecipanti_partite pp
        INNER JOIN utenti u ON pp.user_id = u.id_user
        INNER JOIN partite p ON pp.partita_id = p.id_partita
        WHERE p.id_partita = (SELECT id_partita FROM partite WHERE id_partita_visualizzato = $1);
      `;
      const { rows } = await db.query(query, [matchId]);
      return { status: "200", players: rows };
    }
  } catch (error) {
    console.error("[SYS_ERR] Errore durante getMatchPlayers:", error);
    return {
      status: "500",
      message: "Errore durante il caricamento dei giocatori della partita.",
    };
  }
};

const getMatchAlliance = async (matchId) => {
  try {
    if (!matchId) return { status: "400", message: "Match id mancante." };
    const cached = await redis.get(`match:${matchId}:alliances`);
    if (cached) {
      console.log(
        `[SYS_CACHE] Alliances per match ${matchId} recuperati da Redis.`,
      );
      return { status: "200", alliances: JSON.parse(cached) };
    } else {
      const query = `
        SELECT 
          a.id_alleanza,
          a.nome_alleanza,
          a.nome_logo, 
          COUNT(pa.user_id) AS numero_partecipanti,
          COALESCE(
            array_agg(u.username) FILTER (WHERE u.username IS NOT NULL),
            ARRAY[]::text[]
          ) AS members
        FROM partite p
        INNER JOIN alleanze a ON p.id_partita = a.id_partita
        LEFT JOIN partecipanti_partite pa ON a.id_alleanza = pa.id_alleanza AND pa.partita_id = p.id_partita
        LEFT JOIN utenti u ON pa.user_id = u.id_user
        WHERE p.id_partita_visualizzato = $1
        GROUP BY 
          a.id_alleanza, 
          a.nome_alleanza, 
          a.nome_logo;
      `;
      const { rows } = await db.query(query, [matchId]);
      if (rows.length > 0) {
        await redis.set(`match:${matchId}:alliances`, JSON.stringify(rows));
        return { status: "200", alliances: rows };
      } else {
        return {
          status: "404",
          message: "Nessuna alleanza trovata per questa partita.",
        };
      }
    }
  } catch (error) {
    console.error("[SYS_ERR] Errore durante getMatchAlliance:", error);
    return { status: "500", message: "Errore interno", details: error.message };
  }
};
const createAlliance = async (playerId, matchId, allianceName) => {
  try {
    if (!matchId) return { status: "400", message: "Match id mancante." };
    // Server-side normalization: compress multiple spaces and trim
    const normalizedAllianceName = String(allianceName || "")
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalizedAllianceName) {
      return { status: "400", message: "Nome alleanza mancante." };
    }

    // Validation: length and allowed chars (keep consistent with frontend)
    const MAX_LEN = 32;
    if (normalizedAllianceName.length > MAX_LEN) {
      return {
        status: "400",
        message: `Il nome alleanza non puo superare ${MAX_LEN} caratteri.`,
      };
    }

    if (!/^[a-zA-Z0-9 _.'-]+$/.test(normalizedAllianceName)) {
      return {
        status: "400",
        message: "Il nome alleanza contiene caratteri non consentiti.",
      };
    }
    const is_in_alliance = await redis.get(
      `match:${matchId}:player:${playerId}:in_alliance`,
    );
    if (is_in_alliance === "true") {
      return {
        status: "400",
        message: "Sei già in un'alleanza in questa partita.",
      };
    }
    if (is_in_alliance === null) {
      const checkRes = await db.query(
        `SELECT id_alleanza FROM partecipanti_partite WHERE user_id = $1 AND partita_id = (SELECT id_partita FROM partite WHERE id_partita_visualizzato = $2)`,
        [playerId, matchId],
      );
      if (checkRes.rows.length > 0 && checkRes.rows[0].id_alleanza) {
        await redis.set(
          `match:${matchId}:player:${playerId}:in_alliance`,
          "true",
        );
        return {
          status: "400",
          message: "Sei già in un'alleanza in questa partita.",
        };
      }
    }
    const cooldownCheck = await checkLastLeaveCooldown(playerId, matchId);
    if (cooldownCheck.status !== "200") {
      return cooldownCheck; // Restituisce il messaggio di errore se il cooldown non è rispettato
    }
    // Il nome dell'alleanza deve essere unico all'interno della partita
    const nameCheck = await redis.get(
      `match:${matchId}:id_alliance:${normalizedAllianceName}`,
    );
    if (nameCheck) {
      return {
        status: "400",
        message: "Il nome dell'alleanza è già in uso in questa partita.",
      };
    }
    if (nameCheck === null) {
      const dbNameCheck = await db.query(
        `SELECT 1
         FROM alleanze a
         INNER JOIN partite p ON a.id_partita = p.id_partita
         WHERE a.nome_alleanza = $1 AND p.id_partita_visualizzato = $2
         LIMIT 1`,
        [normalizedAllianceName, matchId],
      );
      if (dbNameCheck.rows.length > 0) {
        await redis.set(
          `match:${matchId}:id_alliance:${normalizedAllianceName}`,
          "true",
        );
        return {
          status: "400",
          message: "Il nome dell'alleanza è già in uso in questa partita.",
        };
      }
    }
    const insertRes = await db.query(
      `INSERT INTO alleanze (id_partita, nome_alleanza, id_leader) 
       VALUES ((SELECT id_partita FROM partite WHERE id_partita_visualizzato = $1), $2, $3) 
       RETURNING id_alleanza, nome_alleanza;`,
      [matchId, normalizedAllianceName, playerId],
    );
    if (insertRes.rows.length === 0) {
      return { status: "500", message: "Impossibile creare l'alleanza." };
    }
    const allianceId = insertRes.rows[0].id_alleanza;
    await db.query(
      `UPDATE partecipanti_partite SET id_alleanza = $1 WHERE user_id = $2 AND partita_id = (SELECT id_partita FROM partite WHERE id_partita_visualizzato = $3)`,
      [allianceId, playerId, matchId],
    );
    await redis.set(
      `match:${matchId}:id_alliance:${normalizedAllianceName}`,
      String(allianceId),
    );
    const res1 = await redis.set(
      `match:${matchId}:player:${playerId}:in_alliance`,
      "true",
    );
    const res2 = await redis.set(
      `match:${matchId}:player:${playerId}:id_alliance:is_leader`,
      "true",
    );
    if (res1 !== "OK" || res2 !== "OK") {
      console.warn(
        `[SYS_WARN] Redis set failed during createAlliance for player ${playerId} in match ${matchId}.`,
      );
    } else {
      console.log(
        `[SYS_CACHE] Player ${playerId} marked as in_alliance and leader for match ${matchId} in Redis.`,
      );
    }

    return {
      status: "200",
      message: "Alleanza creata e joinata con successo",
      alliance: insertRes.rows[0],
    };
  } catch (error) {
    console.error("[SYS_ERR] Errore durante createAlliance:", error);
    return { status: "500", message: "Errore interno", details: error.message };
  }
};

const checkLastLeaveCooldown = async (playerId, matchId) => {
  try {
    const hasCooldownColumn = await hasAbbandonoAlleanzaAtColumn();
    if (!hasCooldownColumn) {
      return { status: "200", message: "Cooldown non disponibile nello schema corrente." };
    }

    const membershipRes = await db.query(
      `SELECT abbandono_alleanza_at
       FROM partecipanti_partite
       WHERE user_id = $1 AND partita_id = (SELECT id_partita FROM partite WHERE id_partita_visualizzato = $2)
       FOR UPDATE`,
      [playerId, matchId],
    );
    if (membershipRes.rows.length === 0) {
      return {
        status: "404",
        message: "Partecipante non trovato nella partita.",
      };
    }

    const lastLeaveAt = membershipRes.rows[0].abbandono_alleanza_at;
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    if (lastLeaveAt) {
      const lastLeaveTs = new Date(lastLeaveAt).getTime();
      if (now - lastLeaveTs < DAY_MS) {
        return {
          status: "400",
          message:
            "Non puoi unirti a un'alleanza entro 24 ore dall'ultimo abbandono.",
        };
      }
    }
    return { status: "200", message: "Cooldown rispettato." };
  } catch (error) {
    console.error("[SYS_ERR] Errore durante checkLastLeaveCooldown:", error);
    return { status: "500", message: "Errore interno", details: error.message };
  }
};

const joinAlliance = async (playerId, matchId, allianceId) => {
  try {
    if (!matchId || !allianceId)
      return { status: "400", message: "Match id o Alliance id mancante." };

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const fail = (status, message) => {
        const error = new Error(message);
        error.customStatus = status;
        throw error;
      };

      const matchRes = await client.query(
        `SELECT p.id_partita, p.id_partita_visualizzato
         FROM partite p
         WHERE p.id_partita_visualizzato = $1
         LIMIT 1`,
        [matchId],
      );
      if (matchRes.rows.length === 0) {
        fail("404", "Partita non trovata.");
      }

      const allianceRes = await client.query(
        `SELECT a.id_alleanza, a.nome_alleanza, a.id_partita, COALESCE(a.max_membri, 4) AS max_membri
         FROM alleanze a
         WHERE a.id_alleanza = $1 AND a.id_partita = $2
         LIMIT 1`,
        [allianceId, matchRes.rows[0].id_partita],
      );
      if (allianceRes.rows.length === 0) {
        fail("404", "Alleanza non trovata per questa partita.");
      }

      const alliancePk = allianceRes.rows[0].id_alleanza;

        const hasCooldownColumn = await hasAbbandonoAlleanzaAtColumn(client);
      const membershipRes = await client.query(
          `${hasCooldownColumn ? "SELECT id_alleanza, abbandono_alleanza_at" : "SELECT id_alleanza"}
         FROM partecipanti_partite
         WHERE user_id = $1 AND partita_id = $2
         FOR UPDATE`,
        [playerId, matchRes.rows[0].id_partita],
      );
      if (membershipRes.rows.length === 0) {
        fail("404", "Partecipante non trovato nella partita.");
      }

      const currentAllianceId = membershipRes.rows[0].id_alleanza;
      if (
        currentAllianceId &&
        String(currentAllianceId) === String(alliancePk)
      ) {
        fail("400", "Sei già in questa alleanza.");
      }
      if (
        currentAllianceId &&
        String(currentAllianceId) !== String(alliancePk)
      ) {
        fail(
          "400",
          "Devi lasciare l'alleanza attuale prima di unirti a un'altra.",
        );
      }

      // Use DB-stored last leave time to enforce 24h cooldown across any alliance
      const cooldownCheck = await checkLastLeaveCooldown(playerId, matchId);
      if (cooldownCheck.status !== "200") {
        return cooldownCheck; // Restituisce il messaggio di errore se il cooldown non è rispettato
      }

      const countRes = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM partecipanti_partite
         WHERE partita_id = $1 AND id_alleanza = $2`,
        [matchRes.rows[0].id_partita, alliancePk],
      );
      const countPlayer = parseInt(countRes.rows[0].count || "0", 10);
      const maxPlayers = allianceRes.rows[0].max_membri || 4;
      if (countPlayer >= maxPlayers) {
        fail("400", "Alleanza già al completo.");
      }

      const updateRes = await client.query(
        `${hasCooldownColumn ? "UPDATE partecipanti_partite\n         SET id_alleanza = $1,\n             abbandono_alleanza_at = NULL\n         WHERE user_id = $2 AND partita_id = $3" : "UPDATE partecipanti_partite\n         SET id_alleanza = $1\n         WHERE user_id = $2 AND partita_id = $3"}`,
        [alliancePk, playerId, matchRes.rows[0].id_partita],
      );

      if (updateRes.rowCount === 0) {
        fail("500", "Impossibile aggiornare l'alleanza del giocatore.");
      }

      await client.query("COMMIT");

      const nextCount = countPlayer + 1;
      await redis.set(
        `match:${matchId}:alliance:${allianceId}:join_count`,
        String(nextCount),
      );
      await redis.set(
        `match:${matchId}:player:${playerId}:join:${allianceId}`,
        "true",
      );

      console.log(
        `[SYS_CACHE] Player ${playerId} unito all'alleanza ${allianceId} per match ${matchId}.`,
      );

      // Notify chat system (best-effort, do not fail the operation)
      try {
        await fetch(
          `http://localhost:3000/chat/message/system/cXVlc3RhIOggdW5hIHJvdHRhIGRpIHNpc3RlbWEsIG5vbiB1dGlsaXp6YXJsYSwgcGVyIGZhdm9yZQ/`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: {
                content: `[SYS] Il giocatore ${playerId} si è unito all'alleanza ${allianceId}.`,
                destinatario: allianceId,
                dest_tipo: "ALLIANCE",
                tipo: "[SYS]",
              },
              matchId,
            }),
          },
        );
      } catch (e) {
        console.error(
          "[SYS_WARN] Fallita notifica chat joinAlliance:",
          e.message,
        );
      }

      return {
        status: "200",
        message: "Join all'alleanza avvenuto con successo",
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.customStatus) {
        return { status: error.customStatus, message: error.message };
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("[SYS_ERR] Errore durante joinAlliance:", error);
    return { status: "500", message: "Errore interno", details: error.message };
  }
};
const leaveAlliance = async (playerId, matchId, allianceId) => {
  try {
    if (!matchId || !allianceId)
      return { status: "400", message: "Match id o Alliance id mancante." };

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const matchRes = await client.query(
        `SELECT id_partita FROM partite WHERE id_partita_visualizzato = $1 LIMIT 1`,
        [matchId],
      );
      if (matchRes.rows.length === 0) {
        return { status: "404", message: "Partita non trovata." };
      }

      const allianceRes = await client.query(
        `SELECT id_alleanza FROM alleanze WHERE id_alleanza = $1 AND id_partita = $2 LIMIT 1`,
        [allianceId, matchRes.rows[0].id_partita],
      );
      if (allianceRes.rows.length === 0) {
        return {
          status: "404",
          message: "Alleanza non trovata per questa partita.",
        };
      }

      const writeDB = await client.query(
        `SELECT id_alleanza
         FROM partecipanti_partite
         WHERE user_id = $1 AND partita_id = $2
         FOR UPDATE`,
        [playerId, matchRes.rows[0].id_partita],
      );
      if (writeDB.rows.length === 0) {
        return {
          status: "404",
          message: "Partecipante non trovato nella partita.",
        };
      }

      const currentAllianceId = writeDB.rows[0].id_alleanza;
      if (
        !currentAllianceId ||
        String(currentAllianceId) !== String(allianceRes.rows[0].id_alleanza)
      ) {
        return {
          status: "400",
          message: "Non sei un membro di questa alleanza.",
        };
      }

      const hasCooldownColumn = await hasAbbandonoAlleanzaAtColumn(client);
      await client.query(
        `${hasCooldownColumn ? "UPDATE partecipanti_partite\n         SET abbandono_alleanza_at = CURRENT_TIMESTAMP,\n             id_alleanza = NULL\n         WHERE user_id = $1 AND partita_id = $2" : "UPDATE partecipanti_partite\n         SET id_alleanza = NULL\n         WHERE user_id = $1 AND partita_id = $2"}`,
        [playerId, matchRes.rows[0].id_partita],
      );

      const countRes = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM partecipanti_partite
         WHERE partita_id = $1 AND id_alleanza = $2`,
        [matchRes.rows[0].id_partita, allianceRes.rows[0].id_alleanza],
      );

      await client.query("COMMIT");

      const countPlayer = parseInt(countRes.rows[0].count || "0", 10);
      await redis.set(
        `match:${matchId}:alliance:${allianceId}:join_count`,
        String(countPlayer),
      );
      await redis.del(`match:${matchId}:player:${playerId}:join:${allianceId}`);
      await redis.set(
        `match:${matchId}:player:${playerId}:last_leave:${allianceId}`,
        Date.now().toString(),
      );
      console.log(
        `[SYS_CACHE] Player ${playerId} ha lasciato l'alleanza ${allianceId} per match ${matchId}.`,
      );

      try {
        await fetch(
          `http://localhost:3000/chat/message/system/cXVlc3RhIOggdW5hIHJvdHRhIGRpIHNpc3RlbWEsIG5vbiB1dGlsaXp6YXJsYSwgcGVyIGZhdm9yZQ/`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: {
                content: `[SYS] Il giocatore ${playerId} ha lasciato l'alleanza ${allianceId}.`,
                destinatario: allianceId,
                dest_tipo: "ALLIANCE",
                tipo: "[SYS]",
              },
              matchId,
            }),
          },
        );
      } catch (e) {
        console.error(
          "[SYS_WARN] Fallita notifica chat leaveAlliance:",
          e.message,
        );
      }
      return {
        status: "200",
        message: "Lascio all'alleanza avvenuto con successo",
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.customStatus) {
        return { status: error.customStatus, message: error.message };
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("[SYS_ERR] Errore durante leaveAlliance:", error);
    return { status: "500", message: "Errore interno", details: error.message };
  }
};

const kickAlliance = async (
  playerId,
  matchId,
  allianceId,
  targetPlayerId,
  motivation,
) => {
  try {
    if (!matchId || !allianceId || !targetPlayerId)
      return {
        status: "400",
        message: "Match id, player target o Alliance id mancante.",
      };

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const matchRes = await client.query(
        `SELECT id_partita FROM partite WHERE id_partita_visualizzato = $1 LIMIT 1`,
        [matchId],
      );
      if (matchRes.rows.length === 0) {
        return { status: "404", message: "Partita non trovata." };
      }

      const allianceRes = await client.query(
          `SELECT id_alleanza FROM alleanze WHERE id_alleanza = $1 AND id_partita = $2 LIMIT 1`,
          [allianceId, matchRes.rows[0].id_partita],
      );
      if (allianceRes.rows.length === 0) {
        return {
          status: "404",
          message: "Alleanza non trovata per questa partita.",
        };
      }

      const membershipRes = await client.query(
        `SELECT id_alleanza
         FROM partecipanti_partite
         WHERE user_id = $1 AND partita_id = $2
         FOR UPDATE`,
        [targetPlayerId, matchRes.rows[0].id_partita],
      );
      if (membershipRes.rows.length === 0) {
        return {
          status: "404",
          message: "Partecipante target non trovato nella partita.",
        };
      }

      if (
        !membershipRes.rows[0].id_alleanza ||
        String(membershipRes.rows[0].id_alleanza) !==
          String(allianceRes.rows[0].id_alleanza)
      ) {
        return {
          status: "400",
          message: "Il giocatore target non è un membro di questa alleanza.",
        };
      }

      const hasCooldownColumn = await hasAbbandonoAlleanzaAtColumn(client);
      await client.query(
        `${hasCooldownColumn ? "UPDATE partecipanti_partite\n         SET abbandono_alleanza_at = CURRENT_TIMESTAMP,\n             id_alleanza = NULL\n         WHERE user_id = $1 AND partita_id = $2" : "UPDATE partecipanti_partite\n         SET id_alleanza = NULL\n         WHERE user_id = $1 AND partita_id = $2"}`,
        [targetPlayerId, matchRes.rows[0].id_partita],
      );

      const countRes = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM partecipanti_partite
         WHERE partita_id = $1 AND id_alleanza = $2`,
        [matchRes.rows[0].id_partita, allianceRes.rows[0].id_alleanza],
      );

      await client.query("COMMIT");

      const countPlayer = parseInt(countRes.rows[0].count || "0", 10);
      await redis.set(
        `match:${matchId}:alliance:${allianceId}:join_count`,
        String(countPlayer),
      );
      await redis.del(
        `match:${matchId}:player:${targetPlayerId}:join:${allianceId}`,
      );
      await redis.set(
        `match:${matchId}:player:${targetPlayerId}:last_leave:${allianceId}`,
        Date.now().toString(),
      );

      try {
        await fetch(
          `http://localhost:3000/chat/message/system/cXVlc3RhIOggdW5hIHJvdHRhIGRpIHNpc3RlbWEsIG5vbiB1dGlsaXp6YXJsYSwgcGVyIGZhdm9yZQ/`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: {
                content: motivation
                  ? `[SYS] Sei stato espulso dall'alleanza ${allianceId}. Motivazione: ${motivation}`
                  : `Sei stato espulso dall'alleanza ${allianceId}.`,
                destinatario: targetPlayerId,
                dest_tipo: "PLAYER",
                tipo: "[SYS]",
              },
              matchId,
            }),
          },
        );
      } catch (e) {
        console.error(
          "[SYS_WARN] Fallita notifica chat kickAlliance:",
          e.message,
        );
      }

      return {
        status: "200",
        message: "Espulsione dall'alleanza avvenuta con successo",
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.customStatus) {
        return { status: error.customStatus, message: error.message };
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("[SYS_ERR] Errore durante kickAlliance:", error);
    return { status: "500", message: "Errore interno", details: error.message };
  }
};

module.exports = {
  createMatch,
  join_Match,
  listJoinableMatches,
  getMatchPlayers,
  getMatchAlliance,
  createAlliance,
  checkLastLeaveCooldown,
  joinAlliance,
  leaveAlliance,
  kickAlliance,
};
