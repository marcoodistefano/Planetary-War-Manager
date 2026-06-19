const db = require("../../shared/postgresClient.js");
const redis = require("../../shared/redisClient");
const fs = require("fs");
const path = require("path");

const { getNodeCoords, getArmyLocation, haversineDist } = require('./movementLogic.js');

let troopsVisionMap = {}; // id_truppa -> raggio_visivo
let defaultVisionRadius = 100;

try {
    const rulesPath = path.join(__dirname, '../../../shared/assets/game_rules.json');
    if (fs.existsSync(rulesPath)) {
        const gameRules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
        const truppeSheet = gameRules.sheets.find(s => s.name === 'Truppe');
        if (truppeSheet && truppeSheet.lines) {
            truppeSheet.lines.forEach(l => {
                troopsVisionMap[l.id_truppa] = l.raggio_visivo || defaultVisionRadius;
            });
            console.log(`[FOG_OF_WAR] Caricati ${Object.keys(troopsVisionMap).length} raggi visivi dal JSON.`);
        }
    }
} catch (e) {
    console.error("[FOG_OF_WAR] Errore caricamento game_rules.json:", e);
}

// Funzione per calcolare il raggio visivo di un'armata
function getArmyVisionRadius(army) {
    let maxRadius = defaultVisionRadius;
    if (army.composition) {
        for (const [id_truppa, qty] of Object.entries(army.composition)) {
            if (qty > 0 && troopsVisionMap[id_truppa] > maxRadius) {
                maxRadius = troopsVisionMap[id_truppa];
            }
        }
    }
    return maxRadius;
}

// getArmyLocation is imported from movementLogic.js

const runFogOfWarCycle = async () => {
    try {
        const matchKeys = await db.query('SELECT id_partita_hash FROM partite').then(res => res.rows.map(r => `match:${r.id_partita_hash}`));
        const matchIds = new Set();
        matchKeys.forEach(k => {
            const parts = k.split(':');
            if (parts.length >= 2 && parts[1] && parts[1] !== 'ws_broadcast_channel') {
                matchIds.add(parts[1]);
            }
        });

        for (const matchId of matchIds) {
            const matchDataStr = await redis.get(`match:${matchId}`);
            if (!matchDataStr) continue;
            
            let matchObj;
            try {
                matchObj = JSON.parse(matchDataStr);
            } catch(e) { continue; }
            
            if (!matchObj || !matchObj.match || !matchObj.match.player) continue;
            
            const nations = matchObj.match.player;
            let allArmies = [];
            let armiesByPlayer = {};
            
            for (const player of nations) {
                const username = player.username;
                armiesByPlayer[username] = [];
                if (player.armate) {
                    const list = Object.values(player.armate).map(a => ({...a, owner: username}));
                    armiesByPlayer[username] = list;
                    allArmies = allArmies.concat(list);
                }
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

                const visibleEnemies = [];

                for (const army of allArmies) {
                    if (army.owner === username) continue;

                    const coords = getArmyLocation(army);
                    if (!coords) continue;

                    let isVisible = false;

                    // 1. Check distanza dalle mie armate
                    for (const myArmy of myArmiesVision) {
                        const dist = haversineDist(coords[0], coords[1], myArmy.coords[0], myArmy.coords[1]);
                        if (dist <= myArmy.radius) {
                            isVisible = true; break;
                        }
                    }

                    // 2. Check distanza dai miei territori
                    if (!isVisible) {
                        for (const terrCoords of myTerritoriesCoords) {
                            const dist = haversineDist(coords[0], coords[1], terrCoords[0], terrCoords[1]);
                            if (dist <= 50) { 
                                isVisible = true; break;
                            }
                        }
                    }

                    if (isVisible) {
                        visibleEnemies.push(army);
                    }
                }

                const citiesHpStr = await redis.hGetAll(`match:${matchId}:cities_hp`);
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

const startFogOfWarEngine = () => {
    setInterval(runFogOfWarCycle, 3000); // 3 secondi
    console.log("[SYSTEM] Fog of War Engine started.");
};

module.exports = { startFogOfWarEngine };
