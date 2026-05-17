const express = require("express");
const authController = require("../controllers/authController.js");

const router = express.Router();

router.post("/auth/register", authController.register);
router.post("/auth/login", authController.login);
router.post("/auth/login/recovery/username", authController.recoveryUsername);
router.post("/auth/login/recovery/password", authController.recoveryPassword);
router.post("/auth/login/recovery/password/:token", authController.recoveryPasswordToken);
router.post("/auth/logout", authController.logout);

module.exports = router;