const redis = require('../../shared/redisClient.js');
const { updateMatch } = require('../../shared/matchMonolithic.js');
const { ArmyState } = require('../middleware/armyState.js');
const { randomUUID } = require('crypto');

async function handleCreateArmy(ws, payload, userId) {
    const { troopKey, troopCount, composition, targetName, targetCoords, armyName, armyId } = payload.payload;

    const requestedComposition = composition && typeof composition === 'object'
        ? composition
        : { [troopKey]: troopCount };
    const normalizedComposition = Object.fromEntries(
        Object.entries(requestedComposition)
            .map(([key, count]) => [String(key).trim(), Math.floor(Number(count))])
            .filter(([key, count]) => key && count > 0)
    );

    try {
        const updRes = await updateMatch(ws.matchId, async (matchObj) => {
            if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false, data: { error: 'Partita non trovata' } };

            const player = matchObj.match.player.find(p => p.username === ws.username);
            if (!player) return { save: false, data: { error: 'Giocatore non trovato' } };

            if (Object.keys(normalizedComposition).length === 0) {
                return { save: false, data: { code: 'INVALID_COMPOSITION', error: 'La composizione dell\'armata è vuota.' } };
            }

            for (const [unitKey, unitCount] of Object.entries(normalizedComposition)) {
                if (!player.truppe || !player.truppe[unitKey] || player.truppe[unitKey] < unitCount) {
                    return { save: false, data: { code: 'INSUFFICIENT_RESERVES', error: `Truppe insufficienti nelle riserve per ${unitKey}.` } };
                }
            }

            for (const [unitKey, unitCount] of Object.entries(normalizedComposition)) {
                player.truppe[unitKey] -= unitCount;
                if (player.truppe[unitKey] <= 0) delete player.truppe[unitKey];
            }

            if (!player.armate) player.armate = {};
            
            const newArmy = {
                id: armyId,
                name: armyName || `Armata`,
                composition: normalizedComposition,
                status: 'standby',
                state: ArmyState.STANDBY,
                currentLocation: targetName || targetCoords,
                owner: ws.username
            };
            
            player.armate[armyId] = newArmy;

            return { save: true, matchObj, data: { success: true, armate: player.armate, truppe: player.truppe } };
        });

        const errorMessage = updRes?.error || updRes?.data?.error;
        if (errorMessage) {
            return ws.send(JSON.stringify({
                type: 'ERROR',
                code: updRes?.code || updRes?.data?.code || 'CREATE_ARMY_FAILED',
                error: errorMessage
            }));
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

async function handleSplitArmy(ws, payload) {
    const { armyId, newArmyName } = payload.payload;

    try {
        const updRes = await updateMatch(ws.matchId, async (matchObj) => {
            const player = matchObj?.match?.player?.find(p => p.username === ws.username);
            const army = player?.armate?.[armyId];
            if (!player || !army) return { save: false, data: { code: 'ARMY_NOT_FOUND', error: 'Armata non trovata.' } };
            if (army.status !== 'standby' && army.state !== ArmyState.STANDBY) {
                return { save: false, data: { code: 'ARMY_NOT_STANDBY', error: 'Puoi dividere solo un armata in standby.' } };
            }

            const splitComposition = {};
            const remainingComposition = {};
            for (const [unitKey, rawCount] of Object.entries(army.composition || {})) {
                const count = Math.floor(Number(rawCount) || 0);
                const splitCount = Math.floor(count / 2);
                if (splitCount > 0) splitComposition[unitKey] = splitCount;
                if (count - splitCount > 0) remainingComposition[unitKey] = count - splitCount;
            }

            if (Object.keys(splitComposition).length === 0 || Object.keys(remainingComposition).length === 0) {
                return { save: false, data: { code: 'ARMY_TOO_SMALL', error: 'L armata non contiene abbastanza unita per essere divisa.' } };
            }

            const newArmyId = randomUUID();
            army.composition = remainingComposition;
            player.armate[newArmyId] = {
                ...army,
                id: newArmyId,
                name: newArmyName || `${army.name || 'Armata'} - Distaccamento`,
                composition: splitComposition,
                state: ArmyState.STANDBY,
                status: 'standby'
            };

            return { save: true, matchObj, data: { success: true, armate: player.armate, truppe: player.truppe } };
        });

        const errorMessage = updRes?.error || updRes?.data?.error;
        if (errorMessage) {
            return ws.send(JSON.stringify({ type: 'ERROR', code: updRes?.data?.code || 'SPLIT_ARMY_FAILED', error: errorMessage }));
        }
        if (updRes?.success) {
            ws.send(JSON.stringify({ type: 'ARMY_UPDATED', payload: { armate: Object.values(updRes.armate || {}), truppe: updRes.truppe } }));
        }
    } catch (error) {
        console.error('[SYS_ERR] Errore in SPLIT_ARMY:', error);
        ws.send(JSON.stringify({ type: 'ERROR', code: 'SPLIT_ARMY_FAILED', error: 'Errore durante la divisione dell armata.' }));
    }
}

async function handleMergeArmies(ws, payload) {
    const { sourceArmyId, targetArmyId, targetName } = payload.payload;

    try {
        const updRes = await updateMatch(ws.matchId, async (matchObj) => {
            const player = matchObj?.match?.player?.find(p => p.username === ws.username);
            const sourceArmy = player?.armate?.[sourceArmyId];
            const targetArmy = player?.armate?.[targetArmyId];
            if (!player || !sourceArmy || !targetArmy) return { save: false, data: { code: 'ARMY_NOT_FOUND', error: 'Una delle armate selezionate non esiste.' } };
            if (sourceArmyId === targetArmyId) return { save: false, data: { code: 'SAME_ARMY', error: 'Seleziona due armate diverse.' } };
            if (![sourceArmy, targetArmy].every(army => army.status === 'standby' || army.state === ArmyState.STANDBY)) {
                return { save: false, data: { code: 'ARMY_NOT_STANDBY', error: 'Puoi fondere solo armate in standby.' } };
            }
            if (String(sourceArmy.currentLocation) !== String(targetArmy.currentLocation)) {
                return { save: false, data: { code: 'ARMY_DIFFERENT_LOCATIONS', error: 'Le armate devono trovarsi nella stessa posizione.' } };
            }

            for (const [unitKey, count] of Object.entries(sourceArmy.composition || {})) {
                targetArmy.composition[unitKey] = (targetArmy.composition[unitKey] || 0) + Number(count || 0);
            }
            if (targetName) targetArmy.name = targetName;
            delete player.armate[sourceArmyId];

            return { save: true, matchObj, data: { success: true, armate: player.armate, truppe: player.truppe } };
        });

        const errorMessage = updRes?.error || updRes?.data?.error;
        if (errorMessage) {
            return ws.send(JSON.stringify({ type: 'ERROR', code: updRes?.data?.code || 'MERGE_ARMIES_FAILED', error: errorMessage }));
        }
        if (updRes?.success) {
            ws.send(JSON.stringify({ type: 'ARMY_UPDATED', payload: { armate: Object.values(updRes.armate || {}), truppe: updRes.truppe } }));
        }
    } catch (error) {
        console.error('[SYS_ERR] Errore in MERGE_ARMIES:', error);
        ws.send(JSON.stringify({ type: 'ERROR', code: 'MERGE_ARMIES_FAILED', error: 'Errore durante la fusione delle armate.' }));
    }
}

async function handleReinforceArmy(ws, payload) {
    const { armyId, composition } = payload.payload;
    const normalizedComposition = Object.fromEntries(
        Object.entries(composition || {})
            .map(([key, count]) => [String(key).trim(), Math.floor(Number(count))])
            .filter(([key, count]) => key && count > 0)
    );

    try {
        const updRes = await updateMatch(ws.matchId, async (matchObj) => {
            const player = matchObj?.match?.player?.find(p => p.username === ws.username);
            const army = player?.armate?.[armyId];
            if (!player || !army) return { save: false, data: { code: 'ARMY_NOT_FOUND', error: 'Armata non trovata.' } };
            if (army.status !== 'standby' && army.state !== ArmyState.STANDBY) {
                return { save: false, data: { code: 'ARMY_NOT_STANDBY', error: 'Puoi rinforzare solo un armata in standby.' } };
            }
            if (Object.keys(normalizedComposition).length === 0) {
                return { save: false, data: { code: 'INVALID_COMPOSITION', error: 'Seleziona almeno una unita da aggiungere.' } };
            }

            for (const [unitKey, unitCount] of Object.entries(normalizedComposition)) {
                if (!player.truppe?.[unitKey] || player.truppe[unitKey] < unitCount) {
                    return { save: false, data: { code: 'INSUFFICIENT_RESERVES', error: `Truppe insufficienti nelle riserve per ${unitKey}.` } };
                }
            }

            for (const [unitKey, unitCount] of Object.entries(normalizedComposition)) {
                player.truppe[unitKey] -= unitCount;
                if (player.truppe[unitKey] <= 0) delete player.truppe[unitKey];
                army.composition[unitKey] = (army.composition[unitKey] || 0) + unitCount;
            }

            return { save: true, matchObj, data: { success: true, armate: player.armate, truppe: player.truppe } };
        });

        const errorMessage = updRes?.error || updRes?.data?.error;
        if (errorMessage) {
            return ws.send(JSON.stringify({ type: 'ERROR', code: updRes?.data?.code || 'REINFORCE_ARMY_FAILED', error: errorMessage }));
        }
        if (updRes?.success) {
            ws.send(JSON.stringify({ type: 'ARMY_UPDATED', payload: { armate: Object.values(updRes.armate || {}), truppe: updRes.truppe } }));
        }
    } catch (error) {
        console.error('[SYS_ERR] Errore in REINFORCE_ARMY:', error);
        ws.send(JSON.stringify({ type: 'ERROR', code: 'REINFORCE_ARMY_FAILED', error: 'Errore durante il rinforzo dell armata.' }));
    }
}

module.exports = { handleCreateArmy, handleDisbandArmy, handleSplitArmy, handleMergeArmies, handleReinforceArmy };
