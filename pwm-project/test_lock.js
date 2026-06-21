const Redis = require('ioredis');
const redis = new Redis({ host: 'localhost', port: 6379 });

async function run() {
    const lock = await redis.set('my_lock', '1', 'NX', 'PX', 5000);
    console.log("Lock acquired?", lock);
    process.exit(0);
}
run();
