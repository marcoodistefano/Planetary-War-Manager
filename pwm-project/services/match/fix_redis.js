const Redis = require('ioredis');
const redis = new Redis({ host: 'localhost', port: 6379 });

async function fix() {
    const key = 'match:vTPaNBCIELjgLOKv1kGHVY5vsIb6sznjZkItqFCEVafdJLoijhjO3KgNp211q4SoguSt48y1GxLIQZVK7lFlc3YZq4f0IEWKSzrtu61F6wKzE94zfVUuRjncjg1t48qst0heBRQ8kBKr47McOf9Pe1aDCYQ3nGIcjEI4vFk8T3XrceVmisMvgN0h4mO1qArQC5mqKOX3t1EmmXJzjTCYeimtmgxsseNizAlaGjPUppAOIP6gT2mAutxzwIQSosS:player:mrk756:armate';
    const data = await redis.get(key);
    if (data) {
        const parsed = JSON.parse(data);
        if (parsed['af772bf9-4821-4fb8-8012-9611020faabd']) {
            parsed['af772bf9-4821-4fb8-8012-9611020faabd'].status = 'standby';
            delete parsed['af772bf9-4821-4fb8-8012-9611020faabd'].next_round_time;
            await redis.set(key, JSON.stringify(parsed));
            console.log("Fixed in Redis");
        }
    }
    process.exit(0);
}
fix();
