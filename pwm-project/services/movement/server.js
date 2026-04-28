import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import { fromFile } from 'geotiff'; // Importazione diretta consigliata
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';

// 1. Configurazione Percorsi ed ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Definisci i percorsi PRIMA di usarli
const ETOPO_PATH = '/app/assets/ETOPO_2022_v1_60s_N90W180_surface.tif';
const LANDCOVER_PATH = '/app/assets/lc_mcd12q1v061.t1_c_500m_s_20210101_20211231_go_epsg.4326_v20230818.tif';

// 2. Inizializzazione Express e Socket.io
const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*" },
    connectionStateRecovery: {} // Opzionale: utile per recuperare connessioni instabili
});

// 3. Connessioni esterne
const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');
const SECRET_KEY = process.env.SECRET_KEY || "MIA_CHIAVE_SEGRETA_2026"; 

// 4. Gestione GeoTIFF
let etopoImage, lcImage, etopoBbox, lcBbox, etopoWidth, etopoHeight, lcWidth, lcHeight;

async function initTiffs() {
    try {
        console.log("⏳ Caricamento file GeoTIFF...");
        
        const etopoTiff = await fromFile(ETOPO_PATH);
        etopoImage = await etopoTiff.getImage();
        etopoBbox = etopoImage.getBoundingBox();
        etopoWidth = etopoImage.getWidth(); 
        etopoHeight = etopoImage.getHeight();

        const lcTiff = await fromFile(LANDCOVER_PATH);
        lcImage = await lcTiff.getImage();
        lcBbox = lcImage.getBoundingBox();
        lcWidth = lcImage.getWidth(); 
        lcHeight = lcImage.getHeight();

        console.log("✅ Dati GeoTIFF caricati correttamente in Engine-Move");
    } catch (err) { 
        console.error("⚠️ Errore critico nel caricamento dei TIFF:", err.message);
        // Nota: non interrompiamo il processo, ma getPointData restituirà valori di default
    }
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
    } catch (e) { 
        return { altitude: 0, biomeId: 0 }; 
    }
}

// 5. Middleware Auth
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Token mancante"));
    
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        socket.userId = decoded.id_user;
        next();
    } catch (err) { 
        next(new Error("Auth Error: Token non valido")); 
    }
});

// 6. Logica Socket.io
io.on('connection', (socket) => {
    console.log(`👤 Utente connesso: ${socket.userId}`);
    socket.join(`user_${socket.userId}`);

    socket.on('query_point', async (c) => { 
        socket.emit('point_data', await getPointData(c.lng, c.lat)); 
    });

    socket.on('crea_truppe_batch', async (data) => {
        const { partitaId, truppe } = data;
        const pipeline = redis.pipeline();
        truppe.forEach(t => {
            const lat = Math.max(-85, Math.min(85, t.y));
            pipeline.hset(`truppa:${t.id_truppa}`, { 
                user_id: socket.userId, 
                x: t.x, 
                y: lat, 
                alt: t.alt || 0, 
                tipo: 'tank', 
                hp: 100, 
                stato: 1, 
                speed: 1.5, 
                att: t.attitudine || 1
            });
            pipeline.geoadd(`mappa:${partitaId}`, t.x, lat, t.id_truppa);
            pipeline.sadd(`modificati:${partitaId}`, t.id_truppa);
        });
        await pipeline.exec();
        io.to(`user_${socket.userId}`).emit('truppe_batch_update', truppe);
    });

    socket.on('svuota_truppe_test', async (d) => {
        const ids = await redis.zrange(`mappa:${d.partitaId}`, 0, -1);
        if (ids.length > 0) {
            await redis.del(...ids.map(i => `truppa:${i}`), `mappa:${d.partitaId}`, `modificati:${d.partitaId}`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`🔌 Utente disconnesso: ${socket.userId}`);
    });
});

app.get('/', (req, res) => res.send('Engine Move in esecuzione ✅'));

// 7. Avvio Server dopo caricamento asset
initTiffs().then(() => {
    server.listen(3000, '0.0.0.0', () => {
        console.log("🟢 Engine-Move Pronto sulla porta 3000 (Docker Network)");
    });
});