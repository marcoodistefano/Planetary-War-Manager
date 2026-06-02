const aslan = require("./middleware/Aslan.js");
const db = require("../shared/postgresClient.js");
const redis = require("../shared/redisClient.js"); // Client Redis collegato
const Eru = require("./middleware/Eru.js");

let hasAbbandonoAlleanzaAtColumnCache = null;
let hasJoinedAtColumnCache = null;

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

const hasJoinedAtColumn = async (client = db) => {
  try {
    const { rows } = await client.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_name = 'partecipanti_partite'
         AND column_name = 'joined_at'
       LIMIT 1;`,
    );
    return rows.length > 0;
  } catch (error) {
    return false;
  }
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
// Invalidate alliance-related cache entries for a match
const invalidateMatchAllianceCache = async (matchId, allianceId = null) => {
  try {
    if (!matchId) return;
    // remove main alliances list cache
    const toDelete = [`match:${matchId}:alliances`];

    if (allianceId) {
      // explicit known keys for the alliance
      toDelete.push(
        `match:${matchId}:alliance:${allianceId}`,
        `match:${matchId}:alliance:${allianceId}:members`,
        `match:${matchId}:alliance:${allianceId}:join_count`,
        `chat:match:${matchId}:alliance:${allianceId}`,
        `chat:match:${matchId}:alliance:${allianceId}:bytes`,
      );
    }

    // also include running participants set so membership checks refresh
    toDelete.push(`running_match:${matchId}:participants`);

    // attempt to delete all explicitly gathered keys
    try {
      const existing = [];
      for (const k of toDelete) {
        if (!k) continue;
        const exists = await redis.exists(k);
        if (exists) existing.push(k);
      }
      if (existing.length > 0) {
        await redis.del(...existing);
        console.log(
          `[SYS_CACHE] invalidateMatchAllianceCache removed keys for match ${matchId}:`,
          existing,
        );
      }
    } catch (e) {
      console.warn("[SYS_WARN] invalidateMatchAllianceCache explicit delete failed:", e.message);
    }

    // remove per-alliance pattern keys as a fallback
    try {
      const keys = await redis.keys(`match:${matchId}:alliance:*`);
      if (keys && keys.length > 0) {
        await redis.del(...keys);
        console.log('[SYS_CACHE] invalidateMatchAllianceCache pattern removed:', keys);
      }
    } catch (e) {
      // keys may not be supported or may fail in some redis clients/environments
      console.warn(
        "[SYS_WARN] invalidateMatchAllianceCache pattern delete failed:",
        e.message,
      );
    }
  } catch (e) {
    console.warn("[SYS_WARN] invalidateMatchAllianceCache failed:", e.message);
  }
};

const safeParseRedisJson = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
};

const resolveMatchState = async (matchId, client = db) => {
  if (!matchId) return null;

  const cachedState = safeParseRedisJson(await redis.get(`match:${matchId}`));
  if (cachedState && cachedState.id_partita) {
    return { source: "redis", state: cachedState };
  }

  const { rows } = await client.query(
    `SELECT
       id_partita,
       id_partita_hash,
       id_partita_visualizzato,
       struttura_partita::text AS struttura_partita
     FROM partite
     WHERE id_partita_visualizzato = $1
        OR id_partita_hash = $1
        OR id_partita::text = $1
     LIMIT 1;`,
    [matchId],
  );

  if (rows.length === 0) {
    return null;
  }

  const state = rows[0];
  await setMatchCacheAllIds({
    id_partita: state.id_partita,
    id_partita_hash: state.id_partita_hash,
    id_partita_visualizzato: state.id_partita_visualizzato,
    stateObj: state,
  });

  return { source: "db", state };
};

const resolveAllianceState = async ({
  matchId,
  allianceId,
  client = db,
  matchState = null,
}) => {
  if (!matchId || !allianceId) return null;

  const cachedAlliance = safeParseRedisJson(
    await redis.get(`match:${matchId}:alliance:${allianceId}`),
  );
  if (cachedAlliance && cachedAlliance.id_alleanza) {
    return { source: "redis", alliance: cachedAlliance };
  }

  const resolvedMatch = matchState || (await resolveMatchState(matchId, client));
  if (!resolvedMatch) {
    return null;
  }

  const { rows } = await client.query(
    `SELECT
       a.id_alleanza,
       a.nome_alleanza,
       a.nome_logo,
       a.id_leader,
       a.id_partita,
       COALESCE(a.max_membri, 4) AS max_membri
     FROM alleanze a
     WHERE a.id_alleanza = $1
       AND a.id_partita = $2
     LIMIT 1;`,
    [allianceId, resolvedMatch.state.id_partita],
  );

  if (rows.length === 0) {
    return null;
  }

  const alliance = rows[0];
  await redis.set(
    `match:${matchId}:alliance:${alliance.id_alleanza}`,
    JSON.stringify(alliance),
  );
  if (alliance.nome_alleanza) {
    await redis.set(
      `match:${matchId}:id_alliance:${alliance.nome_alleanza}`,
      String(alliance.id_alleanza),
    );
  }

  return { source: "db", alliance };
};

const getAllianceJoinCount = async ({ matchId, allianceId, client = db }) => {
  if (!matchId || !allianceId) return null;

  const cachedCount = await redis.get(
    `match:${matchId}:alliance:${allianceId}:join_count`,
  );
  if (cachedCount !== null) {
    return { source: "redis", count: Number.parseInt(cachedCount, 10) || 0 };
  }

  const resolvedMatch = await resolveMatchState(matchId, client);
  if (!resolvedMatch) {
    return null;
  }

  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM partecipanti_partite
     WHERE partita_id = $1 AND id_alleanza = $2;`,
    [resolvedMatch.state.id_partita, allianceId],
  );

  const count = Number.parseInt(rows[0]?.count || "0", 10) || 0;
  await redis.set(
    `match:${matchId}:alliance:${allianceId}:join_count`,
    String(count),
  );
  return { source: "db", count };
};

const getLastLeaveTimestamp = async ({ playerId, matchId, client = db }) => {
  if (!playerId || !matchId) return null;

  const genericKey = `match:${matchId}:player:${playerId}:last_leave_at`;
  const cachedGeneric = await redis.get(genericKey);
  if (cachedGeneric !== null) {
    return { source: "redis", lastLeaveAt: cachedGeneric };
  }

  const specificKeys = await redis.keys(
    `match:${matchId}:player:${playerId}:last_leave:*`,
  );
  if (specificKeys && specificKeys.length > 0) {
    const values = await Promise.all(specificKeys.map((key) => redis.get(key)));
    const validTimestamps = values
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value));

    if (validTimestamps.length > 0) {
      const latest = Math.max(...validTimestamps);
      await redis.set(genericKey, String(latest));
      return { source: "redis", lastLeaveAt: String(latest) };
    }
  }

  const resolvedMatch = await resolveMatchState(matchId, client);
  if (!resolvedMatch) {
    return null;
  }

  const { rows } = await client.query(
    `SELECT abbandono_alleanza_at
     FROM partecipanti_partite
     WHERE user_id = $1 AND partita_id = $2
     LIMIT 1;`,
    [playerId, resolvedMatch.state.id_partita],
  );

  const lastLeaveAt = rows[0]?.abbandono_alleanza_at || null;
  if (lastLeaveAt) {
    await redis.set(genericKey, String(new Date(lastLeaveAt).getTime()));
  }

  return { source: "db", lastLeaveAt };
};

const cacheAllianceMembershipState = async ({
  matchId,
  playerId,
  allianceId,
  isLeader = false,
  inAlliance = true,
  lastLeaveAt = null,
  joinCount = null,
}) => {
  if (!matchId || !playerId) return;

  const ops = [
    redis.set(
      `match:${matchId}:player:${playerId}:in_alliance`,
      inAlliance ? "true" : "false",
    ),
  ];

  if (allianceId) {
    ops.push(
      inAlliance
        ? redis.set(
            `match:${matchId}:player:${playerId}:join:${allianceId}`,
            "true",
          )
        : redis.del(`match:${matchId}:player:${playerId}:join:${allianceId}`),
    );
  }

  if (isLeader) {
    ops.push(
      redis.set(`match:${matchId}:player:${playerId}:id_alliance:is_leader`, "true"),
    );
  } else {
    ops.push(
      redis.del(`match:${matchId}:player:${playerId}:id_alliance:is_leader`),
    );
  }

  if (lastLeaveAt !== null) {
    const lastLeaveValue = String(lastLeaveAt);
    ops.push(
      redis.set(
        `match:${matchId}:player:${playerId}:last_leave_at`,
        lastLeaveValue,
      ),
    );
    if (allianceId) {
      ops.push(
        redis.set(
          `match:${matchId}:player:${playerId}:last_leave:${allianceId}`,
          lastLeaveValue,
        ),
      );
    }
  }

  if (allianceId && joinCount !== null) {
    ops.push(
      redis.set(
        `match:${matchId}:alliance:${allianceId}:join_count`,
        String(joinCount),
      ),
    );
  }

  await Promise.all(ops);
};

const clearAllianceMembershipState = async ({
  matchId,
  playerId,
  allianceId,
}) => {
  if (!matchId || !playerId) return;

  const ops = [
    redis.set(`match:${matchId}:player:${playerId}:in_alliance`, "false"),
    redis.del(`match:${matchId}:player:${playerId}:id_alliance:is_leader`),
  ];

  if (allianceId) {
    ops.push(redis.del(`match:${matchId}:player:${playerId}:join:${allianceId}`));
  }

  await Promise.all(ops);
};

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
        `SELECT id_partita, id_partita_visualizzato, struttura_partita::text AS struct FROM partite WHERE id_partita_hash = $1 FOR UPDATE;`,
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
          id_partita_visualizzato: matchQuery.rows[0].id_partita_visualizzato,
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
const listJoinableMatches = async (playerId = null) => {
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
        AND ($1::uuid IS NULL OR NOT EXISTS (
          SELECT 1 FROM partecipanti_partite pp 
          WHERE pp.partita_id = m.id_partita AND pp.user_id = $1
        ))
      GROUP BY m.id_partita
      ORDER BY m.created_at DESC;
    `;

    const { rows } = await db.query(query, [playerId]);
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
    const cached = safeParseRedisJson(await redis.get(`match:${matchId}:alliances`));
    if (Array.isArray(cached)) {
      console.log(
        `[SYS_CACHE] Alliances per match ${matchId} recuperati da Redis.`,
      );
      return { status: "200", alliances: cached };
    }

    const resolvedMatch = await resolveMatchState(matchId);
    if (!resolvedMatch) {
      return { status: "404", message: "Partita non trovata." };
    }

    const joinedExists = await hasJoinedAtColumn();
    const membersAgg = joinedExists
      ? "COALESCE(array_agg(u.username ORDER BY pa.joined_at ASC, pa.user_id ASC) FILTER (WHERE u.username IS NOT NULL), ARRAY[]::text[]) AS members"
      : "COALESCE(array_agg(u.username ORDER BY pa.user_id ASC) FILTER (WHERE u.username IS NOT NULL), ARRAY[]::text[]) AS members";

    const query = `
      SELECT 
        a.id_alleanza,
        a.id_leader,
        leader_u.username AS leader_name,
        a.nome_alleanza,
        a.nome_logo, 
        a.id_partita,
        COALESCE(a.max_membri, 4) AS max_membri,
        COUNT(pa.user_id) AS numero_partecipanti,
        ${membersAgg}
      FROM alleanze a
      LEFT JOIN partecipanti_partite pa ON a.id_alleanza = pa.id_alleanza AND pa.partita_id = a.id_partita
      LEFT JOIN utenti u ON pa.user_id = u.id_user
      LEFT JOIN utenti leader_u ON a.id_leader = leader_u.id_user
      WHERE a.id_partita = $1
      GROUP BY 
        a.id_alleanza, 
        a.id_leader,
        leader_u.username,
        a.nome_alleanza, 
        a.nome_logo,
        a.id_partita,
        a.max_membri
      ORDER BY a.created_at ASC;
    `;

    const { rows } = await db.query(query, [resolvedMatch.state.id_partita]);
    const alliances = rows.map((row) => {
      const playerCount = Number(row.numero_partecipanti || 0);
      const maxPlayersCount = Number(row.max_membri || 0);

      return {
        id_alleanza: row.id_alleanza,
        id_leader: row.id_leader,
        leader_name: row.leader_name,
        nome_alleanza: row.nome_alleanza,
        nome_logo: row.nome_logo,
        numero_partecipanti: playerCount,
        members: row.members || [],
        max_players: maxPlayersCount,
        max_players_count: maxPlayersCount,
        can_join: maxPlayersCount === 0 ? true : playerCount < maxPlayersCount,
      };
    });

    if (alliances.length > 0) {
      await redis.set(`match:${matchId}:alliances`, JSON.stringify(alliances));
      await Promise.all(
        rows.map((row) =>
          Promise.all([
            redis.set(
              `match:${matchId}:alliance:${row.id_alleanza}`,
              JSON.stringify({
                id_alleanza: row.id_alleanza,
                nome_alleanza: row.nome_alleanza,
                nome_logo: row.nome_logo,
                id_leader: row.id_leader,
                leader_name: row.leader_name,
                id_partita: row.id_partita,
                max_membri: row.max_membri,
              }),
            ),
            row.nome_alleanza
              ? redis.set(
                  `match:${matchId}:id_alliance:${row.nome_alleanza}`,
                  String(row.id_alleanza),
                )
              : Promise.resolve(),
            redis.set(
              `match:${matchId}:alliance:${row.id_alleanza}:join_count`,
              String(Number(row.numero_partecipanti || 0)),
            ),
          ]),
        ),
      );
      return { status: "200", alliances };
    }

    await redis.set(`match:${matchId}:alliances`, JSON.stringify([]));
    return {
      status: "404",
      message: "Nessuna alleanza trovata per questa partita.",
    };
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
      .replace(/\s+/g, " ")
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
    const cachedAllianceFlag = await redis.get(
      `match:${matchId}:player:${playerId}:in_alliance`,
    );
    if (cachedAllianceFlag === "true") {
      return {
        status: "400",
        message: "Sei già in un'alleanza in questa partita.",
      };
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const fail = (status, message) => {
        const error = new Error(message);
        error.customStatus = status;
        throw error;
      };

      const matchRes = await client.query(
        `SELECT id_partita, id_partita_visualizzato
         FROM partite
         WHERE id_partita_visualizzato = $1
         FOR UPDATE`,
        [matchId],
      );
      if (matchRes.rows.length === 0) {
        fail("404", "Partita non trovata.");
      }

      const partitaId = matchRes.rows[0].id_partita;
      const hasCooldownColumn = await hasAbbandonoAlleanzaAtColumn(client);
      const playerMembership = await client.query(
        `${hasCooldownColumn ? "SELECT id_alleanza, abbandono_alleanza_at" : "SELECT id_alleanza"}
         FROM partecipanti_partite
         WHERE user_id = $1 AND partita_id = $2
         FOR UPDATE`,
        [playerId, partitaId],
      );
      if (playerMembership.rows.length === 0) {
        fail("404", "Partecipante non trovato nella partita.");
      }

      if (playerMembership.rows[0].id_alleanza) {
        fail("400", "Sei già in un'alleanza in questa partita.");
      }

      const cooldownCheck = await checkLastLeaveCooldown(playerId, matchId);
      if (cooldownCheck.status !== "200") {
        fail(
          cooldownCheck.status || "400",
          cooldownCheck.message || "Impossibile creare l'alleanza.",
        );
      }

      const nameCheck = await redis.get(
        `match:${matchId}:id_alliance:${normalizedAllianceName}`,
      );
      if (nameCheck) {
        fail("400", "Il nome dell'alleanza è già in uso in questa partita.");
      }

      const dbNameCheck = await client.query(
        `SELECT 1
         FROM alleanze
         WHERE nome_alleanza = $1 AND id_partita = $2
         LIMIT 1`,
        [normalizedAllianceName, partitaId],
      );
      if (dbNameCheck.rows.length > 0) {
        fail("400", "Il nome dell'alleanza è già in uso in questa partita.");
      }

      const insertRes = await client.query(
        `INSERT INTO alleanze (id_partita, nome_alleanza, id_leader) 
         VALUES ($1, $2, $3) 
         RETURNING id_alleanza, nome_alleanza;`,
        [partitaId, normalizedAllianceName, playerId],
      );
      if (insertRes.rows.length === 0) {
        fail("500", "Impossibile creare l'alleanza.");
      }

      const allianceId = insertRes.rows[0].id_alleanza;
      await client.query(
        `UPDATE partecipanti_partite
         SET id_alleanza = $1
         WHERE user_id = $2 AND partita_id = $3`,
        [allianceId, playerId, partitaId],
      );

      await client.query("COMMIT");

      const resolveState = await resolveMatchState(matchId);
      const resolvedPartitaId = resolveState?.state?.id_partita || partitaId;

      try {
        await invalidateMatchAllianceCache(matchId);
      } catch (e) {
        console.warn(
          "[SYS_WARN] Failed to invalidate alliance cache after createAlliance:",
          e.message,
        );
      }

      await cacheAllianceMembershipState({
        matchId,
        playerId,
        allianceId,
        isLeader: true,
        inAlliance: true,
        joinCount: 1,
      });
      await redis.set(
        `match:${matchId}:alliance:${allianceId}`,
        JSON.stringify({
          id_alleanza: allianceId,
          nome_alleanza: normalizedAllianceName,
          id_leader: playerId,
          id_partita: resolvedPartitaId,
          max_membri: 4,
        }),
      );
      await redis.set(
        `match:${matchId}:id_alliance:${normalizedAllianceName}`,
        String(allianceId),
      );
      await redis.del(`match:${matchId}:player:${playerId}:last_leave_at`);
      const lastLeaveKeys = await redis.keys(
        `match:${matchId}:player:${playerId}:last_leave:*`,
      );
      if (lastLeaveKeys && lastLeaveKeys.length > 0) {
        await redis.del(...lastLeaveKeys);
      }

      console.log(
        `[SYS_CACHE] Player ${playerId} marked as in_alliance and leader for match ${matchId} in Redis.`,
      );

    return {
      status: "200",
      message: "Alleanza creata e joinata con successo",
      alliance: insertRes.rows[0],
    };
    } catch (dbError) {
      await client.query("ROLLBACK");
      if (dbError.customStatus) {
        return { status: dbError.customStatus, message: dbError.message };
      }
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("[SYS_ERR] Errore durante createAlliance:", error);
    return { status: "500", message: "Errore interno", details: error.message };
  }
};

const checkLastLeaveCooldown = async (playerId, matchId) => {
  try {
    const hasCooldownColumn = await hasAbbandonoAlleanzaAtColumn();
    if (!hasCooldownColumn) {
      return {
        status: "200",
        message: "Cooldown non disponibile nello schema corrente.",
      };
    }

    const lastLeave = await getLastLeaveTimestamp({ playerId, matchId });
    if (!lastLeave || !lastLeave.lastLeaveAt) {
      return { status: "200", message: "Cooldown rispettato." };
    }

    const lastLeaveValue = Number.parseInt(lastLeave.lastLeaveAt, 10);
    const lastLeaveTs = Number.isFinite(lastLeaveValue)
      ? lastLeaveValue
      : new Date(lastLeave.lastLeaveAt).getTime();

    if (!Number.isFinite(lastLeaveTs)) {
      return {
        status: "200",
        message: "Cooldown rispettato.",
      };
    }

    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    if (now - lastLeaveTs < DAY_MS) {
      return {
        status: "400",
        message:
          "Non puoi unirti a un'alleanza entro 24 ore dall'ultimo abbandono.",
      };
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

    const cachedJoin = await redis.get(
      `match:${matchId}:player:${playerId}:join:${allianceId}`,
    );
    if (cachedJoin === "true") {
      return { status: "400", message: "Sei già in questa alleanza." };
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const fail = (status, message) => {
        const error = new Error(message);
        error.customStatus = status;
        throw error;
      };

      const matchState = await resolveMatchState(matchId, client);
      if (!matchState) {
        fail("404", "Partita non trovata.");
      }

      const allianceState = await resolveAllianceState({
        matchId,
        allianceId,
        client,
        matchState,
      });
      if (!allianceState) {
        fail("404", "Alleanza non trovata per questa partita.");
      }

      const alliance = allianceState.alliance;
      const alliancePk = alliance.id_alleanza;

      const hasCooldownColumn = await hasAbbandonoAlleanzaAtColumn(client);
      const membershipRes = await client.query(
        `${hasCooldownColumn ? "SELECT id_alleanza, abbandono_alleanza_at" : "SELECT id_alleanza"}
         FROM partecipanti_partite
         WHERE user_id = $1 AND partita_id = $2
         FOR UPDATE`,
        [playerId, matchState.state.id_partita],
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
        fail(
          cooldownCheck.status || "400",
          cooldownCheck.message || "Impossibile unirsi all'alleanza.",
        );
      }

      const countRes = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM partecipanti_partite
         WHERE partita_id = $1 AND id_alleanza = $2`,
        [matchState.state.id_partita, alliancePk],
      );
      const countPlayer = parseInt(countRes.rows[0].count || "0", 10);
      const maxPlayers = alliance.max_membri || 4;
      if (countPlayer >= maxPlayers) {
        fail("400", "Alleanza già al completo.");
      }

      const updateRes = await client.query(
        `${hasCooldownColumn ? "UPDATE partecipanti_partite\n         SET id_alleanza = $1,\n             abbandono_alleanza_at = NULL\n         WHERE user_id = $2 AND partita_id = $3" : "UPDATE partecipanti_partite\n         SET id_alleanza = $1\n         WHERE user_id = $2 AND partita_id = $3"}`,
        [alliancePk, playerId, matchState.state.id_partita],
      );

      if (updateRes.rowCount === 0) {
        fail("500", "Impossibile aggiornare l'alleanza del giocatore.");
      }

      await client.query("COMMIT");
      const nextCount = countPlayer + 1;
      try {
        // Ensure cached alliances listing is invalidated so frontend sees update
        await invalidateMatchAllianceCache(matchId, alliancePk);
      } catch (e) {
        console.warn(
          "[SYS_WARN] Failed to invalidate alliance cache after joinAlliance:",
          e.message,
        );
      }
      const lastLeaveKeys = await redis.keys(
        `match:${matchId}:player:${playerId}:last_leave:*`,
      );
      if (lastLeaveKeys && lastLeaveKeys.length > 0) {
        await redis.del(...lastLeaveKeys);
      }
      await redis.del(`match:${matchId}:player:${playerId}:last_leave_at`);
      await cacheAllianceMembershipState({
        matchId,
        playerId,
        allianceId,
        isLeader: false,
        inAlliance: true,
        joinCount: nextCount,
      });
      await redis.set(
        `match:${matchId}:alliance:${allianceId}`,
        JSON.stringify(alliance),
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
const removeAllianceMember = async ({
  targetPlayerId,
  matchId,
  allianceId,
  actorPlayerId = targetPlayerId,
  requireLeader = false,
}) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const fail = (status, message) => {
      const error = new Error(message);
      error.customStatus = status;
      throw error;
    };

    const matchState = await resolveMatchState(matchId, client);
    if (!matchState) {
      fail("404", "Partita non trovata.");
    }

    const allianceState = await resolveAllianceState({
      matchId,
      allianceId,
      client,
      matchState,
    });
    if (!allianceState) {
      fail("404", "Alleanza non trovata per questa partita.");
    }

    if (
      requireLeader &&
      String(allianceState.alliance.id_leader) !== String(actorPlayerId)
    ) {
      fail("403", "Solo il leader dell'alleanza può espellere membri.");
    }

    const joinedExists = await hasJoinedAtColumn(client);
    const membershipRes = await client.query(
      `${joinedExists ? "SELECT id_alleanza, joined_at" : "SELECT id_alleanza"}
       FROM partecipanti_partite
       WHERE user_id = $1 AND partita_id = $2
       FOR UPDATE`,
      [targetPlayerId, matchState.state.id_partita],
    );
    if (membershipRes.rows.length === 0) {
      fail("404", "Partecipante target non trovato nella partita.");
    }

    if (
      !membershipRes.rows[0].id_alleanza ||
      String(membershipRes.rows[0].id_alleanza) !== String(allianceState.alliance.id_alleanza)
    ) {
      fail("400", "Il giocatore target non è un membro di questa alleanza.");
    }

    const hasCooldownColumn = await hasAbbandonoAlleanzaAtColumn(client);
    await client.query(
      `${hasCooldownColumn ? "UPDATE partecipanti_partite\n       SET abbandono_alleanza_at = CURRENT_TIMESTAMP,\n           id_alleanza = NULL\n       WHERE user_id = $1 AND partita_id = $2" : "UPDATE partecipanti_partite\n       SET id_alleanza = NULL\n       WHERE user_id = $1 AND partita_id = $2"}`,
      [targetPlayerId, matchState.state.id_partita],
    );

    const remainingRes = await client.query(
      `${
        joinedExists
          ? `SELECT pp.user_id, pp.joined_at
       FROM partecipanti_partite pp
       WHERE pp.partita_id = $1 AND pp.id_alleanza = $2 AND pp.user_id <> $3
       ORDER BY pp.joined_at ASC, pp.user_id ASC`
          : `SELECT pp.user_id
       FROM partecipanti_partite pp
       WHERE pp.partita_id = $1 AND pp.id_alleanza = $2 AND pp.user_id <> $3
       ORDER BY pp.user_id ASC`
      }`,
      [matchState.state.id_partita, allianceState.alliance.id_alleanza, targetPlayerId],
    );

    const countRes = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM partecipanti_partite
       WHERE partita_id = $1 AND id_alleanza = $2`,
      [matchState.state.id_partita, allianceState.alliance.id_alleanza],
    );

    const countPlayer = parseInt(countRes.rows[0].count || "0", 10);
    const targetWasLeader =
      String(allianceState.alliance.id_leader) === String(targetPlayerId);
    let promotedLeaderId = null;

    if (countPlayer > 0 && targetWasLeader) {
      const targetJoinedAt = joinedExists ? membershipRes.rows[0].joined_at : null;
      const targetJoinedTs = targetJoinedAt
        ? new Date(targetJoinedAt).getTime()
        : null;
      const successor =
        remainingRes.rows.find((row) => {
          if (!joinedExists) return true;
          if (targetJoinedTs === null) return true;
          const candidateTs = row.joined_at
            ? new Date(row.joined_at).getTime()
            : null;
          return candidateTs !== null && candidateTs > targetJoinedTs;
        }) ||
        remainingRes.rows[0] ||
        null;

      if (successor) {
        promotedLeaderId = successor.user_id;
        await client.query(
          `UPDATE alleanze SET id_leader = $1 WHERE id_alleanza = $2`,
          [promotedLeaderId, allianceState.alliance.id_alleanza],
        );
      }
    }

    if (countPlayer === 0) {
      await client.query(`DELETE FROM alleanze WHERE id_alleanza = $1`, [
        allianceState.alliance.id_alleanza,
      ]);
    }

    await client.query("COMMIT");

    const leaveTimestamp = Date.now();
    await invalidateMatchAllianceCache(matchId, allianceState.alliance.id_alleanza);
    await cacheAllianceMembershipState({
      matchId,
      playerId: targetPlayerId,
      allianceId,
      isLeader: false,
      inAlliance: false,
      lastLeaveAt: leaveTimestamp,
      joinCount: countPlayer,
    });

    const lastLeaveKeys = await redis.keys(
      `match:${matchId}:player:${targetPlayerId}:last_leave:*`,
    );
    if (lastLeaveKeys && lastLeaveKeys.length > 0) {
      await redis.del(...lastLeaveKeys);
    }
    await redis.set(
      `match:${matchId}:player:${targetPlayerId}:last_leave_at`,
      String(leaveTimestamp),
    );
    await redis.set(
      `match:${matchId}:player:${targetPlayerId}:last_leave:${allianceId}`,
      String(leaveTimestamp),
    );

    if (countPlayer > 0) {
      const allianceSnapshot = {
        ...allianceState.alliance,
        id_leader: promotedLeaderId || allianceState.alliance.id_leader,
      };
      await redis.set(
        `match:${matchId}:alliance:${allianceId}`,
        JSON.stringify(allianceSnapshot),
      );
      await redis.set(
        `match:${matchId}:alliance:${allianceId}:join_count`,
        String(countPlayer),
      );
      if (promotedLeaderId) {
        await cacheAllianceMembershipState({
          matchId,
          playerId: promotedLeaderId,
          allianceId,
          isLeader: true,
          inAlliance: true,
          joinCount: countPlayer,
        });
      }
    } else {
      await redis.del(`match:${matchId}:alliance:${allianceId}`);
      await redis.del(`match:${matchId}:alliance:${allianceId}:join_count`);
      if (allianceState.alliance.nome_alleanza) {
        await redis.del(
          `match:${matchId}:id_alliance:${allianceState.alliance.nome_alleanza}`,
        );
      }
    }

    return {
      status: "200",
      countPlayer,
      leavingWasLeader: targetWasLeader,
      promotedLeaderId,
      allianceName: allianceState.alliance.nome_alleanza,
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
};

const leaveAlliance = async (playerId, matchId, allianceId) => {
  try {
    if (!matchId || !allianceId) {
      return { status: "400", message: "Match id o Alliance id mancante." };
    }

    const result = await removeAllianceMember({
      targetPlayerId: playerId,
      matchId,
      allianceId,
    });
    if (result.status !== "200") {
      return result;
    }

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
      console.error("[SYS_WARN] Fallita notifica chat leaveAlliance:", e.message);
    }

    return {
      status: "200",
      message:
        result.countPlayer === 0
          ? "Alleanza eliminata con successo."
          : result.leavingWasLeader && result.promotedLeaderId
            ? "Hai lasciato l'alleanza. La leadership è stata trasferita con successo."
            : "Hai lasciato l'alleanza con successo.",
    };
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
    if (!matchId || !allianceId || !targetPlayerId) {
      return {
        status: "400",
        message: "Match id, player target o Alliance id mancante.",
      };
    }

    const result = await removeAllianceMember({
      targetPlayerId,
      matchId,
      allianceId,
      actorPlayerId: playerId,
      requireLeader: true,
    });
    if (result.status !== "200") {
      return result;
    }

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
                : `[SYS] Sei stato espulso dall'alleanza ${allianceId}.`,
              destinatario: targetPlayerId,
              dest_tipo: "PLAYER",
              tipo: "[SYS]",
            },
            matchId,
          }),
        },
      );
    } catch (e) {
      console.error("[SYS_WARN] Fallita notifica chat kickAlliance:", e.message);
    }

    return {
      status: "200",
      message: "Espulsione dall'alleanza avvenuta con successo",
    };
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
