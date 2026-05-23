const db = require("../../shared/postgresClient.js");
const redisClient = require("../../shared/redisClient.js");
const Eru = require("../middleware/Eru_recostructor.js");

const fetchToRedis = async (U_ID, Information) => {
  const redis_response = await redisClient.setEx(
    `home_info:${U_ID}`,
    30, // Ridotto a 30s per i test; mettilo a quanto desideri. In questo modo si auto-rigenera
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

const buildActiveMatchesBrowser = async (U_ID) => {
  try {
    const activeMatches = await db.query(
      `SELECT 
        m.id_partita,
        m.id_partita_hash,
        m.id_partita_visualizzato,
        m.nome_partita AS nome_match, 
        m.struttura_partita, 
        m.created_at AS data_creazione, 
        u.username AS creator_username,
        u.username AS creator_display_name,
        u.avatar_id AS creator_avatar,
        (SELECT count(user_id) FROM partecipanti_partite p2 WHERE p2.partita_id = m.id_partita) AS numero_partecipanti
      FROM partite m
      LEFT JOIN utenti u ON m.id_host = u.id_user
      WHERE substring(m.struttura_partita::text from 1 for 2) IN ('00', '01')
        AND m.id_host IS DISTINCT FROM $1
      ORDER BY m.created_at DESC;`,
      [U_ID],
    );

    return { status: 200, data: buildMatchMap(activeMatches.rows) };
  } catch (error) {
    console.error("Errore generato dentro buildActiveMatchesBrowser:", error);
    return { status: 500, error: "Errore interno del server" };
  }
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
          m.id_partita_hash,
          m.id_partita_visualizzato,
          m.nome_partita AS nome_match, 
          m.struttura_partita, 
          m.created_at AS data_creazione, 
          u.username AS creator_username,
          u.username AS creator_display_name,
          u.avatar_id AS creator_avatar,
          (SELECT count(user_id) FROM partecipanti_partite p2 WHERE p2.partita_id = m.id_partita) AS numero_partecipanti
      FROM partecipanti_partite p
      INNER JOIN partite m ON p.partita_id = m.id_partita
      LEFT JOIN utenti u ON m.id_host = u.id_user
      WHERE p.user_id = $1 
        AND substring(m.struttura_partita::text from 1 for 2) IN ('00', '01')
      ORDER BY m.created_at DESC`,
        [U_ID],
      );

    const last_created_match = await db.query(
        `SELECT 
          m.id_partita_hash,
          m.id_partita_visualizzato,
          m.nome_partita AS nome_match, 
          m.struttura_partita, 
          m.created_at AS data_creazione, 
          u.username AS creator_username,
          u.username AS creator_display_name,
          u.avatar_id AS creator_avatar,
          (SELECT count(user_id) FROM partecipanti_partite p2 WHERE p2.partita_id = m.id_partita) AS numero_partecipanti
      FROM partite m
      LEFT JOIN utenti u ON m.id_host = u.id_user
      WHERE m.id_host IS DISTINCT FROM $1
        AND NOT EXISTS (
          SELECT 1
          FROM partecipanti_partite p
          WHERE p.partita_id = m.id_partita
            AND p.user_id = $1
        )
        AND substring(m.struttura_partita::text from 1 for 2) IN ('00', '01')
      ORDER BY m.created_at DESC 
      LIMIT 10;`,
        [U_ID],
      );

    const match_chiuse = await db.query(
        `SELECT 
          m.id_partita_hash,
          m.id_partita_visualizzato,
          m.nome_partita AS nome_match,
          m.struttura_partita,
          m.created_at AS data_creazione,
          u.username AS creator_username,
          u.username AS creator_display_name,
          u.avatar_id AS creator_avatar,
          p.time_death,
          p.rank,
          p.punteggio,
          (SELECT count(user_id) FROM partecipanti_partite p2 WHERE p2.partita_id = m.id_partita) AS numero_partecipanti,
          CASE
            WHEN p.time_death IS NOT NULL THEN 'Eliminato'
            WHEN p.rank = 1 THEN 'Vinta'
            WHEN substring(m.struttura_partita::text from 1 for 2) IN ('10', '11') THEN 'Terminata'
            ELSE 'Terminata'
          END AS outcome
      FROM partecipanti_partite p
      INNER JOIN partite m ON p.partita_id = m.id_partita
      LEFT JOIN utenti u ON m.id_host = u.id_user
      WHERE p.user_id = $1 
        AND substring(m.struttura_partita::text from 1 for 2) IN ('10', '11')
      ORDER BY m.created_at DESC
      LIMIT 50;`,
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
    const decompress_match_chiuse = buildMatchMap(match_chiuse.rows);
    
    const Information = {
      user_profile: currentUser,
      leaderboard_regionale: leaderboard_regionale.rows,
      leaderboard_globale: leaderboard_globale.rows,
      user_position: user_position.rows[0]?.user_rank,
      match_attivi: decompress_match_attivi,
      last_created_match: decompress_match_unito,
      match_chiuse: decompress_match_chiuse,
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
  const getProfileData = async (U_ID) => {
  try {
    // 1. Dati base dell'utente
    const userQuery = await db.query(
      `SELECT username, email, reg, elo_rating, avatar_id, codice_amico 
       FROM utenti WHERE id_user = $1`,
      [U_ID]
    );
    const user = userQuery.rows[0];

    if (!user) {
      return { status: 404, error: "Utente non trovato" };
    }

    // 2. Simulazione statistiche belliche (In futuro le prenderai da una tabella 'statistiche_match')
    // Ad esempio: Kills, Morti, Territori conquistati
    const stats = {
      win_rate: 65, 
      kills: 15420,
      deaths: 8430,
      territories: 142,
      capitals: 12,
      elo_history: [1100, 1250, 1200, 1380, 1450] // Andamento ELO
    };

    return { 
      status: 200, 
      data: {
        profile: user,
        combat_stats: stats
      }
    };
  } catch (error) {
    console.error("Errore in getProfileData:", error);
    return { status: 500, error: "Errore nel recupero del profilo" };
  }

};

const getAvatar = async (U_ID) => {
  try {
    const sanitize_avatar = U_ID.split("avatar_").join(""); // Rimuove "avatar_" per la corretta scrittura nel DB
    console.log("Recupero avatar per U_ID:", U_ID);
    const q = await db.query(
      `SELECT avatar_id FROM utenti WHERE id_user = $1 LIMIT 1`,
      [sanitize_avatar]
    );
    const row = q.rows[0];
    if (!row) return { status: 404, error: 'Utente non trovato' };
    return { status: 200, data: { avatar_id: row.avatar_id } };
  } catch (error) {
    console.error('Errore in getAvatar:', error);
    return { status: 500, error: "Errore durante il recupero dell'avatar" };
  }
};

const updateAvatar = async (U_ID, avatarId) => {
  try {
    console.log("Recupero avatar per U_ID:", U_ID);
    const result = await db.query(
      `UPDATE utenti SET avatar_id = $1 WHERE id_user = $2 RETURNING avatar_id`,
      [avatarId, U_ID]
    );

    if (result.rowCount === 0) {
      return { status: 404, error: "Utente non trovato" };
    }

    // Invalidare la cache Redis della dashboard in modo che mostri il nuovo avatar
    await redisClient.del(`home_info:${U_ID}`);
    
    return { status: 200, message: "Avatar aggiornato con successo", data: result.rows[0] };
  } catch (error) {
    console.error("Errore in updateAvatar:", error);
    return { status: 500, error: "Errore durante l'aggiornamento dell'avatar" };
  }
};
const getFriends = async (U_ID) => {
  try {    
    const result = await db.query(
      `SELECT 
        u.username,
        u.reg,
        u.elo_rating,
        u.avatar_id,
      FROM amici a
      INNER JOIN utenti u ON a.id_amico = u.id_user
      WHERE a.id_user = $1;`,
      [U_ID],
    );
    if (!result) {
      return { status: 404, error: "Nessun amico trovato" };
    }
    return { status: 200, data: result.rows };
  } catch (error) {
    console.error("Errore in getFriends:", error);
    return { status: 500, error: "Errore durante il recupero degli amici" };
  }
};
const getFriendPendingRequests = async (U_ID) => {
  try {    
    const result = await db.query(
      `SELECT 
        u.username,
        u.reg,
        u.elo_rating,
        u.avatar_id,
        r.id_richiesta
      FROM richieste_amici r
      INNER JOIN utenti u ON r.id_richiedente = u.id_user
      WHERE r.id_destinatario = $1 AND r.stato = 'pending';`,
      [U_ID]
    );//lato frontend si contano le righe e si appende il numero di richieste in sospeso in alto nel banner amici
    if (!result) {
      return { status: 404, error: "Nessuna richiesta di amicizia in sospeso trovata" };
    }
    //potremmo voler aggiungere questi dati in redis. in discussione. TO UPDATE
    return { status: 200, data: result.rows };
  } catch (error) {
    console.error("Errore in getFriendPendingRequests:", error);
    return { status: 500, error: "Errore durante il recupero delle richieste di amicizia in sospeso" };
  }
};
const sendFriendRequest_byCode = async (username_utente, friendId) => {
  try {
    const result = await db.query(
      `INSERT INTO richieste_amici (id_richiedente, id_destinatario, stato) VALUES ((SELECT id_user FROM utenti WHERE username = $1), (SELECT id_user FROM utenti WHERE codice_amico = $2), 'pending') RETURNING id_richiesta;`,
      [username_utente, friendId]
    );
    return { status: 200, data: { message: "Richiesta di amicizia inviata con successo", req_id : result.rows[0].id_richiesta } };
  } catch (error) {
    console.error("Errore in sendFriendRequest_byCode:", error);
    return { status: 500, error: "Errore durante l'invio della richiesta di amicizia" };
  }
};
const sendFriendRequest_byUsername = async (username_utente, username_destinatario) => {
  try {
    const result = await db.query(
      `INSERT INTO richieste_amici (id_richiedente, id_destinatario, stato) VALUES ((SELECT id_user FROM utenti WHERE username = $1), (SELECT id_user FROM utenti WHERE username = $2), 'pending') RETURNING id_richiesta;`,
      [username_utente, username_destinatario]
    );
    return { status: 200, data: { message: "Richiesta di amicizia inviata con successo", req_id : result.rows[0].id_richiesta } };
  } catch (error) {
    console.error("Errore in sendFriendRequest_byUsername:", error);
    return { status: 500, error: "Errore durante l'invio della richiesta di amicizia" };
  }
};
//LE QUERY SONO GIA' IMPOSTATE PER PRENDERE DIRETTAMENTE GLI USERNAME, NON GLI ID, QUINDI NELLE FUNZIONI DEL CONTROLLER PASSIAMO DIRETTAMENTE GLI USERNAME CHE PRENDIAMO DAL TOKEN JWT, NON GLI ID. IN QUESTO MODO EVITIAMO DI FARE QUERY AGGIUNTIVE PER TRADURRE ID IN USERNAME E VICEVERSA, OTTIMIZZANDO LE PRESTAZIONI.
//PER TANTO AD ORA NON POSSONO FUNZIONARE
const respondToFriendRequest = async (username_utente, username_req, requestId, accept) => {
  try {    
    const new_accept = String.toString(accept); // Convertiamo il booleano in stringa "true" o "false"
    const newStatus = new_accept ? 'accepted' : 'rejected';
    if(!newStatus) {
      return { status: 400, error: "Valore di accettazione non valido" };
    }
    const result = await db.query(
      `UPDATE richieste_amici SET stato = $1 WHERE id_richiesta = $2 AND id_destinatario = $3 RETURNING id_richiesta;`,
      [newStatus, requestId, username_req]
    );
    if (result.rowCount === 0) {
      return { status: 404, error: "Richiesta di amicizia non trovata o non autorizzata" };
    }
    if (newStatus === 'accepted') {
      // Se accettata, inseriamo la relazione di amicizia
      await db.query(
        `INSERT INTO amici (id_user, id_amico, id_richiesta) VALUES ((SELECT id_user FROM utenti WHERE username = $1), (SELECT id_user FROM utenti WHERE username = $2), $3)`,
        [username_utente, username_req, requestId]
      );
    }
    return { status: 200, data: { message: "Richiesta di amicizia risposta con successo" } };
  } catch (error) {
    console.error("Errore in respondToFriendRequest:", error);
    return { status: 500, error: "Errore durante la risposta alla richiesta di amicizia" };
  }
};
const removeFriend = async (username_utente, friendId) => {
  try {
    const result = await db.query(
      `DELETE FROM amici WHERE (id_user = (SELECT id_user FROM utenti WHERE username = $1) AND id_amico =  $2);`,
      [username_utente, friendId]
    );
    return { status: 200, data: { message: "Amico rimosso con successo" } };
  } catch (error) {
    console.error("Errore in removeFriend:", error);
    return { status: 500, error: "Errore durante la rimozione dell'amico" };
  }
};


module.exports = {
  buildHome,
  buildActiveMatchesBrowser,
  getProfileData,
  getAvatar,
  updateAvatar,
  getFriends,
  getFriendPendingRequests,
  sendFriendRequest_byCode,
  sendFriendRequest_byUsername,
  respondToFriendRequest,
  removeFriend
};