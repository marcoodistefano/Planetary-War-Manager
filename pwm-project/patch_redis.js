const Redis = require('redis');
const redis = Redis.createClient({ url: 'redis://localhost:6379' });
async function run() {
    await redis.connect();
    const matchId = 'c5f7d8a9ce8e4aac758ffc458f01bc962ce70d01be83fc918c7f88f3d5d1ed88';
    const key = `match:${matchId}:regions_resources`;
    const dataStr = await redis.get(key);
    if (dataStr) {
        const data = JSON.parse(dataStr);
        let count = 0;
        for (const reg in data) {
            if (Math.random() < 0.05) {
                data[reg].ultra_rare = Math.random() < 0.5 ? 'oro' : 'uranio';
                count++;
            }
        }
        await redis.set(key, JSON.stringify(data));
        console.log(`Patched ${count} territories with ultra rare resource`);
    }
    await redis.disconnect();
}
run();
