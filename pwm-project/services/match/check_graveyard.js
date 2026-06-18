const Redis = require('ioredis');
const redis = new Redis({ host: 'localhost', port: 6379 });

async function check() {
    const keys = await redis.keys('match:*:player:mrk756:graveyard');
    for (const key of keys) {
        const data = await redis.lrange(key, 0, -1);
        console.log(`Graveyard for ${key}:`, data.length, "entries");
        data.forEach((entry, i) => {
            console.log(`  Entry ${i}:`, JSON.parse(entry).name, JSON.parse(entry).destroyedAt);
        });
    }
    process.exit(0);
}
check();
