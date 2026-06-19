const redis = require("../../shared/redisClient.js");
const { updateMatch, createEmptyPlayer } = require("../../shared/matchMonolithic.js");

const calculateNationSize = (maxPlayers) => {
  const players = parseInt(maxPlayers) || 10;
  if (players <= 2) return 500;
  if (players <= 4) return 200;
  if (players <= 10) return 50;
  if (players <= 20) return 20;
  return 10;
};

const generateNations = async (matchId, maxPlayers) => {
    try {
        const adjData = await redis.get('map_data:regions_adjacency');
        if (!adjData) {
            console.error("[TERRITORY_GEN] Impossibile trovare map_data:regions_adjacency.");
            return [];
        }
        const adj = JSON.parse(adjData);
        
        const N = calculateNationSize(maxPlayers);
        const unassigned = new Set(Object.keys(adj));
        let nationIdCounter = 1;
        const nations = [];
        const nationNamesCount = {};
        
        const getBestNeighbor = (queue, targetAdmin) => {
            let bestIdx = -1;
            for (let i=0; i<queue.length; i++) {
                if (adj[queue[i]].admin === targetAdmin) {
                    bestIdx = i;
                    break;
                }
            }
            if (bestIdx !== -1) {
                return queue.splice(bestIdx, 1)[0];
            }
            return queue.shift();
        };

        while (unassigned.size > 0) {
            const startRegionIndex = unassigned.values().next().value;
            const startRegion = adj[startRegionIndex];
            const targetAdmin = startRegion.admin;
            
            const currentNationRegions = [startRegion.index];
            unassigned.delete(String(startRegion.index));
            
            let queue = [...startRegion.neighbors].filter(n => unassigned.has(String(n)));
            
            while (currentNationRegions.length < N) {
                if (queue.length > 0) {
                    const nextRegionIndex = getBestNeighbor(queue, targetAdmin);
                    if (unassigned.has(String(nextRegionIndex))) {
                        currentNationRegions.push(nextRegionIndex);
                        unassigned.delete(String(nextRegionIndex));
                        
                        const newNeighbors = adj[nextRegionIndex].neighbors.filter(n => unassigned.has(String(n)) && !queue.includes(n));
                        queue.push(...newNeighbors);
                    }
                } else {
                    const toRad = x => x * Math.PI / 180;
                    const haversineDistance = (lat1, lon1, lat2, lon2) => {
                        if (!lat1 || !lon1 || !lat2 || !lon2) return 99999;
                        const R = 6371; 
                        const dLat = toRad(lat2 - lat1);
                        const dLon = toRad(lon2 - lon1);
                        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                                  Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
                        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    };

                    let jumped = false;
                    let bestCandidate = null;
                    let minDistance = Infinity;
                    const lastRegionIdx = currentNationRegions[currentNationRegions.length - 1];
                    const lastRegion = adj[lastRegionIdx];

                    for (const regIdx of unassigned) {
                        const candidate = adj[regIdx];
                        let dist = 0;
                        if (lastRegion && candidate) {
                            dist = haversineDistance(lastRegion.lat, lastRegion.lng, candidate.lat, candidate.lng);
                        }
                        const penalty = candidate.admin === targetAdmin ? 0 : 5000;
                        if (dist + penalty < minDistance) {
                            minDistance = dist + penalty;
                            bestCandidate = candidate;
                        }
                    }

                    if (bestCandidate !== null) {
                        currentNationRegions.push(bestCandidate.index);
                        unassigned.delete(String(bestCandidate.index));
                        queue.push(...bestCandidate.neighbors.filter(n => unassigned.has(String(n))));
                        jumped = true;
                    }

                    if (!jumped) {
                        break; 
                    }
                }
            }
            
            const adminCounts = {};
            for (const idx of currentNationRegions) {
                const admin = adj[idx].admin;
                adminCounts[admin] = (adminCounts[admin] || 0) + 1;
            }
            let dominantAdmin = "World";
            let maxCount = 0;
            for (const [admin, count] of Object.entries(adminCounts)) {
                if (count > maxCount) {
                    maxCount = count;
                    dominantAdmin = admin;
                }
            }
            
            if (!nationNamesCount[dominantAdmin]) {
                nationNamesCount[dominantAdmin] = 1;
            } else {
                nationNamesCount[dominantAdmin]++;
            }
            const nameSuffix = nationNamesCount[dominantAdmin] > 1 ? String(nationNamesCount[dominantAdmin]) : "";
            const finalNationName = dominantAdmin + nameSuffix;
            
            const provCodesFlat = [];
            const provCodesByAdmin = {};

            for (const idx of currentNationRegions) {
                const reg = adj[idx];
                provCodesFlat.push(reg.id);
                if (!provCodesByAdmin[reg.admin]) {
                    provCodesByAdmin[reg.admin] = [];
                }
                provCodesByAdmin[reg.admin].push(reg.id);
            }

            nations.push({
                nationId: nationIdCounter++,
                name: finalNationName,
                isOccupied: true,
                inWar: false,
                playerId: finalNationName + "_bot",
                territories_flat: provCodesFlat,
                territories: provCodesByAdmin
            });
        }
        
        // Inietta le nazioni nel json monolitico
        await updateMatch(matchId, (matchObj) => {
            if (!matchObj || !matchObj.match) return { save: false };
            
            for (const n of nations) {
                const playerObj = createEmptyPlayer(n.playerId, n.nationId, n.name);
                playerObj.isOccupied = n.isOccupied;
                playerObj.inWar = n.inWar;
                playerObj.territori = n.territories_flat;
                playerObj.territori_dict = n.territories;
                matchObj.match.player.push(playerObj);
            }
            return { save: true, matchObj, data: true };
        });
        
        // Assign resources to each region in the match
        const regionsResources = {};
        const citiesHpMap = {}; // Mappa degli HP per l'Opzione B
        const MORE_COMMON = ["legno", "piombo", "acciaio", "mattoni"];
        const LESS_COMMON = ["petrolio", "gas_naturale"];

        for (const key in adj) {
            const reg = adj[key];
            const regId = reg.id;
            
            const more = MORE_COMMON[Math.floor(Math.random() * MORE_COMMON.length)];
            const less = LESS_COMMON[Math.floor(Math.random() * LESS_COMMON.length)];

            regionsResources[regId] = {
                more_common: more,
                less_common: less
            };
            
            // Inizializza gli HP base della città a 100
            citiesHpMap[regId] = 100;
        }
        await redis.set(`match:${matchId}:regions_resources`, JSON.stringify(regionsResources));
        
        // Crea o sovrascrive la mappa Hash degli HP su Redis
        if (Object.keys(citiesHpMap).length > 0) {
            await redis.hset(`match:${matchId}:cities_hp`, citiesHpMap);
        }
        
        const territoryToNation = {};
        for (const nation of nations) {
            for (const prov of nation.territories_flat) {
                territoryToNation[prov] = nation.nationId;
            }
        }
        await redis.set(`match:${matchId}:territories`, JSON.stringify(territoryToNation));
        
        console.log(`[TERRITORY_GEN] Generazione completata per match ${matchId}. Create ${nations.length} nazioni (N=${N}).`);
        return nations;
    } catch (err) {
        console.error("[TERRITORY_GEN] Cortocircuito:", err);
        return [];
    }
};

module.exports = {
    generateNations,
    calculateNationSize
};
