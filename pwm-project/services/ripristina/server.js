const express = require('express');
const dns = require('dns');
const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const https = require('https');
const { pipeline } = require('stream/promises');

const app = express();
app.use(express.json());

const TARGET_DIR = path.join(__dirname, 'assets');
const MAP_DIR = path.join(TARGET_DIR, 'map');
const STAGING_DIR = path.join(__dirname, '.restore-staging');

dns.setDefaultResultOrder('ipv4first');

let restoreState = {
    active: false,
    state: 'idle',
    progressPercent: 0,
    currentFile: null,
    currentFileBytes: 0,
    currentFileTotalBytes: 0,
    totalBytes: 0,
    completedBytes: 0,
    files: [],
    message: 'Nessun ripristino in corso.'
};

const ASSET_SOURCES = [
    {
        name: 'ETOPO',
        url: 'https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif'
    },
    {
        name: 'lc_md12',
        url: 'https://zenodo.org/records/8367523/files/lc_mcd12q1v061.t1_c_500m_s_20210101_20211231_go_epsg.4326_v20230818.tif?download=1'
    }
];

function getDownloadedFileName(source, response) {
    const contentDisposition = response.headers['content-disposition'] || '';
    const match = contentDisposition.match(/filename\*=(?:UTF-8'')?([^;]+)|filename="?([^";]+)"?/i);
    const headerFileName = match && (match[1] || match[2]);

    if (headerFileName) {
        return decodeURIComponent(headerFileName.trim().replace(/^['"]|['"]$/g, ''));
    }

    const urlName = path.basename(new URL(source.url).pathname);
    if (urlName) {
        return urlName;
    }

    throw new Error(`Impossibile determinare il nome file per ${source.name}`);
}

function downloadAsset(source, redirectDepth = 0) {
    const MAX_REDIRECTS = 5;

    // Check if it already exists in MAP_DIR to speed up
    const urlName = path.basename(new URL(source.url).pathname);
    const existingPath = path.join(MAP_DIR, urlName);
    try {
        const stats = fs.statSync(existingPath);
        if (stats.size > 10 * 1024 * 1024) { // > 10MB
            console.log(`Skipping download, file already exists in MAP_DIR: ${urlName}`);
            restoreState.totalBytes += stats.size;
            restoreState.completedBytes += stats.size;
            if (restoreState.totalBytes > 0) {
                restoreState.progressPercent = Math.floor((restoreState.completedBytes / restoreState.totalBytes) * 100);
            }
            const currentFileObj = restoreState.files.find(f => f.name === source.name);
            if (currentFileObj) {
                currentFileObj.progressPercent = 100;
            }
            // Copy it to staging dir so it gets moved later without breaking the flow
            fs.copySync(existingPath, path.join(STAGING_DIR, urlName));
            return Promise.resolve(path.join(STAGING_DIR, urlName));
        }
    } catch (err) {
        // File does not exist, proceed with download
    }

    return new Promise((resolve, reject) => {
        const requestUrl = new URL(source.url);
        const transport = requestUrl.protocol === 'http:' ? http : https;

        const request = transport.request(
            requestUrl,
            {
                method: 'GET',
                headers: {
                    'User-Agent': 'PWM-Restore/1.0',
                    Accept: '*/*'
                },
                family: 4,
            },
            async (response) => {
                const statusCode = response.statusCode || 0;

                if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
                    if (redirectDepth >= MAX_REDIRECTS) {
                        reject(new Error(`Troppi redirect durante il download di ${source.name}`));
                        response.resume();
                        return;
                    }

                    response.resume();
                    const redirectedSource = {
                        ...source,
                        url: new URL(response.headers.location, requestUrl).toString()
                    };

                    resolve(downloadAsset(redirectedSource, redirectDepth + 1));
                    return;
                }

                if (statusCode !== 200) {
                    reject(new Error(`Download fallito per ${source.name}: ${statusCode} ${response.statusMessage || ''}`.trim()));
                    response.resume();
                    return;
                }

                const contentLength = parseInt(response.headers['content-length'] || '0', 10);
                restoreState.currentFileTotalBytes = contentLength;
                restoreState.totalBytes += contentLength;

                const downloadedFileName = getDownloadedFileName(source, response);
                const destinationPath = path.join(STAGING_DIR, downloadedFileName);

                try {
                    await fs.ensureDir(path.dirname(destinationPath));
                    const fileStream = fs.createWriteStream(destinationPath);
                    
                    response.on('data', (chunk) => {
                        restoreState.currentFileBytes += chunk.length;
                        restoreState.completedBytes += chunk.length;
                        if (restoreState.totalBytes > 0) {
                            restoreState.progressPercent = Math.floor((restoreState.completedBytes / restoreState.totalBytes) * 100);
                        }
                        const currentFileObj = restoreState.files.find(f => f.name === source.name);
                        if (currentFileObj && restoreState.currentFileTotalBytes > 0) {
                            currentFileObj.progressPercent = Math.floor((restoreState.currentFileBytes / restoreState.currentFileTotalBytes) * 100);
                        }
                    });

                    await pipeline(response, fileStream);
                    resolve(destinationPath);
                } catch (error) {
                    reject(error);
                }
            }
        );

        request.on('error', reject);
        request.setTimeout(0);
        request.end();
    });
}

app.post('/restore', (req, res) => {
    if (restoreState.active) {
        return res.status(409).json({ success: false, message: 'Un ripristino è già in corso.' });
    }

    restoreState = {
        active: true,
        state: 'downloading',
        progressPercent: 0,
        currentFile: null,
        currentFileBytes: 0,
        currentFileTotalBytes: 0,
        totalBytes: 0,
        completedBytes: 0,
        files: ASSET_SOURCES.map(s => ({ name: s.name, url: s.url, progressPercent: 0 })),
        message: 'Inizio download...'
    };

    // Run async
    (async () => {
        try {
            console.log('Iniziando il ripristino degli asset in parallelo...');
            await fs.emptyDir(STAGING_DIR);

            await Promise.all(ASSET_SOURCES.map(source => {
                console.log(`Avvio scaricamento ${source.name} da ${source.url}`);
                return downloadAsset(source);
            }));

            restoreState.message = 'Download completato, spostamento file...';
            await fs.ensureDir(MAP_DIR);

            // Wipe SOLO dei raster ETOPO e lc_mcd12
            const mapFiles = await fs.readdir(MAP_DIR).catch(() => []);
            for (const file of mapFiles) {
                if (file.startsWith('ETOPO') || file.startsWith('lc_mcd12')) {
                    await fs.remove(path.join(MAP_DIR, file));
                }
            }

            // Sposta i nuovi file dal folder di staging al folder map
            const stagedFiles = await fs.readdir(STAGING_DIR);
            for (const file of stagedFiles) {
                await fs.copy(path.join(STAGING_DIR, file), path.join(MAP_DIR, file));
            }

            await fs.remove(STAGING_DIR);

            restoreState.state = 'completed';
            restoreState.progressPercent = 100;
            restoreState.message = 'Ripristino completato con successo.';
            restoreState.active = false;
            console.log('Ripristino completato con successo.');
        } catch (error) {
            console.error('Errore durante il ripristino:', error);
            restoreState.state = 'error';
            restoreState.message = `Errore: ${error.message}`;
            restoreState.active = false;
        }
    })();

    res.status(202).json({ success: true, message: 'Ripristino avviato in background.' });
});

app.get('/status', (req, res) => {
    res.json(restoreState);
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servizio di ripristino in ascolto sulla porta ${PORT}`);
});