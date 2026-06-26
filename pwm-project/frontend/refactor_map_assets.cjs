const fs = require('fs');
let file = fs.readFileSync('src/app/game/match/match.page.ts', 'utf8');

if (!file.includes('MapAssetsService')) {
  file = `import { MapAssetsService } from '../../services/map-assets.service';\n` + file;
}

// 2. Inject MapAssetsService in constructor
if (!file.includes('private mapAssets: MapAssetsService')) {
  file = file.replace(/    private route: ActivatedRoute,\r?\n/, `    private route: ActivatedRoute,\n    private mapAssets: MapAssetsService,\n`);
}

// 3. Replace fetch(fetchUrl).then(res => res.text()) with this.mapAssets.getText(fetchUrl) in loadTopoJsonLayer
file = file.replace(/    fetch\(fetchUrl\)\.then\(res => res\.text\(\)\)\.then\(topologyText => \{\r?\n/g, 
`    this.mapAssets.getText(fetchUrl).then((topologyText: string) => {\n`);

// 4. In startFetchMapAssets, replace fetching logic if needed.
// Wait, the errors were about topologyText having any type. So adding (topologyText: string) fixes it.

fs.writeFileSync('src/app/game/match/match.page.ts', file, 'utf8');
console.log('Fixed map assets refactor');
