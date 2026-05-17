const express = require("express");
const playerController = require("../controllers/playerController.js");

const router = express.Router();

// Rotta per la dashboard/home page dell'utente
router.get("/home", playerController.home);

// Quando implementerai i controller per il profilo, potrai decommentare queste rotte.
// Ti consiglio di usare un prefisso come "/player" o "/user" per non fare confusione.
// router.get("/player/profile", playerController.profile);
// router.post("/player/profile/update", playerController.updateProfile);
// router.post("/player/profile/update/password", playerController.updatePassword);
// router.post("/player/profile/update/email", playerController.updateEmail);
// router.post("/player/profile/update/avatar", playerController.updateAvatar);

module.exports = router;