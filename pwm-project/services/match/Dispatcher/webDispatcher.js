const redisClient = require("../../shared/redisClient");

const subscriber = redisClient.duplicate();

const initDispatcher = async (clientSockets) => {
    if (!clientSockets) {
        throw new Error("clientSockets non inizializzato");
    }
    await subscriber.connect();

    await subscriber.subscribe("match_ws_broadcast_channel", (messageStr) => {
        try {
            console.log(`[WS_DISPATCHER] Ricevuto evento da Redis:`, messageStr);
            const event = JSON.parse(messageStr);
            
            const { matchId, targetUsers, payload } = event;

            if (targetUsers && Array.isArray(targetUsers)) {
                // Invio selettivo a specifici utenti
                targetUsers.forEach(userId => {
                    const userTunnels = clientSockets.get(userId);
                    if (userTunnels) {
                        userTunnels.forEach(ws => {
                            if (ws.readyState === 1 && (!matchId || ws.matchId === matchId)) {
                                ws.send(JSON.stringify(payload));
                            }
                        });
                    }
                });
            } else if (matchId) {
                // Broadcast a tutti i partecipanti di una determinata partita
                for (const [userId, userTunnels] of clientSockets.entries()) {
                    userTunnels.forEach(ws => {
                        if (ws.readyState === 1 && ws.matchId === matchId) {
                            ws.send(JSON.stringify(payload));
                        }
                    });
                }
            } else {
                console.warn("[WS_DISPATCHER] Evento senza targetUsers né matchId ignorato.");
            }

        } catch (error) {
            console.error("[SYS_ERR] Cortocircuito nel WS Dispatcher:", error);
        }
    });

    console.log("[SYSTEM] WebSocket Dispatcher in ascolto sul bus Redis (match_ws_broadcast_channel).");
};

module.exports = { initDispatcher };
