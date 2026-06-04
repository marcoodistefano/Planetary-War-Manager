const redis = require('../shared/redisClient.js');
async function check() {
    const data = await redis.get('map_data:regions_adjacency');
    const adj = JSON.parse(data);
    console.log('Is Array?', Array.isArray(adj));
    console.log('Keys:', Object.keys(adj).slice(0, 5));
    process.exit(0);
}
check();
