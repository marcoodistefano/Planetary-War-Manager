const redis = require('../shared/redisClient.js');
async function check() {
    const keys = await redis.keys('match:*:player:antop:armate');
    if(keys.length>0) {
        const data = await redis.get(keys[0]);
        const armate = JSON.parse(data);
        console.log(`Found ${Object.keys(armate).length} troops for antop in ${keys[0]}`);
        let count = 0;
        for (const id in armate) {
            if (count < 5) {
                console.log(armate[id].name, armate[id].currentLocation);
                count++;
            }
        }
    } else {
        console.log("No troops found for antop");
    }
    process.exit(0);
}
check();
