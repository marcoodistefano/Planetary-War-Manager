const aslan = require("./middleware/Aslan.js");
const db = require("../shared/postgresClient.js");
const redis = require("../shared/redisClient.js");
const Eru = require("./midleware/Eru.js");

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
    console.log(`Verifica partite in corso per il giocatore ${playerId}...`);
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
      console.log(`Creazione della partita per il giocatore ${playerId}...`);
      const id_partita_hash = await aslan.generateSecureToken(256); //ASLAN NON é ANCORA NELLA CARTELLA
      const id_partita_visualizzato = await aslan.generateSecureToken(10);
      const struttura_partita = await generateMatchStructure(gameMode); //torna: stato, messaggio e content (stringa di 56 bit)
      if (
        struttura_partita.status == "200" &&
        struttura_partita.struct != null
      ) {
        //ISTANZA REDIS
        rows = await db.query(
          "INSERT INTO partite (id_partita_hash, id_partita_visualizzato, id_host, struttura_partita, has_elo) VALUES ($1, $2, $3, $4, $5);",
          [
            id_partita_hash,
            id_partita_visualizzato,
            playerId,
            struttura_partita.struct,
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
  if (gameMode.STATO !== "IN_ATTESA") gameMode.STATO = "IN_ATTESA"; //Forzo lo stato in attesa, visto che la partita è appena stata creata
  try {
    let res = Eru.procedure_create_match(gameMode);
    let match = res.match;
    console.log(`Struttura della partita generata: ${JSON.stringify(match)}`);
    let binary_match = res.binary_match;
    console.log(`Struttura della partita in formato binario: ${binary_match}`);
    if (binary_match.length !== 56) {
      console.error(
        `La struttura della partita in formato binario non è di 56 bit: ${binary_match}`,
      );
      return {
        status: "500",
        message:
          "Errore interno del server: la struttura della partita in formato binario non è di 56 bit.",
        struct: null,
      };
    } else {
      console.log(
        `La struttura della partita in formato binario è correttamente di 56 bit.`,
      );
      let joined = await join_Match(gameMode.id_host, id_partita_hash);
      if(joined.status !== "200") {
        console.error(
          `Errore durante il join alla partita appena creata: ${joined.message}`,
        );
        return {
          status: "500",
          message:
            "Errore interno del server: impossibile unirsi alla partita appena creata.",
        };
      }else{
        console.log(`Join alla partita ${id_partita_hash} appena creata avvenuto con successo: ${joined.message}`);
      }
      return {
        status: "200",
        message: "Struttura della partita generata con successo.",
      };
    }
  } catch (error) {
    console.error(
      "Errore durante la generazione della struttura della partita:",
      error,
    );
    return {
      status: "500",
      message:
        "Errore interno del server durante la generazione della struttura della partita.",
      struct: null,
    };
  }
},

  
  const join_Match = async (playerId, id_partita_hash) => {
    let res;
    try {
      console.log(`Il giocatore ${playerId} si sta unendo alla partita con hash ${id_partita_hash}...`);
      let rows_select = await db.query(
        "SELECT partite.struttura_partita FROM partite WHERE id_partita_hash = $1; AND partite.id_partita_hash = $1;",
        [id_partita_hash],
      );
      let count = rows_select.length;
      console.log(`Partite trovate con hash ${id_partita_hash}: ${count}`);
      if(rows_select.length === 0) {
        console.log(`Nessuna partita trovata con hash ${id_partita_hash}`);
        res = {
          status: "404",
          message: "Partita non trovata.",
        };
      }
      else{
        rows = await db.query(
          "INSERT INTO partecipazioni (id_partita_hash, id_user) VALUES ($1, $2);",
          [id_partita_hash, playerId],
        );
        console.log(`Il giocatore ${playerId} si è unito alla partita con hash ${id_partita_hash} con successo.`);
        console.log(`Struttura della partita con hash ${id_partita_hash}: ${rows_select[0].struttura_partita}`);
        eru_start = Eru.check_start_match(rows_select[0].struttura_partita, count);
        if(eru_start.status == 200) { //ad ogni ingresso di un giocatore, verifico se la partita è pronta per essere avviata, ERU tiene traccia delle tabelle di conversione, quindi spetta a lui stabilire se la partita è pronta per essere avviata o meno, e in caso affermativo, avviare la partita (cambiando lo stato della partita in corso e notificando i giocatori coinvolti)
          //da implementare
          rows = await db.query(
            "UPDATE partite SET struttura_partita = $1 WHERE id_partita_hash = $2;",
            [eru_start.struttura_partita, id_partita_hash],
          );
          console.log(`La partita con hash ${id_partita_hash} è pronta per essere avviata. Struttura aggiornata: ${eru_start.struttura_partita}`);
          //START()
          //NOTIFY_ALL()
        }else{
          console.log(`La partita con hash ${id_partita_hash} non è ancora pronta per essere avviata. Struttura attuale: ${eru_start.struttura_partita}`);
        }
        res = {
          status: "200",
          message: "Join alla partita avvenuto con successo.",
          struttura_partita: eru_start.struttura_partita,
        };
      }
    } catch (error) {
      console.error(
        "Errore durante il tentativo di join alla partita:",
        error,
      );
      res = {
        status: "500",
        message:
          "Errore interno del server durante il tentativo di join alla partita.",
      };
    }
    return res;
  };
