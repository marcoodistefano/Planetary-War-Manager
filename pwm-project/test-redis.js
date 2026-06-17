const redis = require('./services/shared/redisClient.js');
async function test() {
  const keys = await redis.keys('match:*:player:mrk:armate');
  for (const key of keys) {
    console.log("KEY:", key);
    const data = JSON.parse(await redis.get(key));
    for (const [id, army] of Object.entries(data)) {
      if (army.status === 'moving' || army.path) {
        console.log(`Army ${id}: status=${army.status}, startTime=${army.startTime}, etaMs=${army.etaMs}, pathLength=${army.path?.length}`);
      }
    }
  }
  process.exit(0);
}
test();
