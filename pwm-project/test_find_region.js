const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');
const mapPath = path.join(__dirname, 'services/shared/assets/map/map.geojson');
const mapGeo = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

function findRegionForCoord(lng, lat) {
    const pt = turf.point([lng, lat]);
    for (const feature of mapGeo.features) {
        try {
            if (turf.booleanPointInPolygon(pt, feature)) {
                return feature.properties.adm1_code || feature.id;
            }
        } catch(e) {}
    }
    return null;
}
console.log(findRegionForCoord(14.5, -0.43));
