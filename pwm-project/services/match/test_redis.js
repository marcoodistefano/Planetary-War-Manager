const Redis = require('ioredis');
const client = new Redis({ host: 'localhost', port: 6379 });
client.keys('match:*').then(async (keys) => {
  for (let key of keys) {
    const data = JSON.parse(await client.get(key));
    if (data.match && data.match.player) {
      for (let p of data.match.player) {
         if (p.armate && Object.keys(p.armate).length > 0) {
            console.log("Player:", p.username);
            console.log("Armate:", JSON.stringify(p.armate, null, 2));
         }
      }
    }
  }
  process.exit(0);
});
