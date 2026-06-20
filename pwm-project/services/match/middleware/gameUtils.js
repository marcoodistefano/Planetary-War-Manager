const fs = require('fs');
const path = require('path');

let troopsVisionMap = {};
let defaultVisionRadius = 100; // Using 100 as the global default for vision

try {
    const rulesPath = path.join(__dirname, '../../../shared/assets/game_rules.json');
    if (fs.existsSync(rulesPath)) {
        const gameRules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
        const truppeSheet = gameRules.sheets.find(s => s.name === 'Truppe');
        if (truppeSheet && truppeSheet.lines) {
            truppeSheet.lines.forEach(l => {
                troopsVisionMap[l.id_truppa] = l.raggio_visivo || defaultVisionRadius;
            });
            console.log(`[GAME_UTILS] Caricati ${Object.keys(troopsVisionMap).length} raggi visivi dal JSON.`);
        }
    }
} catch (e) {
    console.error("[GAME_UTILS] Errore caricamento game_rules.json:", e);
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

module.exports = {
    getArmyVisionRadius,
    defaultVisionRadius
};
