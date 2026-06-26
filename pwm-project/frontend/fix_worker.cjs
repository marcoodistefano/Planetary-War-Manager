const fs = require('fs');
let file = fs.readFileSync('src/app/game/match/match.page.ts', 'utf8');

file = file.replace(/        this\.topoWorker\.onmessage = \(\{ data \}\) => \{\r?\n          onGeoDataReady\(data\.geoData\);\r?\n        \};\r?\n        this\.topoWorker\.postMessage\(\{ topologyText, id: layerId, layerType: 'regions' \}\);/g, 
`        const handler = ({ data }: any) => {
          if (data.id === layerId) {
            this.topoWorker?.removeEventListener('message', handler);
            onGeoDataReady(data.geoData);
          }
        };
        this.topoWorker.addEventListener('message', handler);
        this.topoWorker.postMessage({ topologyText, id: layerId, layerType: 'regions' });`);

fs.writeFileSync('src/app/game/match/match.page.ts', file, 'utf8');
console.log('Fixed worker bug');
