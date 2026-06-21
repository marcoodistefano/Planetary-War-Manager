const { calculateCurrentPosition } = require('./services/match/middleware/movementLogic.js');

const path = [ [10, 10], [20, 20], [30, 30] ];
const startTime = Date.now() - 5000;
const etaMs = 10000; // Halfway there

const pos = calculateCurrentPosition(path, startTime, etaMs);
console.log("Current Position:", pos);
