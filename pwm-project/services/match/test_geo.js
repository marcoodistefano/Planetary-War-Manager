const Redis = require("ioredis");
const redis = new Redis({ host: 'localhost', port: 6379 });
async function test() {
  await redis.geoadd('test:geo', 15.0, 37.0, 'armata1');
  const pipe = redis.pipeline();
  pipe.georadius('test:geo', 15.0, 37.0, 100, 'km');
  const res = await pipe.exec();
  console.log(JSON.stringify(res));
  process.exit(0);
}
test();
