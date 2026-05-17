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

    const { avatarId } = req.body;
    // Log e validazione input: assicuriamoci di avere un intero valido
    console.log(`updateAvatar called for U_ID=${U_ID} with raw avatarId=`, avatarId);

    if (avatarId === undefined || avatarId === null) {
      return res.status(400).json({ error: "ID avatar mancante" });
    }

    const avatarInt = parseInt(avatarId, 10);
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


module.exports = {
  home,
  getProfile,
  getAvatar,
  updateUsername,
  updatePassword,
  updateAvatar
};