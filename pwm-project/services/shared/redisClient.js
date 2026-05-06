const { createClient } = require('redis');

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const redisClient = createClient({
  url: redisUrl
});

redisClient.on('error', (err) => console.log('❌ Redis Client Error:', err));
redisClient.on('connect', () => console.log('🟢 Comm-Link con Redis stabilito con successo!'));

redisClient.connect().catch(console.error);

module.exports = redisClient;