// workers/wsDispatcher.js
const redisClient = require("../../shared/redisClient");

// Creiamo una connessione Redis separata ESCLUSIVAMENTE per ascoltare.
// In Redis, quando un client è in modalità "SUBSCRIBE", non può fare altre query.
const subscriber = redisClient.duplicate();

const initDispatcher = async (clientSockets) => {
    if (!clientSockets) {
        throw new Error("clientSockets non inizializzato");
    }
    await subscriber.connect();

    // Ci iscriviamo al canale dove il Controller/Model pubblica i nuovi messaggi
    await subscriber.subscribe("ws_broadcast_channel", (messageStr) => {
        try {
            console.log(`[WS_DISPATCHER] Ricevuto evento da Redis:`, messageStr);
            const event = JSON.parse(messageStr);
            
            // event.targetUsers è un array di ID (es. i due giocatori di una 1v1, o l'intera alleanza)
            const { matchId, targetUsers, payload } = event;

            // Iteriamo sugli utenti che devono ricevere il messaggio
            targetUsers.forEach(userId => {
                // Cerchiamo l'utente nella RAM del nostro server
                const userTunnels = clientSockets.get(userId);

                if (userTunnels) {
                    console.log(`[WS_DISPATCHER] Trovato tunnel per utente ${userId}, match ${matchId}`);
                    // Se l'utente è connesso (magari anche con più tab aperti), spariamo il payload
                    userTunnels.forEach(ws => {
                        // Verifica hardware: il socket è ancora aperto a livello TCP?
                        if (ws.readyState === 1 && (!matchId || ws.matchId === matchId)) { // 1 = OPEN
                            ws.send(JSON.stringify(payload));
                        }
                    });
                }
            });

        } catch (error) {
            console.error("[SYS_ERR] Cortocircuito nel WS Dispatcher:", error);
        }
    });

    console.log("[SYSTEM] WebSocket Dispatcher in ascolto sul bus Redis.");
};

module.exports = { initDispatcher };