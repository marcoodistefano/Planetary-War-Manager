const aslan = require("./middleware/Aslan.js");
const db = require("../shared/postgresClient.js");
const redis = require("../shared/redisClient.js"); // Client Redis collegato
const Eru = require("./middleware/Eru.js");

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
    const id_partita_hash = await aslan.generateSecureToken(255);
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

      // E. ISTANZIAZIONE REDIS (Iniezione in Memoria Volatile)
      // La partita viene caricata in Redis con un TTL (Time-To-Live) di 24 ore
      // per evitare "Memory Leak" di partite mai concluse.
      const redisKey = `match:${id_partita_hash}:status`;
      await redis.set(redisKey, eruRes.binary_match);
      await redis.expire(redisKey, 86400);

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
        await redis.set(redisKey, eru_start.struttura_partita);

        console.log(
          `[SYS_EVENT] Match ${id_partita_hash} AVVIATO. Cache Redis aggiornata.`,
        );
      }

      await client.query("COMMIT");
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
  try {
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

module.exports = {
  createMatch,
  join_Match,
  listJoinableMatches,
};
