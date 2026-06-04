const redis = require("../../shared/redisClient.js");

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
                    let jumped = false;
                    for (const regIdx of unassigned) {
                        if (adj[regIdx].admin === targetAdmin) {
                            const jumpRegion = adj[regIdx];
                            currentNationRegions.push(jumpRegion.index);
                            unassigned.delete(String(jumpRegion.index));
                            queue.push(...jumpRegion.neighbors.filter(n => unassigned.has(String(n))));
                            jumped = true;
                            break;
                        }
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
                isOccupied: false,
                inWar: false,
                playerId: null,
                territories_flat: provCodesFlat,
                territories: provCodesByAdmin
            });
        }
        
        await redis.set(`match:${matchId}:nations`, JSON.stringify(nations));
        
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
