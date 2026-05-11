const model = require("./matchModel");

const notImplemented = (res) => res.status(501).json({ error: "Not implemented" });

const create = async (req, res) => {
  try {
    match = await model.createMatch(req.body);
    if(match.status === "200"){
      res.status(200).json({
        message: "Match creato con successo",
        match,
      });
    } else {
      res.status(match.status).json({
        error: match.message,
      });
    }
  } catch (error) {
    console.error("--- Errore durante l'elaborazione ---");
    console.error(error);
    res.status(500).json({
      error: "Errore interno del server",
      details: error.message,
    });
  } 
  return res;
};
const join = async (_req, res) => notImplemented(res);
const leave = async (_req, res) => notImplemented(res);
const getPlayers = async (_req, res) => notImplemented(res);
const getStatus = async (_req, res) => notImplemented(res);
const getResult = async (_req, res) => notImplemented(res);
const getMatch = async (_req, res) => notImplemented(res);
const getHistory = async (_req, res) => notImplemented(res);

module.exports = { create, join, leave, getPlayers, getStatus, getResult, getMatch, getHistory };