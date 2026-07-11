const http = require('http');

class DynamicPathfinder {
    constructor() {
        this.goServiceUrl = process.env.PATHFINDING_SERVICE_URL || 'http://pathfinding-service:8090/api/calculate';
    }

    async findPath(startLng, startLat, endLng, endLat, multiplier = 1.0) {
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify({
                startX: startLng,
                startY: startLat,
                targetX: endLng,
                targetY: endLat,
                multiplier: multiplier
            });

            const url = new URL(this.goServiceUrl);
            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            };

            const req = http.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const resJson = JSON.parse(data);
                            if (Array.isArray(resJson)) {
                                resolve({ path: resJson, cost: 0 }); // Fallback old format
                            } else {
                                resolve(resJson); // { path: [...], cost: ... }
                            }
                        } catch (err) {
                            console.error("[PATHFINDER] Errore parsing risposta dal servizio Go:", err);
                            // Fallback
                            resolve({ path: [[startLng, startLat], [endLng, endLat]], cost: 0 });
                        }
                    } else {
                        console.error(`[PATHFINDER] Errore servizio Go. StatusCode: ${res.statusCode}`);
                        resolve({ path: [[startLng, startLat], [endLng, endLat]], cost: 0 });
                    }
                });
            });

            req.on('error', (e) => {
                console.error(`[PATHFINDER] Connessione al servizio Go fallita: ${e.message}`);
                // Fallback in caso di mancata connessione
                resolve({ path: [[startLng, startLat], [endLng, endLat]], cost: 0 });
            });

            req.write(payload);
            req.end();
        });
    }
}

const pathfinder = new DynamicPathfinder();
module.exports = pathfinder;
