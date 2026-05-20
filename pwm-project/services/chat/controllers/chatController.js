const chatModel = require("../models/chatModel.js");

const getUserIdFromRequest = (req) => {
  const headerValue = req.headers["x-user-id"];
  return headerValue ? String(headerValue) : null;
};

const getHistory = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res
        .status(401)
        .json({ error: "Accesso negato: Identita non verificabile." });
    }

    const { limit, matchId, id_partita: idPartita, destinatario, tipo } = req.query;
    const result = await chatModel.getRecentMessages({
      userId,
      matchId: matchId || idPartita,
      destinatario,
      tipo,
      limit,
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    return res.json({ items: result.items });
  } catch (error) {
    console.error("[SYS_ERR] Chat history error:", error);
    return res.status(500).json({ error: "Errore interno del server" });
  }
};

const postMessage = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res
        .status(401)
        .json({ error: "Accesso negato: Identita non verificabile." });
    }

    const { matchId, id_partita: idPartita, destinatario, tipo, content, message, text } = req.body || {};
    const result = await chatModel.processMessage({
      userId,
      matchId: matchId || idPartita,
      destinatario,
      tipo,
      content: content || message || text,
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    return res.status(201).json({ message: result.message });
  } catch (error) {
    console.error("[SYS_ERR] Chat message error:", error);
    return res.status(500).json({ error: "Errore interno del server" });
  }
};

module.exports = {
  getHistory,
  postMessage,
};
