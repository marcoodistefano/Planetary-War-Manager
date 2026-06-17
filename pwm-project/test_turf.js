const fs = require('fs');
const topojson = require('topojson-client');
const turf = require('@turf/turf');

const regionsFile = './shared/assets/map/regions.json';
const archsFile = './shared/assets/map/archs.json';

const topo = JSON.parse(fs.readFileSync(regionsFile, 'utf-8'));
const geojson = topojson.feature(topo, topo.objects[Object.keys(topo.objects)[0]]);
const regionsFeatures = geojson.features;

const archsTopo = JSON.parse(fs.readFileSync(archsFile, 'utf-8'));
const archsGeojson = topojson.feature(archsTopo, archsTopo.objects.archs);
const archsFeatures = archsGeojson.features;

let nodesMap = new Map();
for (const feature of archsFeatures) {
    const props = feature.properties;
    if (!feature.geometry) continue;
    const coords = feature.geometry.coordinates;
    if (props.city1 && coords.length > 0) nodesMap.set(props.city1, coords[0]);
    if (props.city2 && coords.length > 0) nodesMap.set(props.city2, coords[coords.length - 1]);
}

const nodeCoords = nodesMap.get("MUKDAHAN");
console.log("Coords MUKDAHAN:", nodeCoords);

const pt = turf.point(nodeCoords);
for (const f of regionsFeatures) {
    if (turf.booleanPointInPolygon(pt, f)) {
        console.log("Found region:", f.properties.adm1_code);
        break;
    }
}
