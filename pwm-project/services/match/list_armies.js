const Redis = require('ioredis');
const redis = new Redis({ host: 'localhost', port: 6379 });

async function list() {
    const keys = await redis.keys('match:*:player:mrk756:armate');
    for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
            const armate = JSON.parse(data);
            for (const [id, army] of Object.entries(armate)) {
                console.log(`Army: ${army.name} (${id})`);
                console.log(`  Status: ${army.status}, TargetName: ${army.targetName}, Path Length: ${army.path ? army.path.length : 0}`);
            }
        }
    }
    process.exit(0);
}
list();
