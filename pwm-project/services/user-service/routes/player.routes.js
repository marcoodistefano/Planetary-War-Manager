const express = require("express");
const playerController = require("../controllers/playerController.js");

const router = express.Router();

// Rotta per la dashboard/home page dell'utente
router.get("/home", playerController.home);
router.get("/player/profile", playerController.getProfile);
router.get("/player/avatar", playerController.getAvatar);
router.post("/player/profile/username", playerController.updateUsername);
router.post("/player/profile/password", playerController.updatePassword);
router.post("/player/profile/avatar", playerController.updateAvatar);


module.exports = router;