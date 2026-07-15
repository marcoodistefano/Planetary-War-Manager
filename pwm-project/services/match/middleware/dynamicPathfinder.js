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
                                // Vecchio formato array — non ha isValid, assumiamo invalido
                                resolve({ path: resJson, cost: 0, isValid: false });
                            } else {
                                resolve(resJson); // { path: [...], cost: ..., isValid: bool }
                            }
                        } catch (err) {
                            console.error("[PATHFINDER] Errore parsing risposta dal servizio Go:", err);
                            resolve({ path: [[startLng, startLat], [endLng, endLat]], cost: 0, isValid: false });
                        }
                    } else {
                        console.error(`[PATHFINDER] Errore servizio Go. StatusCode: ${res.statusCode}`);
                        resolve({ path: [[startLng, startLat], [endLng, endLat]], cost: 0, isValid: false });
                    }
                });
            });

            req.on('error', (e) => {
                console.error(`[PATHFINDER] Connessione al servizio Go fallita: ${e.message}`);
                resolve({ path: [[startLng, startLat], [endLng, endLat]], cost: 0, isValid: false });
            });

            req.write(payload);
            req.end();
        });
    }
}

const pathfinder = new DynamicPathfinder();
module.exports = pathfinder;
