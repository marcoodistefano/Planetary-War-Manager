const express = require('express');
const chatController = require('../controllers/chatController.js');

const router = express.Router();

router.get('/chat/history', chatController.getHistory);
router.post('/chat/message', chatController.postMessage);

module.exports = router;
