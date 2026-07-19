const redis = require('../../shared/redisClient.js');
const { updateMatch } = require('../../shared/matchMonolithic.js');

async function handleCreateArmy(ws, payload, userId) {
    const { troopKey, troopCount, targetName, targetCoords, armyName, armyId } = payload.payload;

    try {
        const updRes = await updateMatch(ws.matchId, async (matchObj) => {
            if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false, data: { error: 'Partita non trovata' } };

            const player = matchObj.match.player.find(p => p.username === ws.username);
            if (!player) return { save: false, data: { error: 'Giocatore non trovato' } };

            if (!player.truppe || !player.truppe[troopKey] || player.truppe[troopKey] < troopCount) {
                return { save: false, data: { error: 'Truppe insufficienti nelle riserve.' } };
            }

            player.truppe[troopKey] -= troopCount;
            if (player.truppe[troopKey] <= 0) {
                delete player.truppe[troopKey];
            }

            if (!player.armate) player.armate = {};
            
            const newArmy = {
                id: armyId,
                name: armyName || `Armata`,
                composition: { [troopKey]: troopCount },
                status: 'standby',
                currentLocation: targetName || targetCoords,
                owner: ws.username
            };
            
            player.armate[armyId] = newArmy;

            return { save: true, matchObj, data: { success: true, armate: player.armate, truppe: player.truppe } };
        });

        if (updRes && updRes.error) {
            return ws.send(JSON.stringify({ type: 'ERROR', error: updRes.error }));
        }

        if (updRes && updRes.success) {
            ws.send(JSON.stringify({
                type: 'ARMY_UPDATED',
                payload: { armate: Object.values(updRes.armate || {}), truppe: updRes.truppe }
            }));
        }
    } catch (e) {
        console.error("[SYS_ERR] Errore in CREATE_ARMY:", e);
        ws.send(JSON.stringify({ type: 'ERROR', error: 'Errore interno durante la creazione dell\'armata' }));
    }
}

async function handleDisbandArmy(ws, payload, userId) {
    const { armyId } = payload.payload;

    try {
        const updRes = await updateMatch(ws.matchId, async (matchObj) => {
            if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false, data: { error: 'Partita non trovata' } };

            const player = matchObj.match.player.find(p => p.username === ws.username);
            if (!player) return { save: false, data: { error: 'Giocatore non trovato' } };

            if (!player.armate || !player.armate[armyId]) {
                return { save: false, data: { error: 'Armata non trovata.' } };
            }

            const army = player.armate[armyId];
            if (army.status !== 'standby') {
                return { save: false, data: { error: 'Non puoi sciogliere un\'armata che non è in standby.' } };
            }

            if (!player.truppe) player.truppe = {};

            Object.entries(army.composition).forEach(([troopKey, count]) => {
                player.truppe[troopKey] = (player.truppe[troopKey] || 0) + Number(count);
            });

            delete player.armate[armyId];

            return { save: true, matchObj, data: { success: true, armate: player.armate, truppe: player.truppe } };
        });

        if (updRes && updRes.error) {
            return ws.send(JSON.stringify({ type: 'ERROR', error: updRes.error }));
        }

        if (updRes && updRes.success) {
            ws.send(JSON.stringify({
                type: 'ARMY_UPDATED',
                payload: { armate: Object.values(updRes.armate || {}), truppe: updRes.truppe }
            }));
            
            // Per il combattimento che potrebbe targettare quest'armata
            const broadcastPayload = { matchId: ws.matchId, payload: { type: 'ARMY_DISBANDED', data: { armyId: armyId, owner: ws.username } } };
            await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
        }
    } catch (e) {
        console.error("[SYS_ERR] Errore in DISBAND_ARMY:", e);
        ws.send(JSON.stringify({ type: 'ERROR', error: 'Errore interno durante lo scioglimento dell\'armata' }));
    }
}

module.exports = { handleCreateArmy, handleDisbandArmy };
