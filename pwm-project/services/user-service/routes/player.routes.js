const express = require("express");
const playerController = require("../controllers/playerController.js");

const router = express.Router();

// Rotta per la dashboard/home page dell'utente
router.get("/home", playerController.home);
router.get("/home/active-matches", playerController.getActiveMatchesBrowser);
router.get("/friends/list", playerController.getFriends);
router.get("/friends/requests", playerController.getFriendPendingRequests);
router.post("/friends/requests/sendByCode", playerController.sendFriendRequest_byCode);
router.post("/friends/requests/sendByUsername", playerController.sendFriendRequest_byUsername);
router.post("/friends/requests/respond", playerController.respondToFriendRequest);
router.post("/friends/remove", playerController.removeFriend);
router.get("/player/profile", playerController.getProfile);
router.get("/player/avatar", playerController.getAvatar);
router.post("/player/profile/username", playerController.updateUsername);
router.post("/player/profile/password", playerController.updatePassword);
router.post("/player/profile/avatar", playerController.updateAvatar);

module.exports = router;