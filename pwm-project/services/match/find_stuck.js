const Redis = require('ioredis');
const redis = new Redis({ host: 'localhost', port: 6379 });

async function find() {
    const keys = await redis.keys('match:*:player:*:armate');
    for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
            const armate = JSON.parse(data);
            for (const [id, army] of Object.entries(armate)) {
                if (army.status === 'in combattimento' || army.status === "Pronto all'attacco") {
                    console.log(`Found army: ${army.name} (${id}) for player ${key.split(':')[3]}`);
                    console.log(`  Status: ${army.status}, TargetName: ${army.targetName}, Location:`, army.currentLocation);
                }
            }
        }
    }
    process.exit(0);
}
find();
