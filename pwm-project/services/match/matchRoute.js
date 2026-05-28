const express = require("express");
const matchController = require("./matchController.js");

const router = express.Router();

// Rimuovi "/match" dall'inizio di ogni percorso
router.post("/create", matchController.create);          // Diventa /match/create
router.post("/join", matchController.join);              // Diventa /match/join
router.get("/joinable", matchController.joinable);        // Diventa /match/joinable 
router.post("/:id/join", matchController.join);          // Diventa /match/:id/join
router.get("/:id", matchController.getMatch);            // Diventa /match/:id
router.post("/:id/leave", matchController.leave);        // Diventa /match/:id/leave
router.get("/:id/players", matchController.getPlayers);  // Diventa /match/:id/players
router.get("/:id/status", matchController.getStatus);    // Diventa /match/:id/status
router.get("/:id/result", matchController.getResult);    // Diventa /match/:id      result
router.get("/:id/history", matchController.getHistory);  // Diventa /match/:id/history
router.post("/:id/create/alliance", matchController.CreateAlliance);
router.get("/:id/alliance", matchController.getAlliance);
router.post("/:id/join/:id_alliance", matchController.JoinAlliance);
router.post("/:id/leave/:id_alliance", matchController.LeaveAlliance);
router.post("/:id/kick/:id_alliance", matchController.KickAlliance);
module.exports = router;