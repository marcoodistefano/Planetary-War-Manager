const redis = require('../shared/redisClient.js');
async function check() {
    const data = await redis.get('map_data:regions_adjacency');
    const adj = JSON.parse(data);
    let count=0;
    for(let k in adj) {
        if(adj[k].name && adj[k].name.includes('Wien')) {
            console.log('Wien:', adj[k]);
            count++;
        }
    }
    if(count===0) console.log('No Wien found');
    process.exit(0);
}
check();
