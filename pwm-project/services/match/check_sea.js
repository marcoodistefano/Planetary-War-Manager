const redis = require('../shared/redisClient.js');

async function check() {
    try {
        const dataStr = await redis.get('map_data:regions_adjacency');
        const adj = JSON.parse(dataStr);

        const sicily = ['Trapani', 'Palermo', 'Messina', 'Agrigento', 'Caltanissetta', 'Enna', 'Catania', 'Ragusa', 'Siracusa'];
        for (const key in adj) {
            const r = adj[key];
            if(r.name && sicily.some(s => r.name.includes(s))) {
                console.log(`- ${r.admin} / ${r.name}: [lat: ${r.lat}, lng: ${r.lng}]`);
            }
        }
    } catch(err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
check();
