const http = require('http');

class DynamicPathfinder {
    constructor() {
        const url = process.env.PATHFINDING_SERVICE_URL || 'http://pathfinding-service:8090/api/calculate';
        const parsed = new URL(url);
        this.goServiceHost = parsed.hostname;
        this.goServicePort = parsed.port;
        this.calculatePath = parsed.pathname;
        this.nearestWaterPath = '/api/nearest-water';
    }

    async findPath(startLng, startLat, endLng, endLat, multiplier = 1.0, mode = 'land') {
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify({
                startX: startLng,
                startY: startLat,
                targetX: endLng,
                targetY: endLat,
                multiplier: multiplier,
                mode: mode
            });

            const options = {
                hostname: this.goServiceHost,
                port: this.goServicePort,
                path: this.calculatePath,
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

    async findNearestWater(lng, lat) {
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify({
                x: lng,
                y: lat
            });

            const options = {
                hostname: this.goServiceHost,
                port: this.goServicePort,
                path: this.nearestWaterPath,
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
                            resolve({ lng: resJson.x, lat: resJson.y });
                        } catch (err) {
                            console.error("[PATHFINDER] Errore parsing risposta nearest-water:", err);
                            resolve({ lng, lat });
                        }
                    } else {
                        console.error(`[PATHFINDER] Errore nearest-water. StatusCode: ${res.statusCode}`);
                        resolve({ lng, lat });
                    }
                });
            });

            req.on('error', (e) => {
                console.error(`[PATHFINDER] Connessione a nearest-water fallita: ${e.message}`);
                resolve({ lng, lat });
            });

            req.write(payload);
            req.end();
        });
    }

    async findNearestLand(lng, lat) {
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify({ x: lng, y: lat });
            const options = {
                hostname: this.goServiceHost,
                port: this.goServicePort,
                path: '/api/nearest-land',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            };
            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const resJson = JSON.parse(data);
                            resolve({ lng: resJson.x, lat: resJson.y });
                        } catch (err) {
                            console.error("[PATHFINDER] Errore parsing risposta nearest-land:", err);
                            resolve({ lng, lat });
                        }
                    } else {
                        console.error(`[PATHFINDER] Errore nearest-land. StatusCode: ${res.statusCode}`);
                        resolve({ lng, lat });
                    }
                });
            });
            req.on('error', (e) => {
                console.error(`[PATHFINDER] Connessione a nearest-land fallita: ${e.message}`);
                resolve({ lng, lat });
            });
            req.write(payload);
            req.end();
        });
    }
}

const pathfinder = new DynamicPathfinder();
module.exports = pathfinder;
