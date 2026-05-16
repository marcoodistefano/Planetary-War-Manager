const express = require("express");
const authController = require("./authController.js");

const router = express.Router();

router.post("/auth/register", authController.register);
router.post("/auth/login", authController.login);
router.post("/auth/login/recovery/username", authController.recoveryUsername);
router.post("/auth/login/recovery/password", authController.recoveryPassword);
router.post("/auth/login/recovery/password/:token", authController.recoveryPasswordToken);
router.get("/home", authController.home);
// router.get("/profile", authController.profile);
// router.post("/profile/update", authController.updateProfile);
// router.post("/profile/update/password", authController.updatePassword);
// router.post("/profile/update/email", authController.updateEmail);
// router.post("/profile/update/avatar", authController.updateAvatar);


module.exports = router;
