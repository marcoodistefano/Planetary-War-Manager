const Redis = require('ioredis');
const redis = new Redis();
const { getMatch, updateMatch } = require('../shared/matchMonolithic.js');

async function test() {
    // 1. Setup initial monolith
    const hash = "testhash123";
    const monolith = {
        match: {
            id_partita: "uuid123",
            id_partita_hash: hash,
            id_visualizzato: "vis123",
            struttura_partita: "01",
            caratteristiche: { nome: "test" },
            player: []
        }
    };
    await redis.set(`match:${hash}`, JSON.stringify(monolith));

    // 2. Run updateMatch
    console.log("Running updateMatch...");
    await updateMatch(hash, async (matchObj) => {
        matchObj.match.player.push({ username: "test_bot", nationId: "nat1", isOccupied: false });
        return { save: true, matchObj, data: true };
    });
    console.log("updateMatch done.");

    // 3. Check what was saved
    const keys = await redis.keys(`match:${hash}*`);
    console.log("Keys after update:", keys);

    const base = await redis.get(`match:${hash}:base`);
    console.log("Base:", base);
    
    // 4. Try getting match
    const result = await getMatch(hash);
    console.log("GetMatch result:", !!result);
    process.exit(0);
}

test();
