const fs = require('fs');

let content = fs.readFileSync('services/match/server.js', 'utf8');

const targetStr = `                let success = false;

                if (army.missionMode === 'conquer') {`;

const newStr = `                let success = false;
                
                const { getArmyDomain, getArmyType, executeAirStrike } = require('./middleware/combatLogic.js');
                const armyDomain = getArmyDomain(army);
                const armyType = getArmyType(army);

                if (armyDomain === 0 && army.missionMode === 'conquer') {
                    // Air Strike and Return / Explode
                    console.log("[ARRIVAL] Air Strike detected for army " + row.id_armata);
                    if (armyType === 3) {
                        // Missile: strike and destroy self
                        let defArmy = null;
                        for (const p of matchObj.match.player) {
                            if (p.username === row.username || !p.armate) continue;
                            if (p.armate[row.target_node]) { defArmy = p.armate[row.target_node]; break; }
                        }
                        await executeAirStrike(army, row.target_node, defArmy, row.match_id, matchObj);
                        await db.query(\`DELETE FROM spostamenti WHERE id_spostamento = $1\`, [row.id_spostamento]);
                        await db.query(\`DELETE FROM mosse WHERE id_mossa = $1\`, [row.id_mossa]);
                        
                        // Rimuovi missile dal gioco
                        await updateMatch(row.match_id, (mObj) => {
                            const p = mObj.match.player.find(x => x.username === row.username);
                            if (p && p.armate && p.armate[row.id_armata]) {
                                delete p.armate[row.id_armata];
                            }
                            return { save: true, matchObj: mObj };
                        });
                        continue;
                    } else if (armyType === 8 || armyType === 7) {
                        // Strike and return
                        let defArmy = null;
                        let targetPlayer = row.target_node;
                        for (const p of matchObj.match.player) {
                            if (p.username === row.username || !p.armate) continue;
                            if (p.armate[row.target_node]) { 
                                defArmy = p.armate[row.target_node]; 
                                targetPlayer = p.username;
                                break; 
                            }
                        }
                        
                        await executeAirStrike(army, targetPlayer, defArmy, row.match_id, matchObj);
                        
                        // Set up return
                        const startLoc = army.startingLocation || row.target_node;
                        const returnEtaMs = 60000; // Tempo fittizio/fisso per ora, in futuro calcolato su distanza
                        const etaDate = new Date(Date.now() + returnEtaMs);
                        
                        await db.query(\`DELETE FROM spostamenti WHERE id_spostamento = $1\`, [row.id_spostamento]);
                        await db.query(\`UPDATE mosse SET ttl = $1, type_action = 'mov' WHERE id_mossa = $2\`, [etaDate, row.id_mossa]);
                        
                        // Dobbiamo estrarre lat/lng da startLoc
                        let x_dest = 0, y_dest = 0;
                        if (typeof startLoc === 'string' && startLoc.includes(',')) {
                            const pts = startLoc.split(',');
                            x_dest = parseFloat(pts[0]);
                            y_dest = parseFloat(pts[1]);
                        }
                        
                        await db.query(\`INSERT INTO spostamenti (id_mossa, numero_coda, x_dest, y_dest, target_node, time_to_arrive) VALUES ($1, 1, $2, $3, $4, $5)\`, [row.id_mossa, x_dest, y_dest, 'Rientro', etaDate]);
                        
                        await updateMatch(row.match_id, (mObj) => {
                            const p = mObj.match.player.find(x => x.username === row.username);
                            if (p && p.armate && p.armate[row.id_armata]) {
                                p.armate[row.id_armata].status = 'returning';
                                p.armate[row.id_armata].missionMode = 'return';
                                p.armate[row.id_armata].targetName = 'Rientro';
                                p.armate[row.id_armata].targetCoords = [x_dest, y_dest];
                                p.armate[row.id_armata].startTime = Date.now();
                                p.armate[row.id_armata].etaMs = returnEtaMs;
                                
                                // Reverse path if it exists
                                if (p.armate[row.id_armata].path) {
                                    p.armate[row.id_armata].path = p.armate[row.id_armata].path.reverse();
                                }
                            }
                            return { save: true, matchObj: mObj };
                        });
                        continue;
                    }
                }

                if (army.missionMode === 'conquer') {`;

content = content.replace(targetStr, newStr);

fs.writeFileSync('services/match/server.js', content);
