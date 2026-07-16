const fs = require('fs');
const path = require('path');

let troopsVisionMap = {};
let troopsAttackRangeMap = {};
let troopsDomainMap = {};
let radarRadiusMap = {};
let defaultVisionRadius = 100; // Using 100 as the global default for vision

try {
    const rulesPath = path.join(__dirname, '../../../shared/assets/game_rules.json');
    if (fs.existsSync(rulesPath)) {
        const gameRules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
        const truppeSheet = gameRules.sheets.find(s => s.name === 'Truppe');
        if (truppeSheet && truppeSheet.lines) {
            truppeSheet.lines.forEach(l => {
                troopsVisionMap[l.id_truppa] = l.raggio_visivo || defaultVisionRadius;
                troopsAttackRangeMap[l.id_truppa] = l.raggio_attacco || 0;
                troopsDomainMap[l.id_truppa] = l.dominio;
            });
            console.log(`[GAME_UTILS] Caricati ${Object.keys(troopsVisionMap).length} raggi visivi e di attacco dal JSON.`);
        }

        const struttureSheet = gameRules.sheets.find(s => s.name === 'Strutture');
        if (struttureSheet && struttureSheet.lines) {
            struttureSheet.lines.forEach(l => {
                if (l.id_struttura && l.id_struttura.startsWith('radar_')) {
                    radarRadiusMap[l.id_struttura] = (l.raggio_azione || 0) * 10;
                }
            });
        }
    }
} catch (e) {
    console.error("[GAME_UTILS] Errore caricamento game_rules.json:", e);
}

// Funzione per calcolare il raggio visivo di un'armata
function getArmyVisionRadius(army) {
    let maxRadius = 0;
    let hasUnits = false;
    if (army && army.composition) {
        for (const [id_truppa, qty] of Object.entries(army.composition)) {
            if (qty > 0) {
                hasUnits = true;
                const r = troopsVisionMap[id_truppa] !== undefined ? troopsVisionMap[id_truppa] : defaultVisionRadius;
                if (r > maxRadius) {
                    maxRadius = r;
                }
            }
        }
    }
    return hasUnits ? maxRadius : defaultVisionRadius;
}

// Funzione per calcolare la gittata d'attacco di un'armata
function getArmyAttackRange(army) {
    let maxRange = 0;
    if (army.composition) {
        for (const [id_truppa, qty] of Object.entries(army.composition)) {
            if (qty > 0 && troopsAttackRangeMap[id_truppa] !== undefined && troopsAttackRangeMap[id_truppa] > maxRange) {
                maxRange = troopsAttackRangeMap[id_truppa];
            }
        }
    }
    return maxRange;
}

// Funzione per capire se un'armata è puramente aerea (tutti i componenti hanno dominio 0)
function isAirArmy(army) {
    if (!army || !army.composition) return false;
    let hasUnits = false;
    for (const [id_truppa, qty] of Object.entries(army.composition)) {
        if (qty > 0) {
            hasUnits = true;
            if (troopsDomainMap[id_truppa] !== 0) {
                return false;
            }
        }
    }
    return hasUnits;
}

// Funzione per capire se un'armata è stealth (tutti i componenti sono bombardiere_stealth)
function isStealthArmy(army) {
    if (!army || !army.composition) return false;
    let hasUnits = false;
    for (const [id_truppa, qty] of Object.entries(army.composition)) {
        if (qty > 0) {
            hasUnits = true;
            if (id_truppa !== 'bombardiere_stealth') {
                return false;
            }
        }
    }
    return hasUnits;
}

module.exports = {
    getArmyVisionRadius,
    getArmyAttackRange,
    isAirArmy,
    isStealthArmy,
    radarRadiusMap,
    defaultVisionRadius
};
