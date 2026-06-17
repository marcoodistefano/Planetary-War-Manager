const { calculatePath } = require('./middleware/movementLogic.js');
const Eru = require('./middleware/Eru.js');
const fs = require('fs');

async function test() {
    console.log("Testing path from Israel to Dakar");
    // Let's pretend Israel is 34.8, 31.0 and Dakar is -17.4, 14.7
    try {
        const path = await calculatePath(34.8, 31.0, "Dakar", -17.4, 14.7, 1);
        console.log("Path valid:", path.isValid);
        console.log("Path distance:", path.distance);
        console.log("Path length (nodes):", path.path.length);
        if (path.path.length <= 10) {
            console.log(path.path);
        }
    } catch (e) {
        console.error(e);
    }
}
test().then(() => process.exit(0));
