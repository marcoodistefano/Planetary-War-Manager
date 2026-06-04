const redis = require('../shared/redisClient.js');
async function check() {
    const keys = await redis.keys('match:*:player:*:armate');
    if(keys.length>0) {
        const data = await redis.get(keys[0]);
        console.log(keys[0], data.substring(0, 300));
    }
    process.exit(0);
}
check();
