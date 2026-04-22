const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');
const GeoTIFF = require('geotiff');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const redis = new Redis();

const SECRET_KEY = "MIA_CHIAVE_SEGRETA_2026"; // CHIAVE UNIFICATA

// --- CARICAMENTO TIFF (Invariato) ---
const ETOPO_PATH = path.join(__dirname, 'assets', 'ETOPO_2022_v1_60s_N90W180_surface.tif');
const LANDCOVER_PATH = path.join(__dirname, 'assets', 'lc_mcd12q1v061.t1_c_500m_s_20210101_20211231_go_epsg.4326_v20230818.tif');
let etopoImage, lcImage, etopoBbox, lcBbox, etopoWidth, etopoHeight, lcWidth, lcHeight;

async function initTiffs() {
    try {
        const etopoTiff = await GeoTIFF.fromFile(ETOPO_PATH);
        etopoImage = await etopoTiff.getImage();
        etopoBbox = etopoImage.getBoundingBox();
        etopoWidth = etopoImage.getWidth(); etopoHeight = etopoImage.getHeight();
        const lcTiff = await GeoTIFF.fromFile(LANDCOVER_PATH);
        lcImage = await lcTiff.getImage();
        lcBbox = lcImage.getBoundingBox();
        lcWidth = lcImage.getWidth(); lcHeight = lcImage.getHeight();
    } catch (err) { console.error("Errore TIFF:", err.message); }
}

async function getPointData(lng, lat) {
    if (!etopoImage || !lcImage) return { altitude: 0, biomeId: 0 };
    try {
        const xE = Math.floor(((lng - etopoBbox[0]) / (etopoBbox[2] - etopoBbox[0])) * etopoWidth);
        const yE = Math.floor(((etopoBbox[3] - lat) / (etopoBbox[3] - etopoBbox[1])) * etopoHeight);
        const etopoRaster = await etopoImage.readRasters({ window: [xE, yE, xE + 1, yE + 1] });
        const xL = Math.floor(((lng - lcBbox[0]) / (lcBbox[2] - lcBbox[0])) * lcWidth);
        const yL = Math.floor(((lcBbox[3] - lat) / (lcBbox[3] - lcBbox[1])) * lcHeight);
        const lcRaster = await lcImage.readRasters({ window: [xL, yL, xL + 1, yL + 1] });
        return { altitude: etopoRaster[0][0], biomeId: lcRaster[0][0] };
    } catch (e) { return { altitude: 0, biomeId: 0 }; }
}

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        socket.userId = decoded.id_user;
        next();
    } catch (err) { next(new Error("Auth Error")); }
});

io.on('connection', (socket) => {
    socket.join(`user_${socket.userId}`);
    socket.on('query_point', async (c) => { socket.emit('point_data', await getPointData(c.lng, c.lat)); });

    socket.on('crea_truppe_batch', async (data) => {
        const { partitaId, truppe } = data;
        const pipeline = redis.pipeline();
        truppe.forEach(t => {
            // Validazione coordinate per Redis (Max +/- 85 lat)
            const lat = Math.max(-85, Math.min(85, t.y));
            pipeline.hset(`truppa:${t.id_truppa}`, { user_id: socket.userId, x: t.x, y: lat, alt: t.alt, tipo: 'tank', hp: 100, stato: 1, speed: 1.5 });
            pipeline.geoadd(`mappa:${partitaId}`, t.x, lat, t.id_truppa);
            pipeline.sadd(`modificati:${partitaId}`, t.id_truppa);
        });
        await pipeline.exec();
        io.to(`user_${socket.userId}`).emit('truppe_batch_update', truppe);
    });

    socket.on('svuota_truppe_test', async (d) => {
        const ids = await redis.zrange(`mappa:${d.partitaId}`, 0, -1);
        if (ids.length > 0) await redis.del(...ids.map(i => `truppa:${i}`), `mappa:${d.partitaId}`, `modificati:${d.partitaId}`);
    });
});

initTiffs().then(() => server.listen(3000, () => console.log("🟢 Server Pronto")));