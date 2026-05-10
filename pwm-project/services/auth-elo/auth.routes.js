const express = require("express");
const authController = require("./authController.js");

const router = express.Router();

router.post("/auth/register", authController.register);
router.post("/auth/login", authController.login);
router.post("/auth/login/recovery/username", authController.recoveryUsername);
router.post("/auth/login/recovery/password", authController.recoveryPassword);
router.post("/auth/login/recovery/password/:token", authController.recoveryPasswordToken);



module.exports = router;
