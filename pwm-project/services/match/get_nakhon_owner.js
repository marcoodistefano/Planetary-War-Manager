const Redis = require('ioredis');
const redis = new Redis({ host: 'localhost', port: 6379 });

async function get() {
    const keys = await redis.keys('match:*:nations');
    for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
            const nations = JSON.parse(data);
            const owner = nations.find(n => n.territories_flat && n.territories_flat.includes('Nakhon Ratchasima'));
            if (owner) {
                console.log(`Match ${key}: Nakhon Ratchasima owned by ${owner.playerId} (Nation: ${owner.nationName})`);
            } else {
                console.log(`Match ${key}: Nakhon Ratchasima is neutral`);
            }
        }
    }
    process.exit(0);
}
get();
