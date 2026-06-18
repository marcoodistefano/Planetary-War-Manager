const Redis = require('ioredis');
const redis = new Redis({ host: 'localhost', port: 6379 });

async function list() {
    const keys = await redis.keys('match:*:player:*:armate');
    for (const key of keys) {
        const player = key.split(':')[3];
        if (player.startsWith('bot_')) continue;
        const data = await redis.get(key);
        if (data) {
            const armate = JSON.parse(data);
            for (const [id, army] of Object.entries(armate)) {
                if (army.status !== 'standby') {
                    console.log(`Army: ${army.name} (${id}) for player ${player}`);
                    console.log(`  Status: ${army.status}, Target: ${army.targetName}, Location: ${army.currentLocation.x}, ${army.currentLocation.y}`);
                }
            }
        }
    }
    process.exit(0);
}
list();
