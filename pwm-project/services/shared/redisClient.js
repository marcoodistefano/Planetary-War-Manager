const { createClient } = require('redis');

// Mettiamo 'redis://redis:6379' come fallback di default per Docker
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';

const redisClient = createClient({
  url: redisUrl,
  socket: {
    // Questa è la magia: se Redis non è pronto, Node riproverà in automatico
    reconnectStrategy: (retries) => {
      console.log(`⏳ Redis non pronto. Tentativo di riconnessione... (${retries})`);
      // Aspetta un tempo crescente ad ogni tentativo, fino a un massimo di 3 secondi
      return Math.min(retries * 500, 3000); 
    }
  }
});

redisClient.on('error', (err) => {
  // Ignoriamo i log di errore di timeout se stiamo già gestendo la riconnessione
  if (err.code !== 'ECONNREFUSED' && err.name !== 'ConnectionTimeoutError') {
    console.log('❌ Redis Client Error:', err);
  }
});

redisClient.on('connect', () => console.log('🟢 Comm-Link con Redis stabilito con successo!'));
redisClient.on('ready', () => console.log('⚡ Redis è pronto a ricevere comandi!'));

// Avvolgiamo la connessione in una funzione asincrona per gestire meglio gli errori
(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error("❌ Errore critico durante il boot di Redis:", err.message);
  }
})();

module.exports = redisClient;