const fs = require('fs');

const adj = JSON.parse(fs.readFileSync('/app/src/assets/map/regions_adjacency.json', 'utf8'));
const archsStr = fs.readFileSync('/app/src/assets/map/archs.json', 'utf8');
const archs = JSON.parse(archsStr);

let regionSample = Object.values(adj)[0];
console.log('Region sample:', regionSample);

let topologyObj = archs.objects;
let firstKey = Object.keys(topologyObj)[0];
let archSample = topologyObj[firstKey].geometries ? topologyObj[firstKey].geometries[0] : null;
console.log('Archs nodes sample:', archSample);

// Check Garoua
let garouaRegion = Object.values(adj).find(r => r.name === 'Garoua');
console.log('Garoua region:', garouaRegion);

