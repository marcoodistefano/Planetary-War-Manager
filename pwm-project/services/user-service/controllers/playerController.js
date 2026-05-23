const playerModel = require("../models/playerModel.js");

const home = async (req, res) => {
  try {
    // 1. Leggiamo l'ID utente iniettato dal gateway (app-route)
    const U_ID = req.headers['x-user-id'];
    
    if (!U_ID) {
      return res.status(401).json({ message: "Non autenticato (identità mancante)" });
    }

    // 2. Chiamata al model per costruire i dati della UI
    const result = await playerModel.buildHome(U_ID);
    
    if (result.status !== 200) {
      return res.status(result.status).json({ isValid: false, errors: [result.message] });
    }

    // 3. Invia i dati reali al frontend
    return res.status(200).json(result); 
    
  } catch (error) {
    console.error("Errore controller home:", error);
    return res.status(500).json({ error: "Errore interno del server" });
  }
};

const getActiveMatchesBrowser = async (req, res) => {
  try {
    const U_ID = req.headers['x-user-id'];
    if (!U_ID) return res.status(401).json({ message: "Non autenticato" });

    const result = await playerModel.buildActiveMatchesBrowser(U_ID);
    return res.status(result.status).json(result);
  } catch (error) {
    console.error("Errore controller getActiveMatchesBrowser:", error);
    return res.status(500).json({ error: "Errore interno del server" });
  }
};

  const getProfile = async (req, res) => {
  try {
    const U_ID = req.headers['x-user-id'];
    if (!U_ID) return res.status(401).json({ message: "Non autenticato" });

    const result = await playerModel.getProfileData(U_ID);
    return res.status(result.status).json(result);
  } catch (error) {
    console.error("Errore controller getProfile:", error);
    return res.status(500).json({ error: "Errore interno del server" });
  }
};

const getAvatar = async (req, res) => {
  try {
    const U_ID = req.headers['x-user-id'];
    if (!U_ID) return res.status(401).json({ message: "Non autenticato" });

    const result = await playerModel.getAvatar(U_ID);
    return res.status(result.status).json(result);
  } catch (error) {
    console.error("Errore controller getAvatar:", error);
    return res.status(500).json({ error: "Errore interno del server" });
  }
};

const updateUsername = async (req, res) => {
  try {
    const U_ID = req.headers['x-user-id'];
    const { newUsername } = req.body;
    // Qui andrà la chiamata al model per aggiornare
    return res.json({ message: "Username aggiornato in costruzione" });
  } catch (error) {
    return res.status(500).json({ error: "Errore interno" });
  }
};

const updatePassword = async (req, res) => {
  try {
    const U_ID = req.headers['x-user-id'];
    const { oldPassword, newPassword } = req.body;
    // Qui andrà la chiamata al model per aggiornare
    return res.json({ message: "Password aggiornata in costruzione" });
  } catch (error) {
    return res.status(500).json({ error: "Errore interno" });
  }
};

const updateAvatar = async (req, res) => {
  try {
    const U_ID = req.headers['x-user-id'];
    if (!U_ID) return res.status(401).json({ message: "Non autenticato" });
    console.log("updateAvatar chiamato per U_ID:", U_ID);
    const { avatarId } = req.body;
    // Log e validazione input: assicuriamoci di avere un intero valido
    console.log("HEADER RICHIESTA:",req.headers);
    console.log(`updateAvatar called for U_ID=${U_ID} with raw avatarId=`, avatarId);

    if (avatarId === undefined || avatarId === null) {
      return res.status(400).json({ error: "ID avatar mancante" });
    }
    const sanitize_avatar = avatarId.split("avatar_").join(""); // Rimuove "avatar_" per la corretta scrittura nel DB
    const avatarInt = parseInt(sanitize_avatar, 10);
    if (Number.isNaN(avatarInt) || avatarInt < 1 || avatarInt > 37) {
      console.warn(`avatarId non valido ricevuto: ${avatarId} -> parsed: ${avatarInt}`);
      return res.status(400).json({ error: "ID avatar non valido" });
    }

    const result = await playerModel.updateAvatar(U_ID, avatarInt);
    return res.status(result.status).json(result);
  } catch (error) {
    console.error("Errore controller updateAvatar:", error);
    return res.status(500).json({ error: "Errore interno del server" });
  }
};

const getFriends = async (req, res) => {
  try {
    const U_ID = req.headers['x-user-id']; //FIXARE! NON DEVE MANCO ESSERE INVIATA IN FASE DI LOGIN! QUI OPERO SOLO COL TOKEN JWT
    if (!U_ID) return res.status(401).json({ message: "Non autenticato" });
    const result = await playerModel.getFriends(U_ID);
    return res.status(result.status).json(result);
  } catch (error) {   
    console.error("Errore controller getFriends:", error);
    return res.status(500).json({ error: "Errore interno del server" });
  }
};

const getFriendPendingRequests = async (req, res) => {
  try {
    const U_ID = req.headers['x-user-id'];
    if (!U_ID) return res.status(401).json({ message: "Non autenticato" });
    const result = await playerModel.getFriendPendingRequests(U_ID);
    return res.status(result.status).json(result);
  } catch (error) {
    console.error("Errore controller getFriendPendingRequests:", error);
    return res.status(500).json({ error: "Errore interno del server" });
  }
};

const sendFriendRequest_byCode = async (req, res) => {
  try {
    const username_utente = req.headers['x-user-id'];//FIXARE! NON DEVE MANCO ESSERE INVIATA IN FASE DI LOGIN! QUI OPERO SOLO COL TOKEN JWT
    const { friendId } = req.body;
    if (!username_utente) return res.status(401).json({ message: "Non autenticato" });
    if (!friendId) return res.status(400).json({ message: "ID amico mancante" });
    const result = await playerModel.sendFriendRequest_byCode(username_utente, friendId);
    return res.status(result.status).json(result);
  } catch (error) {
    console.error("Errore controller sendFriendRequest_byCode:", error);
    return res.status(500).json({ error: "Errore interno del server" });
  }
};

const sendFriendRequest_byUsername = async (req, res) => {
  try {
    const username_utente = req.headers['x-user-id'];//FIXARE! NON DEVE MANCO ESSERE INVIATA IN FASE DI LOGIN! QUI OPERO SOLO COL TOKEN JWT
    const { username_destinatario } = req.body;
    if (!username_utente) return res.status(401).json({ message: "Non autenticato" });
    if (!username_destinatario) return res.status(400).json({ message: "Username destinatario mancante" });
    const result = await playerModel.sendFriendRequest_byUsername(username_utente, username_destinatario);
    return res.status(result.status).json(result);
  } catch (error) {
    console.error("Errore controller sendFriendRequest_byUsername:", error);
    return res.status(500).json({ error: "Errore interno del server" });
  }
};
const respondToFriendRequest = async (req, res) => {
  try {
    const username_utente = req.headers['x-user-id'];//FIXARE! NON DEVE MANCO ESSERE INVIATA IN FASE DI LOGIN! QUI OPERO SOLO COL TOKEN JWT
    const username_req = req.headers['username'];
    const { requestId, accept } = req.body;
    if (!username_req) return res.status(401).json({ message: "Non autenticato" });
    if (!requestId) return res.status(400).json({ message: "ID richiesta mancante" });
    const result = await playerModel.respondToFriendRequest(username_utente, username_req, requestId, accept);
    return res.status(result.status).json(result);
  } catch (error) {
    console.error("Errore controller respondToFriendRequest:", error);
    return res.status(500).json({ error: "Errore interno del server" });
  }
};
const removeFriend = async (req, res) => {
  try {
    const username_utente = req.headers['x-user-id'];//FIXARE! NON DEVE MANCO ESSERE INVIATA IN FASE DI LOGIN! QUI OPERO SOLO
    const { friendId } = req.body;
    if (!username_utente) return res.status(401).json({ message: "Non autenticato" });
    if (!friendId) return res.status(400).json({ message: "ID amico mancante" });
    const result = await playerModel.removeFriend(username_utente, friendId);
    return res.status(result.status).json(result);
  } catch (error) {
    console.error("Errore controller removeFriend:", error);
    return res.status(500).json({ error: "Errore interno del server" });
  }
};


module.exports = {
  home,
  getActiveMatchesBrowser,
  getProfile,
  getAvatar,
  updateUsername,
  updatePassword,
  updateAvatar,
  getFriends,
  getFriendPendingRequests,
  sendFriendRequest_byCode,
  sendFriendRequest_byUsername, 
  respondToFriendRequest,
  removeFriend
};