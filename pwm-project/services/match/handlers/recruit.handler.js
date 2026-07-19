const redis = require('../../shared/redisClient.js');
const { updateMatch } = require('../../shared/matchMonolithic.js');
const dynamicPathfinder = require('../middleware/dynamicPathfinder.js');
const Eru = require('../middleware/Eru.js');

let cachedGameRules = null;
let lastGameRulesFetch = 0;

async function getGameRulesCached(redisClient) {
    if (cachedGameRules && (Date.now() - lastGameRulesFetch < 60000)) {
        return cachedGameRules;
    }
    const rulesRawBase64 = await redisClient.get("assets:game_rules.json");
    if (rulesRawBase64) {
        cachedGameRules = JSON.parse(Buffer.from(rulesRawBase64, 'base64').toString('utf8'));
        lastGameRulesFetch = Date.now();
    }
    return cachedGameRules;
}

function translateRedisToFe(resources) {
    return {
        denaro: (resources && resources.denaro) || 0,
        legno: (resources && resources.legno) || 0,
        piombo: (resources && resources.piombo) || 0,
        acciaio: (resources && resources.acciaio) || 0,
        mattoni: (resources && resources.mattone) || 0,
        petrolio: (resources && resources.petrolio) || 0,
        gas_naturale: (resources && resources.gas) || 0,
        uranio: (resources && resources.uranio) || 0,
        oro: (resources && resources.oro) || 0
    };
}

async function handleRecruitUnit(ws, payload) {
    try {
        console.log("[RECRUIT_UNIT] Inizio elaborazione", payload);
        const { unitId, targetName, targetCoords } = payload;
        
        const rulesObj = await getGameRulesCached(redis) || { sheets: [] };

        const result = await updateMatch(ws.matchId, async (matchObj) => {
            if (!matchObj || !matchObj.match || !matchObj.match.player) {
                console.log("[RECRUIT_UNIT] Partita o player mancanti");
                return { save: false };
            }

            let player = matchObj.match.player.find(p => p.username === ws.username);
            if (!player) {
                console.log("[RECRUIT_UNIT] Player non trovato per", ws.username);
                return { save: false };
            }

            if (unitId !== 'fante' && player.addestramenti && player.addestramenti.some(t => t.targetName === targetName)) {
                console.log("[RECRUIT_UNIT] Addestramento già in corso in questa struttura");
                ws.send(JSON.stringify({ type: 'ERROR', error: 'Coda di addestramento occupata in questa struttura.' }));
                return { save: false };
            }

            const recruitmentTruppeSheet = rulesObj.sheets.find(s => s.name === "Truppe" || s.name === "truppe");
            const recruitmentTruppeLines = recruitmentTruppeSheet ? recruitmentTruppeSheet.lines : [];
            const recruitmentURule = recruitmentTruppeLines.find(l => l.id_truppa === unitId);
            
            if (!recruitmentURule) {
                ws.send(JSON.stringify({ type: 'ERROR', error: 'Unità sconosciuta.' }));
                return { save: false };
            }

            if (recruitmentURule.prodotta_in) {
                const prodStructure = recruitmentURule.prodotta_in;
                const struttureSheet = rulesObj.sheets.find(s => s.name === "Strutture" || s.name === "strutture");
                const struttureLines = struttureSheet ? struttureSheet.lines : [];
                const sRule = struttureLines.find(l => l.id_struttura === prodStructure);
                if (sRule && sRule.tier > 1) {
                    const playerTechs = player.technologies || [];
                    if (!playerTechs.includes(prodStructure)) {
                        console.log(`[RECRUIT_UNIT] Tecnologia non ricercata per la struttura: ${prodStructure}`);
                        ws.send(JSON.stringify({ type: 'ERROR', error: `Devi prima ricercare la tecnologia ${sRule.nome || prodStructure}!` }));
                        return { save: false };
                    }
                }
            }
            
            const reqDenaro = recruitmentURule.costo_denaro || 0;
            const reqLegno = recruitmentURule.costo_legno || 0;
            const reqMattoni = recruitmentURule.costo_mattoni || 0;
            const reqAcciaio = recruitmentURule.costo_acciaio || 0;
            const reqPetrolio = recruitmentURule.costo_petrolio || 0;
            const reqPiombo = (recruitmentURule.costo_piombo || recruitmentURule.costo_piombio) || 0;
            const reqGas = recruitmentURule.costo_gas || 0;
            const reqUranio = recruitmentURule.costo_uranio || 0;
            const reqOro = recruitmentURule.costo_oro || 0;
            const trainTime = recruitmentURule.tempo_addestramento || 0;
            
            let resources = player.risorse || { denaro: 0, acciaio: 0 };
            
            if (
                (resources.denaro || 0) < reqDenaro ||
                (resources.legno || 0) < reqLegno ||
                (resources.mattone || 0) < reqMattoni ||
                (resources.acciaio || 0) < reqAcciaio ||
                (resources.petrolio || 0) < reqPetrolio ||
                (resources.piombo || 0) < reqPiombo ||
                (resources.gas || 0) < reqGas ||
                (resources.uranio || 0) < reqUranio ||
                (resources.oro || 0) < reqOro
            ) {
                console.log("[RECRUIT_UNIT] Risorse insufficienti");
                ws.send(JSON.stringify({ type: 'ERROR', error: 'Risorse insufficienti per il reclutamento.' }));
                return { save: false };
            }
            
            resources.denaro = (resources.denaro || 0) - reqDenaro;
            resources.legno = (resources.legno || 0) - reqLegno;
            resources.mattone = (resources.mattone || 0) - reqMattoni;
            resources.acciaio = (resources.acciaio || 0) - reqAcciaio;
            resources.petrolio = (resources.petrolio || 0) - reqPetrolio;
            resources.piombo = (resources.piombo || 0) - reqPiombo;
            resources.gas = (resources.gas || 0) - reqGas;
            resources.uranio = (resources.uranio || 0) - reqUranio;
            resources.oro = (resources.oro || 0) - reqOro;
            
            player.risorse = resources;
            
            let multiplier = 1;
            if (matchObj.match.struttura_partita) {
                try {
                    const decodedMatch = Eru.decode_match(matchObj.match.struttura_partita);
                    multiplier = decodedMatch.multiplierValue || 1;
                } catch (err) {}
            }
            const trainTimeMs = (trainTime / multiplier) * 3600 * 1000;
            const endTime = Date.now() + trainTimeMs;
            
            let spawnCoords = targetCoords;
            const truppeSheet = rulesObj.sheets.find(s => s.name === "Truppe" || s.name === "truppe");
            const truppeLines = truppeSheet ? truppeSheet.lines : [];
            const uRule = truppeLines.find(l => l.id_truppa === unitId);
            if (uRule && targetCoords && typeof targetCoords === 'string' && targetCoords.includes(',')) {
                const [sLng, sLat] = targetCoords.split(',').map(s => parseFloat(s.trim()));
                if (!isNaN(sLng) && !isNaN(sLat)) {
                    if (uRule.dominio === 2) {
                        const waterCoords = await dynamicPathfinder.findNearestWater(sLng, sLat);
                        spawnCoords = `${waterCoords.lng},${waterCoords.lat}`;
                    } else {
                        const offsetLng = (Math.random() - 0.5) * 0.1;
                        const offsetLat = (Math.random() - 0.5) * 0.1;
                        const landCoords = await dynamicPathfinder.findNearestLand(sLng + offsetLng, sLat + offsetLat);
                        spawnCoords = `${landCoords.lng},${landCoords.lat}`;
                    }
                }
            }

            if (!player.addestramenti) player.addestramenti = [];
            player.addestramenti.push({
                troopId: unitId,
                targetName: targetName,
                spawnCoords: spawnCoords,
                count: 1,
                endTime: endTime
            });
            console.log(`[RECRUIT_UNIT] Salvataggio addestramento di ${unitId} per ${ws.username}`);
            return { save: true, matchObj, data: { trainings: player.addestramenti, resources: player.risorse } };
        });
        
        if (result) {
            ws.send(JSON.stringify({
                type: 'RECRUIT_UNIT_SUCCESS',
                payload: {
                    trainings: result.trainings,
                    resources: translateRedisToFe(result.resources)
                }
            }));
        }
    } catch (e) {
        console.error("[SYS_ERR] Errore in RECRUIT_UNIT:", e);
        ws.send(JSON.stringify({ type: 'ERROR', error: `Errore RECRUIT_UNIT: ${e.message}` }));
    }
}

module.exports = { handleRecruitUnit, getGameRulesCached, translateRedisToFe };
