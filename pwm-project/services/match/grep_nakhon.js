const Redis = require('ioredis');
const redis = new Redis({ host: 'localhost', port: 6379 });

async function grep() {
    const keys = await redis.keys('match:*:player:*:armate');
    for (const key of keys) {
        const data = await redis.get(key);
        if (data && data.includes('Nakhon Ratchasima')) {
            console.log("Found in key:", key);
            const armate = JSON.parse(data);
            for (const [id, army] of Object.entries(armate)) {
                if (army.targetName === 'Nakhon Ratchasima') {
                    console.log(`Army: ${army.name} (${id})`);
                    console.log(`  Status: ${army.status}, TargetName: ${army.targetName}`);
                }
            }
        }
    }
    process.exit(0);
}
grep();
