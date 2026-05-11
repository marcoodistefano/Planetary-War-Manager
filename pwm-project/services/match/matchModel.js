const aslan = require("./middleware/Aslan.js");
const db = require("../shared/postgresClient.js");
const redis = require("../shared/redisClient.js");


const mapUniqueViolation = (error) => {
  if (!error || error.code !== "23505") return null;

  const constraint = String(error.constraint || "").toLowerCase();
  const detail = String(error.detail || "");

  if (constraint.includes("username") || detail.includes("(username)")) {
    return "Username già in uso";
  }
  if (constraint.includes("email") || detail.includes("(email)")) {
    return "Email già in uso";
  }
  return "Utente già esistente";
};

const createMatch = async ({ playerId, gameMode }) => {
  try {
    //verifico che il giocatore non abbia già una partita in corso come host
    let rows = await db.query(
      "SELECT count(id_partita) FROM partite, utenti WHERE (utenti.id_user = $1 AND partite.id_host = $1) AND SUBSTRING(partite.struttura_partita FROM 1 FOR 2) = B'10';",
      [playerId],
    );
    if (rows[0].count > 0) {
      console.log("Il giocatore è già host di una partita in corso");
      return {
        status: "400",
        message:
          "Il giocatore ha già creato una partita in corso e questa è ancora in corso.",
      };
    } else {
      const id_partita_hash = await aslan.generateSecureToken(256); //ASLAN NON é ANCORA NELLA CARTELLA
      const id_partita_visualizzato = await aslan.generateSecureToken(10);
      const struttura_partita = await generateMatchStructure(gameMode); //torna: stato, messaggio e content (stringa di 56 bit)
      if (struttura_partita.status == "200") {
        //ISTANZA REDIS
        rows = await db.query(
          "INSERT INTO partite (id_partita_hash, id_partita_visualizzato, id_host, struttura_partita, has_elo) VALUES ($1, $2, $3, $4, $5);",
          [
            id_partita_hash,
            id_partita_visualizzato,
            playerId,
            struttura_partita.message,
            gameMode.hasElo,
          ],
        );
        return struttura_partita;
      } else {
        console.log(
          "Errore durante la generazione della struttura della partita:",
          struttura_partita.message,
        );
        return {
          status: struttura_partita.status,
          message: struttura_partita.message,
        };
      }
    }
  } catch (error) {
    console.error("Errore durante la verifica delle partite in corso:", error);
    return {
      status: "500",
      message:
        "Errore interno del server durante la verifica delle partite in corso.",
    };
  }
};

const generateMatchStructure = async (gameMode) => {
  let struttura_partita = STATO.IN_ATTESA;

  try {
    //generazione della struttura della partita in base alla modalità di gioco
  } catch (error) {
    console.error(
      "Errore durante la generazione della struttura della partita:",
      error,
    );
    return {
      status: "500",
      message:
        "Errore interno del server durante la generazione della struttura della partita.",
    };
  }
};
