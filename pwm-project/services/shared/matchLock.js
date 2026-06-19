const redis = require('./redisClient');

async function withMatchLock(matchId, callback) {
    const lockKey = `lock:match:${matchId}`;
    let locked = false;
    const lockVal = Date.now() + Math.random().toString();
    
    // Attempt to acquire lock for up to 5 seconds
    for (let i = 0; i < 50; i++) {
        const acquired = await redis.set(lockKey, lockVal, 'NX', 'PX', 5000);
        if (acquired) {
            locked = true;
            break;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    
    if (!locked) {
        throw new Error("Timeout acquiring match lock for match: " + matchId);
    }
    
    try {
        const matchDataStr = await redis.get(`match:${matchId}`);
        const matchObj = matchDataStr ? JSON.parse(matchDataStr) : null;
        
        const result = await callback(matchObj);
        
        if (result && result.save) {
            await redis.set(`match:${matchId}`, JSON.stringify(result.matchObj));
        }
        return result.data;
    } finally {
        const currentLock = await redis.get(lockKey);
        if (currentLock === lockVal) {
            await redis.del(lockKey);
        }
    }
}

module.exports = { withMatchLock };
