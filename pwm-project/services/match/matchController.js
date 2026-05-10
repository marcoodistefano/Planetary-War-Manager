const notImplemented = (res) => res.status(501).json({ error: "Not implemented" });

const create = async (req, res) => {
  return notImplemented(res);
};
const join = async (_req, res) => notImplemented(res);
const leave = async (_req, res) => notImplemented(res);
const getPlayers = async (_req, res) => notImplemented(res);
const getStatus = async (_req, res) => notImplemented(res);
const getResult = async (_req, res) => notImplemented(res);
const getMatch = async (_req, res) => notImplemented(res);
const getHistory = async (_req, res) => notImplemented(res);

module.exports = { create, join, leave, getPlayers, getStatus, getResult, getMatch, getHistory };