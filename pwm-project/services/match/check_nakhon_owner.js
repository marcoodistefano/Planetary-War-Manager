const Redis = require('ioredis');
const redis = new Redis({ host: 'pwm-project-redis-1', port: 6379 });
async function check() {
    try {
        const keys = await redis.keys('match:*:nations');
        let found = false;
        for (const key of keys) {
            const nationsStr = await redis.get(key);
            if (nationsStr) {
                const nations = JSON.parse(nationsStr);
                for (const nation of nations) {
                    if (nation.territories_flat && (nation.territories_flat.includes('Nakhon Ratchasima') || nation.territories_flat.includes('THA-30') || nation.territories_flat.includes('THA-3046') || nation.territories_flat.includes('THA-3047'))) {
                        console.log(`Region owned by: ${nation.playerId} (Nation: ${nation.nationName})`);
                        found = true;
                    }
                }
            }
        }
        if (!found) {
            console.log("Region not found in any nation's territories_flat.");
        }
    } catch (e) { console.error(e); } finally { redis.disconnect(); }
}
check();
