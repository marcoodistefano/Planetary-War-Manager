const redis = require('redis');

async function debugRedis() {
    const client = redis.createClient({ url: 'redis://127.0.0.1:6379' });
    await client.connect();

    try {
        console.log("Checking Redis keys for armate...");
        const keys = await client.keys('match:*:player:*:armate');
        console.log("Keys found:", keys);
        if (keys.length > 0) {
            for(let key of keys) {
                const data = await client.get(key);
                console.log(`Data for ${key}:`, data ? data.substring(0, 300) + '...' : 'null');
            }
        } else {
            console.log("No armate keys found. Did you create a new match?");
            // Let's check what match keys exist
            const allMatchKeys = await client.keys('match:*');
            console.log("Other match keys found:", allMatchKeys.slice(0, 20));
        }
    } catch(err) {
        console.error(err);
    } finally {
        await client.quit();
    }
}

debugRedis();
