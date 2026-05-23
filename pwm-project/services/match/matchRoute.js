const express = require("express");
const matchController = require("./matchController.js");

const router = express.Router();

// Rimuovi "/match" dall'inizio di ogni percorso
router.post("/create", matchController.create);          // Diventa /match/create
router.post("/join", matchController.join);              // Diventa /match/join
router.get("/joinable", matchController.joinable);        // Diventa /match/joinable 
router.post("/:id/join", matchController.join);          // Diventa /match/:id/join
router.post("/join", matchController.join);              // Compatibilità con eventuali chiamate legacy
router.get("/:id", matchController.getMatch);            // Diventa /match/:id
router.post("/:id/leave", matchController.leave);        // Diventa /match/:id/leave
router.get("/:id/players", matchController.getPlayers);  // Diventa /match/:id/players
router.get("/:id/status", matchController.getStatus);    // Diventa /match/:id/status
router.get("/:id/result", matchController.getResult);    // Diventa /match/:id      result
router.get("/:id/history", matchController.getHistory);  // Diventa /match/:id/history

module.exports = router;