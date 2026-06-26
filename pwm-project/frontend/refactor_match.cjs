const fs = require('fs');
let file = fs.readFileSync('src/app/game/match/match.page.ts', 'utf8');

// 1. Rename applyTerritoryColors to requestTerritoryColors
file = file.replace(/\bapplyTerritoryColors\b/g, 'requestTerritoryColors');

// 2. Remove _regionsReady and _regionsReadyResolve properties
file = file.replace(/  private _regionsReadyResolve\?: \(\) => void;\r?\n/g, '');
file = file.replace(/  private _regionsReady = new Promise<void>\(resolve => \{\r?\n    this\._regionsReadyResolve = resolve;\r?\n  \}\);\r?\n/g, '');

// 3. Add regionsSourceReady and the new methods
file = file.replace(/(  private loadedMapMatchId = '';\r?\n)/, `$1  private regionsSourceReady = false;

  private markRegionsReady() {
    this.regionsSourceReady = true;
    this._lastTerritorySignature = '';
    this.requestTerritoryColors();
  }

  private resetTerritoryState() {
    this.regionsSourceReady = false;
    this._lastTerritorySignature = '';
    this.previousColorMap.clear();
    this.initialColorsApplied = false;
  }
`);

// 4. Remove `this._regionsReady = new Promise(...)` from ionViewWillEnter
file = file.replace(/    this\._regionsReady = new Promise<void>\(resolve => \{\r?\n      this\._regionsReadyResolve = resolve;\r?\n    \}\);\r?\n/g, '');

// 5. In ionViewDidEnter, add resetTerritoryState() before initMap()
file = file.replace(/(      this\.loadedMapMatchId = this\.currentMatchId;\r?\n)/, `$1      this.resetTerritoryState();\n`);

// 6. In ionViewDidEnter, remove old .then() resolver
file = file.replace(/      if \(this\.map\.getSource\('regioni'\) && this\.map\.isSourceLoaded\('regioni'\)\) \{\r?\n        this\._regionsReadyResolve\?\.\(\); \/\/ sblocca il \.then\(\) pendente\r?\n      \}\r?\n/, '');

// 7. In loadTopoJsonLayer onGeoDataReady, replace requestTerritoryColors() & resolve with markRegionsReady()
file = file.replace(/          this\.requestTerritoryColors\(\);\r?\n          this\._regionsReadyResolve\?\.\(\); \/\/ Notifica: source pronta\r?\n/g, `          this.markRegionsReady();\n`);

// 8. Replace requestTerritoryColors method implementation
file = file.replace(/  requestTerritoryColors\(\) \{\r?\n    if \(!this\.matchNations\?\.length\) return; \/\/ Nulla da fare\r?\n\r?\n    this\._regionsReady\.then\(\(\) => \{\r?\n      const now = Date\.now\(\);\r?\n      const elapsed = now - this\._lastApply;\r?\n      if \(\(this as any\)\._applyTerritoryColorsTimer\) \{\r?\n        clearTimeout\(\(this as any\)\._applyTerritoryColorsTimer\);\r?\n      \}\r?\n      \r?\n      const delay = elapsed > 250 \? 0 : 80;\r?\n      \(this as any\)\._applyTerritoryColorsTimer = setTimeout\(\(\) => \{\r?\n        this\._lastApply = Date\.now\(\);\r?\n        this\._doApplyTerritoryColors\(\);\r?\n      \}, delay\);\r?\n    \}\);\r?\n  \}/g, `  requestTerritoryColors() {
    if (!this.regionsSourceReady) return;     // source non ancora pronta
    if (!this.matchNations?.length) return;   // nazioni non ancora arrivate
    const elapsed = Date.now() - this._lastApply;
    if ((this as any)._applyTerritoryColorsTimer) clearTimeout((this as any)._applyTerritoryColorsTimer);
    const delay = elapsed > 250 ? 0 : 80;
    (this as any)._applyTerritoryColorsTimer = setTimeout(() => {
      this._lastApply = Date.now();
      this._doApplyTerritoryColors();
    }, delay);
  }`);

// Also fix _doApplyTerritoryColors to not be named _dorequestTerritoryColors if my regex was wrong (it shouldn't be, I used \b)

fs.writeFileSync('src/app/game/match/match.page.ts', file, 'utf8');
console.log('Done refactoring match.page.ts');
