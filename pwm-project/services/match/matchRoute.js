const express = require("express");
const matchController = require("./matchController.js");

const router = express.Router();

router.post("/create", matchController.create);
router.post("/join", matchController.join);
router.get("/joinable", matchController.joinable);
router.post("/:id/join", matchController.join);
router.get("/:id", matchController.getMatch);
router.get("/:id/initial-state", matchController.getInitialState);
router.post("/:id/leave", matchController.leave);
router.get("/:id/players", matchController.getPlayers);
router.get("/:id/status", matchController.getStatus);
router.get("/:id/result", matchController.getResult);
router.get("/:id/history", matchController.getHistory);
router.get("/:id/player/:username/graveyard", matchController.getGraveyard);
router.post("/:id/create/alliance", matchController.CreateAlliance);
router.get("/:id/alliance", matchController.getAlliance);
router.post("/:id/join/:id_alliance", matchController.JoinAlliance);
router.post("/:id/leave/:id_alliance", matchController.LeaveAlliance);
router.post("/:id/kick/:id_alliance", matchController.KickAlliance);
router.post("/:id/tactical-decision", matchController.tacticalDecision);

module.exports = router;