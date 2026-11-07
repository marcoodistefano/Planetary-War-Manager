const redis = require('../../shared/redisClient.js');
const { getMatch, updateMatch } = require('../../shared/matchMonolithic.js');
const Eru = require('../middleware/Eru.js');
const { calculatePath, validateSeaCrossing, getNodeCoords, getRegionForNode, calculateCurrentPosition } = require('../middleware/movementLogic.js');
const { randomUUID } = require('crypto');
const { ArmyState, isArmyMoving, isArmyInCombat, setArmyState } = require('../middleware/armyState.js');

const COMMAND_CLAIM_TTL_SECONDS = 86400;

const ORDER_ERROR_CODES = Object.freeze({
    MATCH_NOT_FOUND: 'MATCH_NOT_FOUND',
    MATCH_NOT_STARTED: 'MATCH_NOT_STARTED',
    ARMY_NOT_FOUND: 'ARMY_NOT_FOUND',
    INVALID_ORIGIN: 'INVALID_ORIGIN',
    INVALID_DESTINATION: 'INVALID_DESTINATION',
    PATH_VALIDATION_FAILED: 'PATH_VALIDATION_FAILED',
    ALLY_TARGET: 'ALLY_TARGET',
    ARMY_RESUPPLY: 'ARMY_RESUPPLY',
    ORDER_NOT_APPLIED: 'ORDER_NOT_APPLIED'
});

function sendOrderError(ws, code, error) {
    return ws.send(JSON.stringify({ type: 'ERROR', code, error }));
}

async function claimMovementCommand(matchId, username, commandId) {
    const key = `match:${matchId}:command:${username}:${commandId}`;
    const claimed = await redis.set(key, JSON.stringify({ status: 'processing', commandId }), {
        NX: true,
        EX: COMMAND_CLAIM_TTL_SECONDS
    });
    return { key, claimed: claimed === 'OK' };
}

async function handlePreviewMissions(ws, payload) {
    const missions = payload.payload.missions;
    const matchData = await getMatch(ws.matchId);
    if (!matchData || !matchData.match || !matchData.match.player) return;
    const player = matchData.match.player.find(p => p.username === ws.username);
    if (!player || !player.armate) return;

    const results = [];
    for (const mission of missions) {
        const { armyId, targetName, targetCoords, waypoints } = mission;
        const armata = player.armate[armyId];
        if (!armata) continue;

        let startLng, startLat;
        let loc = armata.currentLocation;
        if (loc && typeof loc === 'string') {
            if (loc.includes(',')) {
                const pts = loc.split(',').map(s => parseFloat(s.trim()));
                if (pts.length === 2 && !isNaN(pts[0]) && !isNaN(pts[1])) { startLng = pts[0]; startLat = pts[1]; }
            } else {
                const nodeCoords = getNodeCoords(loc);
                if (nodeCoords) { startLng = nodeCoords[0]; startLat = nodeCoords[1]; }
            }
        } else if (loc && loc.x !== undefined && loc.y !== undefined) {
            startLng = loc.x; startLat = loc.y;
        } else if (Array.isArray(loc) && loc.length >= 2) {
            startLng = loc[0]; startLat = loc[1];
        }

        let currentPathInfo = null;
        if (isArmyMoving(armata) && armata.path && armata.path.length > 1 && armata.startTime && armata.etaMs) {
            const currentPos = calculateCurrentPosition(armata.path, armata.startTime, armata.etaMs);
            if (currentPos) {
                startLng = currentPos.lng;
                startLat = currentPos.lat;
                currentPathInfo = { path: armata.path, currentIndex: currentPos.currentIndex };
            }
        }

        let targetLng, targetLat;
        if (typeof targetCoords === 'string') {
            const pts = targetCoords.split(',').map(s => parseFloat(s.trim()));
            if (pts.length === 2 && !isNaN(pts[0]) && !isNaN(pts[1])) { targetLng = pts[0]; targetLat = pts[1]; }
        } else if (Array.isArray(targetCoords) && targetCoords.length === 2) {
            targetLng = parseFloat(targetCoords[0]); targetLat = parseFloat(targetCoords[1]);
        }
        if (targetLng === undefined && targetName) {
            const nodeCoords = getNodeCoords(targetName);
            if (nodeCoords) { targetLng = nodeCoords[0]; targetLat = nodeCoords[1]; }
        }

        if (startLng !== undefined && startLat !== undefined && targetLng !== undefined && targetLat !== undefined) {
            let matchMultiplier = 1;
            if (matchData.match.struttura_partita) {
                try {
                    const decodedMatch = Eru.decode_match(matchData.match.struttura_partita);
                    matchMultiplier = decodedMatch.multiplierValue || 1;
                } catch (err) {}
            }

            try {
                const pathInfo = await calculatePath(startLng, startLat, targetName, targetLng, targetLat, 1, currentPathInfo, matchMultiplier, player, waypoints || [], armata.composition || null);
                
                let isValid = true;
                let errorMessage = null;
                try {
                    await validateSeaCrossing(player, armata, loc, startLng, startLat, targetLng, targetLat, targetName, pathInfo.isValid);
                } catch (err) {
                    isValid = false;
                    errorMessage = err.message;
                }

                const targetRegionId = getRegionForNode(targetName) || targetName;
                const targetNation = matchData.match.player.find(n =>
                    n.username !== ws.username &&
                    n.isOccupied &&
                    n.territori_dict &&
                    Object.values(n.territori_dict).some(list => list.includes(targetRegionId))
                );
                const requiresWarDeclaration = Boolean(
                    targetNation && !targetNation.inWarWith?.includes(ws.username)
                );
                const warnings = [];
                if (!isValid) warnings.push('route_invalid');
                if (requiresWarDeclaration) warnings.push('war_declaration_required');

                results.push({
                    armyId,
                    path: pathInfo.path,
                    etaMs: pathInfo.etaMs,
                    distanceKm: pathInfo.distance,
                    routeType: pathInfo.routeType || 'automatic',
                    isValid: isValid,
                    error: errorMessage,
                    warnings,
                    requiresWarDeclaration,
                    arrivalCombat: {
                        possible: Boolean(targetNation || mission.mode === 'conquer')
                    },
                    originalMission: mission
                });
            } catch(e) {
                console.error("[PREVIEW_MISSIONS] Errore critico calcolo percorso:", e);
            }
        }
    }

    ws.send(JSON.stringify({ type: 'PATH_PREVIEW_RESULT', data: results }));
}

async function handleMoveTroops(ws, payload, userId) {
    const { armyId, targetName, targetCoords, waypoints, mode } = payload.payload;
    const commandId = payload.payload.commandId || randomUUID();
    const missionType = payload.payload.type || (mode === 'conquer' ? 'conquer' : 'move');

    const matchData = await getMatch(ws.matchId);
    if (!matchData || !matchData.match || !matchData.match.player) {
        return sendOrderError(ws, ORDER_ERROR_CODES.MATCH_NOT_FOUND, 'Partita non trovata');
    }

    if (!matchData.match.struttura_partita || !matchData.match.struttura_partita.startsWith('01')) {
        return sendOrderError(ws, ORDER_ERROR_CODES.MATCH_NOT_STARTED, 'La partita non è ancora iniziata.');
    }

    const player = matchData.match.player.find(p => p.username === ws.username);
    if (!player || !player.armate || !player.armate[armyId]) {
        return sendOrderError(ws, ORDER_ERROR_CODES.ARMY_NOT_FOUND, 'Armata non trovata');
    }

    const armata = player.armate[armyId];
    let startLng, startLat;
    let loc = armata.currentLocation;
    if (loc && typeof loc === 'string') {
        if (loc.includes(',')) {
            const pts = loc.split(',').map(s => parseFloat(s.trim()));
            if (pts.length === 2 && !isNaN(pts[0]) && !isNaN(pts[1])) { startLng = pts[0]; startLat = pts[1]; }
        } else {
            const nodeCoords = getNodeCoords(loc);
            if (nodeCoords) { startLng = nodeCoords[0]; startLat = nodeCoords[1]; }
        }
    } else if (loc && loc.x !== undefined && loc.y !== undefined) {
        startLng = loc.x; startLat = loc.y;
    } else if (Array.isArray(loc) && loc.length >= 2) {
        startLng = loc[0]; startLat = loc[1];
    }

    if (startLng === undefined || startLat === undefined) {
        return sendOrderError(ws, ORDER_ERROR_CODES.INVALID_ORIGIN, 'Coordinate di partenza invalide');
    }

    let currentPathInfo = null;
    if (isArmyMoving(armata) && armata.path && armata.path.length > 1 && armata.startTime && armata.etaMs) {
        const currentPos = calculateCurrentPosition(armata.path, armata.startTime, armata.etaMs);
        if (currentPos) {
            startLng = currentPos.lng;
            startLat = currentPos.lat;
            currentPathInfo = { path: armata.path, currentIndex: currentPos.currentIndex };
        }
    }

    let targetLng, targetLat;
    let parsedTargetCoords = null;
    if (typeof targetCoords === 'string') {
        const pts = targetCoords.split(',').map(s => parseFloat(s.trim()));
        if (pts.length === 2 && !isNaN(pts[0]) && !isNaN(pts[1])) {
            targetLng = pts[0]; targetLat = pts[1]; parsedTargetCoords = [targetLng, targetLat];
        }
    } else if (Array.isArray(targetCoords) && targetCoords.length === 2) {
        targetLng = parseFloat(targetCoords[0]); targetLat = parseFloat(targetCoords[1]); parsedTargetCoords = [targetLng, targetLat];
    }

    if (targetLng === undefined && targetName) {
        const nodeCoords = getNodeCoords(targetName);
        if (nodeCoords) { targetLng = nodeCoords[0]; targetLat = nodeCoords[1]; parsedTargetCoords = [targetLng, targetLat]; }
    }
    if (targetLng === undefined || targetLat === undefined) {
        return sendOrderError(ws, ORDER_ERROR_CODES.INVALID_DESTINATION, 'Coordinate di destinazione invalide');
    }

    let matchMultiplier = 1;
    if (matchData.match.struttura_partita) {
        try {
            const decodedMatch = Eru.decode_match(matchData.match.struttura_partita);
            matchMultiplier = decodedMatch.multiplierValue || 1;
        } catch (err) { }
    }

    let pathInfo = { isValid: false, distance: 0, etaMs: 0, path: [], cost: 0 };
    try {
        pathInfo = await calculatePath(startLng, startLat, targetName, targetLng, targetLat, 1, currentPathInfo, matchMultiplier, player, waypoints || [], armata.composition || null);
        await validateSeaCrossing(player, armata, loc, startLng, startLat, targetLng, targetLat, targetName, pathInfo.isValid);
    } catch (e) {
        console.error("Errore durante calculatePath o validazione:", e);
        return sendOrderError(ws, ORDER_ERROR_CODES.PATH_VALIDATION_FAILED, e.message || 'Errore validazione percorso');
    }

    const commandClaim = await claimMovementCommand(ws.matchId, ws.username, commandId);
    if (!commandClaim.claimed) {
        return ws.send(JSON.stringify({
            type: 'ORDER_DUPLICATE',
            data: { commandId, armyId }
        }));
    }

    let targetPlayerId = null;
    let isInWar = false;
    let isAttack = false;

    const updRes = await updateMatch(ws.matchId, async (matchObj) => {
        if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false };

        const regionId = getRegionForNode(targetName) || targetName;
        let targetNation = matchObj.match.player.find(n => n.territori_dict && Object.values(n.territori_dict).some(list => list.includes(regionId)));
        if (!targetNation && targetName !== regionId) {
            targetNation = matchObj.match.player.find(n => n.territori_dict && Object.values(n.territori_dict).some(list => list.includes(targetName)));
        }
        if (!targetNation) {
            targetNation = matchObj.match.player.find(n => n.territori && n.territori.includes(targetName));
        }
        if (targetNation && targetNation.isOccupied && targetNation.username && targetNation.username !== ws.username) {
            const movingPlayer = matchObj.match.player.find(n => n.username === ws.username);
            const movingAllianceId = movingPlayer ? movingPlayer.id_alleanza : null;
            const defenderAllianceId = targetNation.id_alleanza || null;
            const isAlly = movingAllianceId && defenderAllianceId && String(movingAllianceId) === String(defenderAllianceId);

            if (isAlly) {
                return { save: false, data: { code: ORDER_ERROR_CODES.ALLY_TARGET, error: 'Non puoi attaccare un membro della tua alleanza!' } };
            }

            isAttack = true;
            targetPlayerId = targetNation.username;
            isInWar = targetNation.inWarWith && targetNation.inWarWith.includes(ws.username);
        }

        if (!isAttack && mode === 'conquer') {
            for (const n of matchObj.match.player) {
                if (n.username === ws.username) continue;
                if (n.armate && n.armate[targetName]) {
                    const movingPlayer = matchObj.match.player.find(x => x.username === ws.username);
                    const movingAllianceId = movingPlayer ? movingPlayer.id_alleanza : null;
                    const defAllianceId = n.id_alleanza || null;
                    if (movingAllianceId && defAllianceId && String(movingAllianceId) === String(defAllianceId)) {
                        return { save: false, data: { code: ORDER_ERROR_CODES.ALLY_TARGET, error: 'Non puoi attaccare un membro della tua alleanza!' } };
                    }
                    isAttack = true;
                    targetPlayerId = n.username;
                    isInWar = n.inWarWith && n.inWarWith.includes(ws.username);
                    break;
                }
            }
        }

        let warBroadcast = null;
        if (isAttack && !isInWar) {
            const attackerNation = matchObj.match.player.find(n => n.username === ws.username);
            const defenderNation = matchObj.match.player.find(n => n.username === targetPlayerId);
            if (attackerNation && defenderNation) {
                attackerNation.inWarWith = attackerNation.inWarWith || [];
                if (!attackerNation.inWarWith.includes(targetPlayerId)) attackerNation.inWarWith.push(targetPlayerId);
                defenderNation.inWarWith = defenderNation.inWarWith || [];
                if (!defenderNation.inWarWith.includes(ws.username)) defenderNation.inWarWith.push(ws.username);

                warBroadcast = {
                    matchId: ws.matchId,
                    payload: {
                        type: 'WAR_DECLARED',
                        data: { attacker: ws.username, defender: targetPlayerId },
                        nations: matchObj.match.player
                    }
                };
            }
        }

        const p = matchObj.match.player.find(n => n.username === ws.username);
        if (!p || !p.armate || !p.armate[armyId]) return { save: false };

        if (p.armate[armyId].cooldownUntil && Date.now() < p.armate[armyId].cooldownUntil) {
            return { save: false, data: { code: ORDER_ERROR_CODES.ARMY_RESUPPLY, error: 'L\'armata è in fase di rifornimento e non può decollare.' } };
        }

        p.armate[armyId].startingLocation = `${startLng},${startLat}`;
        p.armate[armyId].currentLocation = `${startLng},${startLat}`;
        p.armate[armyId].status = (isAttack || (isAttack && pathInfo.path.length > 0)) ? "Pronto alla conquista" : "moving";
        setArmyState(p.armate[armyId], ArmyState.MOVING);
        p.armate[armyId].targetCoords = parsedTargetCoords || targetCoords;
        p.armate[armyId].targetName = targetName;
        p.armate[armyId].missionMode = mode;
        p.armate[armyId].path = pathInfo.path;
        p.armate[armyId].waypoints = waypoints || [];
        p.armate[armyId].startTime = Date.now();
        p.armate[armyId].etaMs = pathInfo.etaMs;

        return { save: true, matchObj, data: { armata: p.armate[armyId], warBroadcast } };
    });

    if (updRes && updRes.warBroadcast) {
        await redis.publish('match_ws_broadcast_channel', JSON.stringify(updRes.warBroadcast));
    }

    if (updRes && (updRes.error || (updRes.data && updRes.data.error))) {
        await redis.del(commandClaim.key);
        const errMessage = updRes.error || updRes.data.error;
        const errorCode = updRes.code || updRes.data.code || ORDER_ERROR_CODES.ORDER_NOT_APPLIED;
        return sendOrderError(ws, errorCode, errMessage);
    }

    if (!updRes || !updRes.data || !updRes.data.armata) {
        await redis.del(commandClaim.key);
        return ws.send(JSON.stringify({
            type: 'ERROR',
            code: ORDER_ERROR_CODES.ORDER_NOT_APPLIED,
            error: 'Ordine non applicato. Riprova.'
        }));
    }

    if (updRes && updRes.data && updRes.data.armata) {
        const armataObj = updRes.data.armata;

        ws.send(JSON.stringify({
            type: 'ORDER_ACCEPTED',
            data: {
                commandId,
                armyId,
                type: missionType,
                status: 'accepted'
            }
        }));

        // Redis is the source of truth, SQL is handled by snapshotEngine.
        const broadcastPayload = {
            matchId: ws.matchId,
            payload: {
                type: 'TROOPS_MOVED',
                data: {
                    commandId,
                    userId,
                    armyId,
                    state: armataObj.state,
                    type: missionType,
                    targetName,
                    targetCoords,
                    etaMs: pathInfo.etaMs,
                    path: pathInfo.path,
                    startTime: armataObj.startTime,
                    mode: mode
                }
            }
        };
        await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
    }
}

async function handleCancelMission(ws, payload, userId) {
    const { armyId } = payload.payload;

    const updRes = await updateMatch(ws.matchId, async (matchObj) => {
        if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false };
        const player = matchObj.match.player.find(p => p.username === ws.username);
        if (!player || !player.armate || !player.armate[armyId]) return { save: false };

        const army = player.armate[armyId];

        if (isArmyInCombat(army)) {
            army.status = 'standby';
            setArmyState(army, ArmyState.STANDBY);
            delete army.targetName; delete army.targetCoords; delete army.missionMode; delete army.next_round_time;
            return { save: true, matchObj, data: { action: 'combat_cancelled', army } };
        } else if (isArmyMoving(army)) {
            const now = Date.now();
            let elapsed = 0; let returnPath = []; let currentLng, currentLat;
            if (army.path && army.path.length > 1 && army.startTime && army.etaMs) {
                const currentPos = calculateCurrentPosition(army.path, army.startTime, army.etaMs);
                if (currentPos) {
                    currentLng = currentPos.lng;
                    currentLat = currentPos.lat;
                    elapsed = currentPos.elapsed;
                    returnPath.push([currentLng, currentLat]);
                    for (let i = currentPos.currentIndex; i >= 0; i--) {
                        returnPath.push(army.path[i]);
                    }
                }
            } else {
                army.status = 'standby';
                setArmyState(army, ArmyState.STANDBY);
                delete army.path; delete army.startTime; delete army.etaMs; delete army.targetCoords; delete army.targetName; delete army.missionMode;
                return { save: true, matchObj, data: { action: 'aborted', army } };
            }
            const returnEtaMs = Math.floor(elapsed);
            army.currentLocation = `${currentLng},${currentLat}`; army.path = returnPath; army.startTime = now; army.etaMs = returnEtaMs;
            army.targetCoords = returnPath[returnPath.length - 1]; army.targetName = "Ritorno"; army.status = 'moving';
            setArmyState(army, ArmyState.RETURNING);
            return { save: true, matchObj, data: { action: 'returning', army, now, returnEtaMs } };
        }
        return { save: false };
    });

    if (updRes && updRes.data) {
        if (updRes.data.action === 'combat_cancelled') {
            ws.send(JSON.stringify({ type: 'MISSION_CANCELLED', payload: { armyId, newLocation: updRes.data.army.currentLocation } }));
            const broadcastPayload = { matchId: ws.matchId, payload: { type: 'COMBAT_CANCELLED', data: { userId: ws.username, armyId: armyId } } };
            await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
        } else if (updRes.data.action === 'aborted') {
            ws.send(JSON.stringify({ type: 'MISSION_CANCELLED', payload: { armyId, newLocation: updRes.data.army.currentLocation } }));
        } else if (updRes.data.action === 'returning') {
            const { army, now, returnEtaMs } = updRes.data;
            const broadcastPayload = { matchId: ws.matchId, payload: { type: 'TROOPS_MOVED', data: { userId, armyId, targetName: army.targetName, targetCoords: army.targetCoords, etaMs: returnEtaMs, path: army.path, startTime: now, mode: 'move' } } };
            await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));
        }
    }
}

module.exports = { handlePreviewMissions, handleMoveTroops, handleCancelMission };
