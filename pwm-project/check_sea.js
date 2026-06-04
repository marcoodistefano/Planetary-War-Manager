const redis = require('redis');

async function check() {
    const client = redis.createClient({ url: 'redis://127.0.0.1:6379' });
    client.on('error', (err) => {
        console.error("Redis Error: ", err);
    });
    await client.connect();

    try {
        const dataStr = await client.get('map_data:regions_adjacency');
        const adj = JSON.parse(dataStr);

        console.log("Searching for regions between lat 33-36.5 and lng 11-16 (Sea south of Sicily/Malta)...");
        let count = 0;
        for (const key in adj) {
            const r = adj[key];
            if (r.lat < 36.5 && r.lat > 33.0 && r.lng > 11.0 && r.lng < 16.0) {
                console.log(`- ${r.admin} / ${r.name}: [lat: ${r.lat}, lng: ${r.lng}]`);
                count++;
            }
        }
        console.log(`Found ${count} regions.`);
    } catch(err) {
        console.error(err);
    } finally {
        await client.quit();
    }
}
check();
