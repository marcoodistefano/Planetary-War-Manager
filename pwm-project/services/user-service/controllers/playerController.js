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

module.exports = {
  home,
};