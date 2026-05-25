const express = require('express');
const chatController = require('../controllers/chatController.js');

const router = express.Router();

router.get('/chat/history', chatController.getHistory);
router.post('/chat/message', chatController.postMessage);
router.post('/chat/message/system/cXVlc3RhIOggdW5hIHJvdHRhIGRpIHNpc3RlbWEsIG5vbiB1dGlsaXp6YXJsYSwgcGVyIGZhdm9yZQ', chatController.postSystemMessage); // Endpoint alternativo per WebSocket (se necessario)
//ROTTA DI SISTEMA!

module.exports = router;
