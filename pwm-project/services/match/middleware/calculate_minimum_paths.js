const fs = require('fs');
const path = require('path');

const ARCHS_FILE = path.join(__dirname, '../../../shared/assets/map/archs.json');
const OUTPUT_FILE = path.join(__dirname, '../../../shared/assets/map/minimum_path.json');

function main() {
    console.log('Lettura del file archs.json...');
    const rawData = fs.readFileSync(ARCHS_FILE, 'utf-8');
    const geojson = JSON.parse(rawData);

    const edgesRaw = [];
    const nodeNameToId = new Map();
    const nodeIdToName = [];

    // Estrazione degli archi dal TopoJSON
    const geometries = geojson.objects.archs.geometries;
    for (const feature of geometries) {
        const props = feature.properties;
        if (props && props.city1 && props.city2 && props.distance !== undefined) {
            const uStr = props.city1;
            const vStr = props.city2;
            const cost = props.distance;

            let uId = nodeNameToId.get(uStr);
            if (uId === undefined) {
                uId = nodeIdToName.length;
                nodeNameToId.set(uStr, uId);
                nodeIdToName.push(uStr);
            }

            let vId = nodeNameToId.get(vStr);
            if (vId === undefined) {
                vId = nodeIdToName.length;
                nodeNameToId.set(vStr, vId);
                nodeIdToName.push(vStr);
            }

            edgesRaw.push({ u: uId, v: vId, cost });
            edgesRaw.push({ u: vId, v: uId, cost }); // L'arco è non orientato
        }
    }

    const nNodes = nodeIdToName.length;
    const nEdges = edgesRaw.length;
    console.log(`Trovati ${nNodes} nodi e ${nEdges / 2} archi (non orientati).`);

    // Usiamo array lineari tipizzati per la velocità.
    // L'algoritmo andrà molto più veloce senza lookup di dizionari JS.
    const edgeU = new Int32Array(nEdges);
    const edgeV = new Int32Array(nEdges);
    const edgeCost = new Float64Array(nEdges);

    for (let i = 0; i < nEdges; i++) {
        edgeU[i] = edgesRaw[i].u;
        edgeV[i] = edgesRaw[i].v;
        edgeCost[i] = edgesRaw[i].cost;
    }

    const routingTable = {};

    console.log('Calcolo dei cammini minimi (Bellman-Ford)...');

    // Allocate reuseable arrays per source
    const distance = new Float64Array(nNodes);
    const previous = new Int32Array(nNodes);

    for (let source = 0; source < nNodes; source++) {
        // Inizializzazione Bellman-Ford
        distance.fill(Infinity);
        previous.fill(-1);

        distance[source] = 0;

        // Rilassamento degli archi
        for (let i = 0; i < nNodes - 1; i++) {
            let updated = false;
            for (let e = 0; e < nEdges; e++) {
                const u = edgeU[e];
                const v = edgeV[e];
                const cost = edgeCost[e];

                if (distance[u] !== Infinity && distance[u] + cost < distance[v]) {
                    distance[v] = distance[u] + cost;
                    previous[v] = u;
                    updated = true;
                }
            }
            if (!updated) break;
        }

        const sourceName = nodeIdToName[source];
        routingTable[sourceName] = {};

        // Costruzione della tabella di routing
        for (let dest = 0; dest < nNodes; dest++) {
            if (source === dest) continue;

            if (distance[dest] === Infinity) {
                continue;
            }

            let current = dest;
            let nextHop = -1;
            while (previous[current] !== -1) {
                if (previous[current] === source) {
                    nextHop = current;
                    break;
                }
                current = previous[current];
            }

            if (nextHop !== -1) {
                routingTable[sourceName][nodeIdToName[dest]] = {
                    next_hop: nodeIdToName[nextHop],
                    cost: distance[dest]
                };
            }
        }
    }

    const fd = fs.openSync(OUTPUT_FILE, 'w');
    fs.writeSync(fd, '{\n');
    const sources = Object.keys(routingTable);
    for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        fs.writeSync(fd, `  ${JSON.stringify(src)}: ${JSON.stringify(routingTable[src])}`);
        if (i < sources.length - 1) {
            fs.writeSync(fd, ',\n');
        } else {
            fs.writeSync(fd, '\n');
        }
    }
    fs.writeSync(fd, '}\n');
    fs.closeSync(fd);
}

main();
