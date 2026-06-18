const Redis = require('ioredis');
const redis = new Redis({ host: 'localhost', port: 6379 });

async function get() {
    const keys = await redis.keys('match:*:nations');
    for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
            const nations = JSON.parse(data);
            for (const n of nations) {
                if (n.territories_flat) {
                    for (const t of n.territories_flat) {
                        if (t.toLowerCase().includes('nakhon')) {
                            console.log(`Found territory matching 'nakhon': ${t} (owned by ${n.playerId})`);
                        }
                    }
                }
            }
        }
    }
    process.exit(0);
}
get();
