const Redis = require('ioredis');
const redis = new Redis({ host: 'localhost', port: 6379 });

async function find() {
    const keys = await redis.keys('match:*:player:*:armate');
    for (const key of keys) {
        const player = key.split(':')[3];
        const data = await redis.get(key);
        if (data) {
            const armate = JSON.parse(data);
            for (const [id, army] of Object.entries(armate)) {
                if (army.targetName === 'Nakhon Ratchasima' || (army.currentLocation && army.currentLocation.x && army.currentLocation.x > 100)) {
                    console.log(`Army: ${army.name} (${id}) for player ${player}`);
                    console.log(`  Status: ${army.status}, TargetName: ${army.targetName}`);
                }
            }
        }
    }
    process.exit(0);
}
find();
