const redis = require('../../shared/redisClient.js');
const { updateMatch } = require('../../shared/matchMonolithic.js');
const Eru = require('../middleware/Eru.js');
const { getRegionIdByName } = require('../middleware/movementLogic.js');
const { getGameRulesCached, translateRedisToFe } = require('./recruit.handler.js');

async function handleResearchTech(ws, payload) {
    const { structureId } = payload;
    try {
        const rules = await getGameRulesCached(redis);
        let structureDetails = null;
        if (rules) {
            const estrattoriSheet = rules.sheets.find(s => s.name === "Estrattori");
            const struttureSheet = rules.sheets.find(s => s.name === "Strutture");
            const estrattoriLines = estrattoriSheet ? estrattoriSheet.lines : [];
            const struttureLines = struttureSheet ? struttureSheet.lines : [];
            structureDetails = estrattoriLines.find(l => l.id_extractor === structureId) || struttureLines.find(l => l.id_struttura === structureId);
        }
        if (!structureDetails) {
            return ws.send(JSON.stringify({ type: 'ERROR', error: 'Tecnologia sconosciuta' }));
        }
        
        const reqPrevStructure = structureDetails.richiede_struttura || structureDetails.richiede_estrattore;
        const tier = structureDetails.tier || 1;
        if (tier === 1) {
            return ws.send(JSON.stringify({ type: 'ERROR', error: 'Le tecnologie di livello 1 sono già sbloccate di default' }));
        }
        
        const updRes = await updateMatch(ws.matchId, async (matchObj) => {
            if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false, data: { error: 'Partita non trovata' } };
            
            const player = matchObj.match.player.find(p => p.username === ws.username);
            if (!player) return { save: false, data: { error: 'Giocatore non trovato' } };
            
            player.technologies = player.technologies || [];
            
            if (player.technologies.includes(structureId)) {
                return { save: false, data: { error: 'Tecnologia già ricercata' } };
            }
            
            if (tier > 2 && reqPrevStructure && !player.technologies.includes(reqPrevStructure)) {
                return { save: false, data: { error: `Devi prima ricercare ${reqPrevStructure}` } };
            }
            const reqDenaro = structureDetails.costo_denaro || 0;
            const reqLegno = structureDetails.costo_legno || 0;
            const reqMattoni = structureDetails.costo_mattoni || 0;
            const reqAcciaio = structureDetails.costo_acciaio || 0;
            const reqPetrolio = structureDetails.costo_petrolio || 0;
            const reqPiombo = (structureDetails.costo_piombo || structureDetails.costo_piombio) || 0;
            const reqGas = structureDetails.costo_gas || 0;
            const reqUranio = structureDetails.costo_uranio || 0;
            const reqOro = structureDetails.costo_oro || 0;

            if (
                (player.risorse.denaro || 0) < reqDenaro ||
                (player.risorse.legno || 0) < reqLegno ||
                (player.risorse.mattone || 0) < reqMattoni ||
                (player.risorse.acciaio || 0) < reqAcciaio ||
                (player.risorse.petrolio || 0) < reqPetrolio ||
                (player.risorse.piombo || 0) < reqPiombo ||
                (player.risorse.gas || 0) < reqGas ||
                (player.risorse.uranio || 0) < reqUranio ||
                (player.risorse.oro || 0) < reqOro
            ) {
                return { save: false, data: { error: 'Risorse insufficienti per la ricerca' } };
            }

            player.risorse.denaro -= reqDenaro;
            player.risorse.legno -= reqLegno;
            player.risorse.mattone -= reqMattoni;
            player.risorse.acciaio -= reqAcciaio;
            player.risorse.petrolio -= reqPetrolio;
            player.risorse.piombo -= reqPiombo;
            player.risorse.gas -= reqGas;
            player.risorse.uranio -= reqUranio;
            player.risorse.oro -= reqOro;

            player.technologies.push(structureId);

            return { save: true, matchObj, data: { success: true, technologies: player.technologies, risorse: player.risorse } };
        });
        
        if (updRes && updRes.error) {
            ws.send(JSON.stringify({ type: 'ERROR', error: updRes.error }));
        } else if (updRes && updRes.success) {
            ws.send(JSON.stringify({
                type: 'RESEARCH_SUCCESS',
                payload: { structureId, technologies: updRes.technologies, risorse: translateRedisToFe(updRes.risorse) }
            }));
            ws.send(JSON.stringify({
                type: 'RESOURCES_UPDATED',
                data: {
                    resources: translateRedisToFe(updRes.risorse),
                    technologies: updRes.technologies
                }
            }));
        }
    } catch (e) {
        console.error("[SYS_ERR] Errore in RESEARCH_TECH:", e);
        ws.send(JSON.stringify({ type: 'ERROR', error: 'Errore interno del server durante la ricerca' }));
    }
}

async function handleBuildStructure(ws, payload, userId) {
    console.log(`[WS_MATCH] Richiesta costruzione struttura ricevuta:`, payload);
    const { structureId, targetName, targetCoords } = payload;

    try {
        const rules = await getGameRulesCached(redis);
        let structureDetails = null;
        if (rules) {
            const estrattoriSheet = rules.sheets.find(s => s.name === "Estrattori");
            const struttureSheet = rules.sheets.find(s => s.name === "Strutture");
            const estrattoriLines = estrattoriSheet ? estrattoriSheet.lines : [];
            const struttureLines = struttureSheet ? struttureSheet.lines : [];
            structureDetails = estrattoriLines.find(l => l.id_extractor === structureId) || struttureLines.find(l => l.id_struttura === structureId);
        }
        if (!structureDetails) {
            return ws.send(JSON.stringify({ type: 'ERROR', error: 'Struttura sconosciuta' }));
        }

        const reqDenaro = structureDetails.costo_denaro || 0;
        const reqLegno = structureDetails.costo_legno || 0;
        const reqMattone = structureDetails.costo_mattoni || 0;
        const reqAcciaio = structureDetails.costo_acciaio || 0;
        const reqPiombo = structureDetails.costo_piombio || structureDetails.costo_piombo || 0;
        const reqPetrolio = structureDetails.costo_petrolio || 0;
        const baseName = structureId.split('_t')[0];
        const reqPrevStructure = structureDetails.richiede_struttura || structureDetails.richiede_estrattore;

        const regionId = getRegionIdByName(targetName);

        const actualMatchId = ws.matchId;
        const regionsResourcesStr = await redis.get(`match:${actualMatchId}:regions_resources`);
        const regionsResources = regionsResourcesStr ? JSON.parse(regionsResourcesStr) : {};
        const myRegionRes = regionsResources[regionId];

        if (structureDetails.risorsa_estratta && myRegionRes) {
            if (myRegionRes.more_common !== structureDetails.risorsa_estratta && myRegionRes.less_common !== structureDetails.risorsa_estratta) {
                return ws.send(JSON.stringify({ type: 'ERROR', error: `In questo territorio non vi sono giacimenti di ${structureDetails.risorsa_estratta}.` }));
            }
        }

        const updRes = await updateMatch(ws.matchId, async (matchObj) => {
            if (!matchObj || !matchObj.match || !matchObj.match.player) return { save: false, data: { error: 'Partita non trovata' } };
            if (!matchObj.match.struttura_partita || !matchObj.match.struttura_partita.startsWith('01')) {
                return { save: false, data: { error: 'Costruzione non permessa: Partita non attiva' } };
            }

            const player = matchObj.match.player.find(p => p.username === ws.username);
            if (!player || (!player.territori?.includes(regionId) && !Object.values(player.territori_dict || {}).some(list => list.includes(regionId)))) {
                return { save: false, data: { error: 'Puoi costruire solo sui tuoi territori' } };
            }

            const tier = structureDetails.tier || 1;
            const playerTechs = player.technologies || [];
            if (tier > 1 && !playerTechs.includes(structureId)) {
                return { save: false, data: { error: "Devi prima ricercare questa tecnologia nell'Albero Tecnologico!" } };
            }

            let strutture = player.strutture || [];
            let replacedStructureId = null;

            const hasSameBaseIdx = strutture.findIndex(s => s.structureId.split('_t')[0] === baseName && (s.regionId === regionId || s.targetName === targetName));

            if (reqPrevStructure) {
                const reqPrevBaseName = reqPrevStructure.split('_t')[0];
                const reqPrevTierMatch = reqPrevStructure.match(/_t(\d+)/);
                const reqPrevTier = reqPrevTierMatch ? parseInt(reqPrevTierMatch[1], 10) : 1;

                const prevIdx = strutture.findIndex(s => {
                    if (s.regionId !== regionId && s.targetName !== targetName) return false;
                    const sBaseName = s.structureId.split('_t')[0];
                    if (sBaseName !== reqPrevBaseName) return false;
                    const sTierMatch = s.structureId.match(/_t(\d+)/);
                    const sTier = sTierMatch ? parseInt(sTierMatch[1], 10) : 1;
                    return sTier >= reqPrevTier;
                });

                if (prevIdx === -1) {
                    return { save: false, data: { error: `Devi prima avere ${reqPrevBaseName} di livello almeno ${reqPrevTier} in questa regione.` } };
                }

                const prevBaseName = reqPrevBaseName;
                if (prevBaseName === baseName) {
                    replacedStructureId = strutture[prevIdx].id;
                } else {
                    if (hasSameBaseIdx !== -1) {
                        return { save: false, data: { error: 'Hai già costruito questo tipo di struttura in questa regione.' } };
                    }
                }
            } else {
                if (hasSameBaseIdx !== -1) {
                    return { save: false, data: { error: 'Hai già costruito questo tipo di struttura in questa regione.' } };
                }
            }

            let resources = player.risorse;
            if (!resources) return { save: false, data: { error: 'Risorse non trovate' } };

            if (resources.denaro < reqDenaro || resources.legno < reqLegno || resources.mattone < reqMattone ||
                resources.acciaio < reqAcciaio || resources.piombo < reqPiombo || resources.petrolio < reqPetrolio) {
                return { save: false, data: { error: 'Risorse insufficienti per la costruzione' } };
            }

            resources.denaro -= reqDenaro;
            resources.legno -= reqLegno;
            resources.mattone -= reqMattone;
            resources.acciaio -= reqAcciaio;
            resources.piombo -= reqPiombo;
            resources.petrolio -= reqPetrolio;

            let multiplier = 1;
            try {
                const decodedMatch = Eru.decode_match(matchObj.match.struttura_partita);
                multiplier = decodedMatch.multiplierValue || 1;
            } catch (err) {}

            const tempoCostruzioneHours = structureDetails.tempo_costruzione || 0;
            const buildEtaMs = (tempoCostruzioneHours * 60 * 60 * 1000) / multiplier;
            const isBuilding = buildEtaMs > 0;

            let finalTargetCoords = targetCoords;
            if (replacedStructureId) {
                const oldStruct = strutture.find(s => s.id === replacedStructureId);
                if (oldStruct && oldStruct.targetCoords) {
                    finalTargetCoords = oldStruct.targetCoords;
                }
            }

            const newStructure = {
                id: require('crypto').randomUUID(),
                structureId: structureId,
                name: structureDetails.nome || structureDetails.name,
                targetName: targetName,
                regionId: regionId,
                targetCoords: finalTargetCoords,
                status: isBuilding ? 'building' : 'built',
                owner: ws.username,
                buildTime: Date.now(),
                completionTime: isBuilding ? Date.now() + buildEtaMs : null
            };

            if (replacedStructureId) strutture = strutture.filter(s => s.id !== replacedStructureId);
            strutture.push(newStructure);
            player.strutture = strutture;
            player.risorse = resources;

            let targetUsers = [userId];
            const myAllianceId = player.id_alleanza;
            if (myAllianceId) {
                targetUsers = matchObj.match.player
                    .filter(p => String(p.id_alleanza) === String(myAllianceId))
                    .map(p => p.id_user);
            }

            return { save: true, matchObj, data: { success: true, newStructure, replacedStructureId, resources, targetUsers } };
        });

        if (!updRes || updRes.error) {
            const err = updRes ? updRes.error : 'Errore costruzione';
            return ws.send(JSON.stringify({ type: 'ERROR', error: err }));
        }

        if (updRes.success) {
            ws.send(JSON.stringify({ type: 'BUILD_SUCCESS', payload: updRes.newStructure, replacedStructureId: updRes.replacedStructureId }));
            const broadcastPayload = {
                matchId: ws.matchId,
                targetUsers: [userId],
                payload: { type: 'RESOURCES_UPDATED', data: { resources: translateRedisToFe(updRes.resources) } }
            };
            await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastPayload));

            const broadcastStructurePayload = {
                matchId: ws.matchId,
                targetUsers: updRes.targetUsers,
                payload: { type: 'STRUCTURE_BUILT', data: updRes.newStructure, replacedStructureId: updRes.replacedStructureId }
            };
            await redis.publish('match_ws_broadcast_channel', JSON.stringify(broadcastStructurePayload));
        }
    } catch (e) {
        console.error("[SYS_ERR] Errore in BUILD_STRUCTURE:", e);
        ws.send(JSON.stringify({ type: 'ERROR', error: 'Errore interno del server durante la costruzione' }));
    }
}

module.exports = { handleResearchTech, handleBuildStructure };
