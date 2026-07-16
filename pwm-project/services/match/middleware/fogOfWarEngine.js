const db = require("../../shared/postgresClient.js");
const Redis = require("ioredis");
const redis = new Redis({ host: process.env.REDIS_HOST || 'redis', port: process.env.REDIS_PORT || 6379 });
const fs = require("fs");
const path = require("path");
const { getMatch } = require('../../shared/matchMonolithic.js');
const { getNodeCoords, getArmyLocation } = require('./movementLogic.js');

const { getArmyVisionRadius, defaultVisionRadius, isAirArmy, isStealthArmy, radarRadiusMap } = require('./gameUtils.js');

const runFogOfWarCycle = async () => {
    try {
        const lockAcquired = await redis.set('engine_lock:fogOfWar', 'locked', 'NX', 'PX', 2900);
        if (!lockAcquired) return;

        const matchKeys = await db.query("SELECT id_partita_hash FROM partite WHERE substring(struttura_partita::text from 1 for 2) = '01'").then(res => res.rows.map(r => `match:${r.id_partita_hash}`));
        const matchIds = new Set();
        matchKeys.forEach(k => {
            const parts = k.split(':');
            if (parts.length >= 2 && parts[1] && parts[1] !== 'ws_broadcast_channel') {
                matchIds.add(parts[1]);
            }
        });

        for (const matchId of matchIds) {
            const matchObj = await getMatch(matchId);
            if (!matchObj || !matchObj.match || !matchObj.match.player) continue;
            
            const nations = matchObj.match.player;
            let allArmies = [];
            let armiesByPlayer = {};
            const armiesDict = {}; // per lookup rapido post-GEOSEARCH
            
            const geoKey = `match:${matchId}:geo:armies`;
            const geoPipeline = redis.pipeline();
            geoPipeline.del(geoKey); // Pulisce il vecchio indice
            
            let hasArmies = false;

            for (const player of nations) {
                const username = player.username;
                armiesByPlayer[username] = [];
                if (player.armate) {
                    const list = Object.values(player.armate).map(a => ({...a, owner: username}));
                    armiesByPlayer[username] = list;
                    allArmies = allArmies.concat(list);
                    
                    for (const army of list) {
                        const coords = getArmyLocation(army);
                        if (coords) {
                            hasArmies = true;
                            // Aggiunge all'indice spaziale: lng, lat, memberName
                            geoPipeline.geoadd(geoKey, coords[0], coords[1], `${username}|${army.id}`);
                            armiesDict[`${username}|${army.id}`] = army;
                        }
                    }
                }
            }
            
            if (hasArmies) {
                await geoPipeline.exec();
            }

            for (const player of nations) {
                const username = player.username;
                const userId = player.id_user;
                
                if (!userId || String(username).includes('_bot')) continue;

                const myArmies = armiesByPlayer[username] || [];
                const myTerritoryNames = new Set();
                
                if (player.territori_dict) {
                    for (const provs of Object.values(player.territori_dict)) {
                        provs.forEach(t => myTerritoryNames.add(String(t).trim().toLowerCase()));
                    }
                } else if (player.territori) {
                    player.territori.forEach(t => myTerritoryNames.add(String(t).trim().toLowerCase()));
                }

                const myTerritoriesCoords = [];
                myTerritoryNames.forEach(nodeName => {
                    const coords = getNodeCoords(nodeName);
                    if (coords) {
                        myTerritoriesCoords.push(coords);
                    }
                });

                const myArmiesVision = myArmies.map(a => {
                    return { coords: getArmyLocation(a), radius: getArmyVisionRadius(a) };
                }).filter(a => a.coords !== null);

                // Aggiungiamo i radar costruiti
                const myRadars = [];
                if (player.strutture) {
                    for (const s of player.strutture) {
                        if (s.status === 'built' && s.structureId && s.structureId.startsWith('radar_')) {
                            const radius = radarRadiusMap[s.structureId] || 500; // default 500 se non trovato
                            if (s.targetCoords) {
                                myRadars.push({
                                    coords: s.targetCoords,
                                    radius: radius,
                                    isAntiAir: s.structureId.startsWith('radar_anti_aereo')
                                });
                            }
                        }
                    }
                }

                // Pipeline per le ricerche visive
                const searchPipeline = redis.pipeline();
                let searchCount = 0;
                let searchTypes = []; // Per tenere traccia di chi esegue la ricerca ('default', 'antiAir', 'terrestrial')

                // 1. Ricerca visiva attorno ai miei territori
                for (const tCoord of myTerritoriesCoords) {
                    searchPipeline.georadius(geoKey, tCoord[0], tCoord[1], defaultVisionRadius, 'km');
                    searchTypes.push('default');
                    searchCount++;
                }

                // 2. Ricerca visiva attorno alle mie armate
                for (const aVision of myArmiesVision) {
                    searchPipeline.georadius(geoKey, aVision.coords[0], aVision.coords[1], aVision.radius, 'km');
                    searchTypes.push('default');
                    searchCount++;
                }
                
                // 3. Ricerca visiva attorno ai miei radar
                for (const radar of myRadars) {
                    searchPipeline.georadius(geoKey, radar.coords[0], radar.coords[1], radar.radius, 'km');
                    searchTypes.push(radar.isAntiAir ? 'antiAir' : 'terrestrial');
                    searchCount++;
                }

                const visibleEnemies = [];
                if (searchCount > 0 && hasArmies) {
                    const searchResults = await searchPipeline.exec();
                    const seenArmyIds = new Set();

                    for (let i = 0; i < searchResults.length; i++) {
                        const res = searchResults[i];
                        const sType = searchTypes[i];
                        const members = res[1]; // array di stringhe "username|armyId"
                        if (members && Array.isArray(members)) {
                            for (const member of members) {
                                if (member.startsWith(`${username}|`)) continue; // Ignora le mie armate
                                if (!seenArmyIds.has(member)) {
                                    const enemyArmy = armiesDict[member];
                                    if (!enemyArmy) continue;
                                    
                                    // Stealth invisibile ai radar
                                    if ((sType === 'antiAir' || sType === 'terrestrial') && isStealthArmy(enemyArmy)) continue;
                                    
                                    // Radar anti-aereo vede solo aerei
                                    if (sType === 'antiAir' && !isAirArmy(enemyArmy)) continue;
                                    
                                    // Radar terrestre NON vede aerei puri
                                    if (sType === 'terrestrial' && isAirArmy(enemyArmy)) continue;
                                    
                                    seenArmyIds.add(member);
                                    visibleEnemies.push(enemyArmy);
                                }
                            }
                        }
                    }
                }

                const citiesHpStr = await redis.hgetall(`match:${matchId}:cities_hp`);
                const citiesHp = {};
                if (citiesHpStr) {
                    for (const [cityId, hp] of Object.entries(citiesHpStr)) {
                        citiesHp[cityId] = parseInt(hp, 10);
                    }
                }

                const payload = {
                    matchId: matchId,
                    targetUsers: [userId],
                    payload: {
                        type: 'FOG_OF_WAR_UPDATE',
                        payload: {
                            visibleEnemies: visibleEnemies,
                            myArmies: myArmies,
                            citiesHp: citiesHp
                        }
                    }
                };
                await redis.publish('match_ws_broadcast_channel', JSON.stringify(payload));
            }
        }
    } catch (e) {
        console.error("[FOG_OF_WAR] Error during cycle:", e);
    }
};

const runFogOfWarStructuresCycle = async () => {
    try {
        const lockAcquired = await redis.set('engine_lock:fogOfWarStructures', 'locked', 'NX', 'PX', 29000);
        if (!lockAcquired) return;

        const matchKeys = await db.query("SELECT id_partita_hash FROM partite WHERE substring(struttura_partita::text from 1 for 2) = '01'").then(res => res.rows.map(r => `match:${r.id_partita_hash}`));
        const matchIds = new Set();
        matchKeys.forEach(k => {
            const parts = k.split(':');
            if (parts.length >= 2 && parts[1] && parts[1] !== 'ws_broadcast_channel') {
                matchIds.add(parts[1]);
            }
        });

        for (const matchId of matchIds) {
            const matchObj = await getMatch(matchId);
            if (!matchObj || !matchObj.match || !matchObj.match.player) continue;
            
            const nations = matchObj.match.player;
            let structuresByPlayer = {};
            const structuresDict = {}; 
            
            const geoKeyStructs = `match:${matchId}:geo:structures`;
            const geoPipelineStructs = redis.pipeline();
            geoPipelineStructs.del(geoKeyStructs);
            
            let hasStructures = false;

            for (const player of nations) {
                const username = player.username;
                structuresByPlayer[username] = [];
                if (player.strutture) {
                    const list = player.strutture.map(s => ({...s, owner: username}));
                    structuresByPlayer[username] = list;
                    
                    for (const struct of list) {
                        const coords = struct.targetCoords;
                        if (coords && Array.isArray(coords) && coords.length >= 2) {
                            hasStructures = true;
                            geoPipelineStructs.geoadd(geoKeyStructs, coords[0], coords[1], `${username}|${struct.id}`);
                            structuresDict[`${username}|${struct.id}`] = struct;
                        }
                    }
                }
            }
            
            if (hasStructures) {
                await geoPipelineStructs.exec();
            }

            for (const player of nations) {
                const username = player.username;
                const userId = player.id_user;
                const allianceId = player.id_alleanza;
                
                if (!userId || String(username).includes('_bot')) continue;

                const myTerritoryNames = new Set();
                if (player.territori_dict) {
                    for (const provs of Object.values(player.territori_dict)) {
                        provs.forEach(t => myTerritoryNames.add(String(t).trim().toLowerCase()));
                    }
                } else if (player.territori) {
                    player.territori.forEach(t => myTerritoryNames.add(String(t).trim().toLowerCase()));
                }

                const myTerritoriesCoords = [];
                myTerritoryNames.forEach(nodeName => {
                    const coords = getNodeCoords(nodeName);
                    if (coords) {
                        myTerritoriesCoords.push(coords);
                    }
                });

                const myArmies = player.armate ? Object.values(player.armate).map(a => ({...a, owner: username})) : [];
                const myArmiesVision = myArmies.map(a => {
                    return { coords: getArmyLocation(a), radius: getArmyVisionRadius(a) };
                }).filter(a => a.coords !== null);

                const searchPipeline = redis.pipeline();
                let searchCount = 0;

                for (const tCoord of myTerritoriesCoords) {
                    searchPipeline.georadius(geoKeyStructs, tCoord[0], tCoord[1], defaultVisionRadius, 'km');
                    searchCount++;
                }

                for (const aVision of myArmiesVision) {
                    searchPipeline.georadius(geoKeyStructs, aVision.coords[0], aVision.coords[1], aVision.radius, 'km');
                    searchCount++;
                }

                const visibleStructures = [];
                if (searchCount > 0 && hasStructures) {
                    const searchResults = await searchPipeline.exec();
                    const seenIds = new Set();

                    for (const res of searchResults) {
                        const members = res[1];
                        if (members && Array.isArray(members)) {
                            for (const member of members) {
                                const ownerName = member.split('|')[0];
                                const isAlly = allianceId && nations.find(n => n.username === ownerName)?.id_alleanza === allianceId;
                                
                                if (ownerName === username || isAlly) continue; // Will be added explicitly below
                                if (!seenIds.has(member)) {
                                    seenIds.add(member);
                                    if (structuresDict[member]) {
                                        visibleStructures.push(structuresDict[member]);
                                    }
                                }
                            }
                        }
                    }
                }

                // Add own structures and allies' structures explicitly
                for (const other of nations) {
                    const isAlly = allianceId && String(other.id_alleanza) === String(allianceId);
                    if (other.username === username || isAlly) {
                        if (other.strutture) {
                            other.strutture.forEach(s => visibleStructures.push({ ...s, owner: other.username }));
                        }
                    }
                }

                const payload = {
                    matchId: matchId,
                    targetUsers: [userId],
                    payload: {
                        type: 'FOG_OF_WAR_STRUCTURES_UPDATE',
                        payload: {
                            visibleStructures: visibleStructures
                        }
                    }
                };
                await redis.publish('match_ws_broadcast_channel', JSON.stringify(payload));
            }
        }
    } catch (e) {
        console.error("[FOG_OF_WAR_STRUCTURES] Error during cycle:", e);
    }
};

const startFogOfWarEngine = () => {
    setInterval(runFogOfWarCycle, 3000); // 3 secondi
    setInterval(runFogOfWarStructuresCycle, 30000); // 30 secondi
    console.log("[SYSTEM] Fog of War Engine started.");
};

module.exports = {
    startFogOfWarEngine,
    runFogOfWarCycle,
    runFogOfWarStructuresCycle
};
