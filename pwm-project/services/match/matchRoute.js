const express = require("express");
const matchController = require("./matchController.js");

const router = express.Router();

router.post("/match/create", matchController.create);
router.post("/match/join", matchController.join);
router.get("/match/:id", matchController.getMatch);
router.post("/match/:id/leave", matchController.leave);
router.get("/match/:id/players", matchController.getPlayers);
router.get("/match/:id/status", matchController.getStatus);
router.get("/match/:id/result", matchController.getResult);
router.get("/match/:id/history", matchController.getHistory);


module.exports = router;
