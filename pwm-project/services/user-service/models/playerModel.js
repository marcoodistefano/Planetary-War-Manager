const db = require("../../shared/postgresClient.js");
const redisClient = require("../../shared/redisClient.js");
const Eru = require("../middleware/Eru_recostructor.js");

const fetchToRedis = async (U_ID, Information) => {
  const redis_response = await redisClient.setEx(
    `home_info:${U_ID}`,
    3600,
    JSON.stringify(Information),
  );
  console.log("Dati della home page salvati in Redis per U_ID:", U_ID, "Risposta Redis:", redis_response);
  return redis_response;
};

const fetchFromRedis = async (U_ID) => {
  const data = await redisClient.get(`home_info:${U_ID}`);
  console.log("Dati della home page recuperati da Redis per U_ID:", U_ID);
  return data ? JSON.parse(data) : null;
};

const buildMatchMap = (rows) => {
  if (!Array.isArray(rows)) return {};
  return rows.reduce((acc, row, index) => {
    const decodedMatch = Eru.procedure_recreate_field(row.struttura_partita);
    acc[`match${index + 1}`] = {
      ...row,
      struttura_partita: decodedMatch,
    };
    return acc;
  }, {});
};

const buildHome = async (U_ID) => {
  try {
    const cachedData = await fetchFromRedis(U_ID);
    if (cachedData) {
      return {
        status: 200,
        message: "Benvenuto nella home page protetta!",
        data: cachedData,
      };
    }
    
    // 1. LEADERBOARD REGIONALE & UTENTE CORRENTE
    const user_profile_query = await db.query(
      `SELECT username, reg, elo_rating, avatar_id FROM utenti WHERE id_user = $1`,
      [U_ID]
    );
    const currentUser = user_profile_query.rows[0];

    const leaderboard_regionale = await db.query(
      `SELECT username, reg, elo_rating
    FROM utenti
    WHERE reg = (SELECT reg FROM utenti WHERE id_user = $1)
    ORDER BY elo_rating DESC
    LIMIT 10;`,
      [U_ID],
    );

    // 2. LEADERBOARD GLOBALE
    const leaderboard_globale = await db.query(
      `SELECT username, reg, elo_rating
    FROM utenti
    ORDER BY elo_rating DESC
    LIMIT 10;`,
    );

    // 3. POSIZIONE UTENTE
    const user_position = await db.query(
      `SELECT (COUNT(id_user) + 1) AS user_rank
    FROM utenti
    WHERE elo_rating > (
        SELECT elo_rating 
        FROM utenti 
        WHERE id_user = $1
    );`,
      [U_ID],
    );

    // 4. MATCH ATTIVI E CREATI
    const match_attivi = await db.query(
        `SELECT 
          m.nome_partita AS nome_match, 
          m.struttura_partita, 
          m.created_at AS data_creazione, 
          m.id_host,
          (SELECT count(user_id) FROM partecipanti_partite p2 WHERE p2.partita_id = m.id_partita) AS numero_partecipanti
      FROM partecipanti_partite p
      INNER JOIN partite m ON p.partita_id = m.id_partita
      WHERE p.user_id = $1 
        AND substring(m.struttura_partita::text from 1 for 2) IN ('00', '01')
      ORDER BY m.created_at DESC`,
        [U_ID],
      );

    const last_created_match = await db.query(
        `SELECT 
          m.nome_partita AS nome_match, 
          m.struttura_partita, 
          m.created_at AS data_creazione, 
          m.id_host,
          (SELECT count(user_id) FROM partecipanti_partite p2 WHERE p2.partita_id = m.id_partita) AS numero_partecipanti
      FROM partecipanti_partite p
      INNER JOIN partite m ON p.partita_id = m.id_partita
      WHERE p.user_id = $1 
        AND substring(m.struttura_partita::text from 1 for 2) IN ('00', '01')
      ORDER BY m.created_at DESC 
      LIMIT 10;`,
        [U_ID],
      );

    // 5. AMICI
    const friends_information = await db.query(
      `SELECT 
        u.username, 
        u.reg, 
        u.elo_rating, 
        u.avatar_id, 
        u.codice_amico
    FROM amici a
    INNER JOIN utenti u ON a.id_amico = u.id_user
    WHERE a.id_user = $1;`,
      [U_ID],
    );

    const decompress_match_attivi = buildMatchMap(match_attivi.rows);
    const decompress_match_unito = buildMatchMap(last_created_match.rows);
    
    const Information = {
      user_profile: currentUser,
      leaderboard_regionale: leaderboard_regionale.rows,
      leaderboard_globale: leaderboard_globale.rows,
      user_position: user_position.rows[0]?.user_rank,
      match_attivi: decompress_match_attivi,
      last_created_match: decompress_match_unito,
      friends_information: friends_information.rows,
    };

    console.log("Informazioni per la home page:", Information);
    await fetchToRedis(U_ID, Information); 
    
    return { status: 200, message: "Benvenuto nella home page protetta!", data: Information};
    
  } catch (error) {
    console.error("Errore generato dentro buildHome:", error);
    return { status: 500, error: "Errore interno del server" };
  }
};

module.exports = {
  buildHome,
};