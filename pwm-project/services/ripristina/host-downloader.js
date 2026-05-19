const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const { createWriteStream } = require('fs');
const { once } = require('events');

const TARGET_DIR = path.resolve(__dirname, '../../shared/assets');
const TEMP_SUFFIX = '.download';

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

let restoreJob = null;
function createRestoreJob() {
    return {
        state: 'idle',
        phase: 'idle',
        message: 'In attesa di un ripristino.',
        error: null,
        startedAt: null,
        completedAt: null,
        totalBytes: 0,
        completedBytes: 0,
        progressPercent: 0,
        currentFile: null,
        currentFileBytes: 0,
        currentFileTotalBytes: 0,
        files: []
    };
}

function getJobSnapshot() {
    return JSON.parse(JSON.stringify(restoreJob || createRestoreJob()));
}

function setJob(updates) {
    restoreJob = {
        ...(restoreJob || createRestoreJob()),
        ...updates
    };
}

function updateProgress() {
    const totalBytes = restoreJob.totalBytes || 0;
    const completedBytes = restoreJob.completedBytes || 0;
    restoreJob.progressPercent = totalBytes > 0
        ? Math.min(100, Math.round((completedBytes / totalBytes) * 100))
        : 0;
}

function getDownloadedFileName(source, response) {
    const contentDisposition = response.headers.get('content-disposition') || '';
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

async function headContentLength(url) {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });

    if (!response.ok) {
        throw new Error(`HEAD fallita per ${url}: ${response.status} ${response.statusText}`);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    return Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0;
}

async function prepareSources() {
    const files = await Promise.all(
        ASSET_SOURCES.map(async (source) => ({
            ...source,
            totalBytes: await headContentLength(source.url)
        }))
    );

    setJob({
        files: files.map((file) => ({
            name: file.name,
            url: file.url,
            totalBytes: file.totalBytes,
            downloadedBytes: 0,
            progressPercent: 0,
            state: 'pending'
        })),
        totalBytes: files.reduce((sum, file) => sum + (file.totalBytes || 0), 0),
        completedBytes: 0,
        currentFile: null,
        currentFileBytes: 0,
        currentFileTotalBytes: 0,
        progressPercent: 0
    });

    return files;
}

async function downloadFile(source, index) {
    // Determine destination paths and skip early if file already exists to avoid double-counting
    // (check before issuing the HTTP request).
    // We still try to deduce the filename from the URL if possible.
    const tentativeName = path.basename(new URL(source.url).pathname) || `${source.name}`;
    const destinationPath = path.join(TARGET_DIR, tentativeName);
    const tempPath = `${destinationPath}${TEMP_SUFFIX}`;

    await fs.mkdir(path.dirname(destinationPath), { recursive: true });

    const fileState = restoreJob.files[index];

    // If destination already exists, use its size and mark as skipped without downloading.
    try {
        const st = await fs.stat(destinationPath);
        if (st && st.size >= 0) {
            const existingSize = st.size;
            fileState.state = 'skipped';
            // If we don't know the remote totalBytes, use the existing file size so totals align.
            if (!fileState.totalBytes || fileState.totalBytes <= 0) {
                // increase restoreJob.totalBytes so totals are consistent
                restoreJob.totalBytes = (restoreJob.totalBytes || 0) + existingSize;
                fileState.totalBytes = existingSize;
            }
            fileState.downloadedBytes = existingSize;
            fileState.progressPercent = fileState.totalBytes > 0
                ? Math.min(100, Math.round((fileState.downloadedBytes / fileState.totalBytes) * 100))
                : 100;

            restoreJob.completedBytes = (restoreJob.completedBytes || 0) + existingSize;
            updateProgress();
            console.log(`File esistente trovato, salto sovrascrittura: ${destinationPath}`);
            return;
        }
    } catch (e) {
        // file does not exist — continue to download
    }

    // Proceed to download since file is not present
    const response = await fetch(source.url, { redirect: 'follow' });

    if (!response.ok || !response.body) {
        throw new Error(`Download fallito per ${source.name}: ${response.status} ${response.statusText}`);
    }

    const downloadedFileName = getDownloadedFileName(source, response);
    // If the content-disposition suggests a different filename, update destination paths
    const finalDestination = path.join(TARGET_DIR, downloadedFileName);
    const finalTemp = `${finalDestination}${TEMP_SUFFIX}`;

    // Ensure directory and remove any previous temp file for this destination
    await fs.mkdir(path.dirname(finalDestination), { recursive: true });
    await fs.rm(finalTemp, { force: true }).catch(() => {});

    fileState.state = 'downloading';
    restoreJob.currentFile = downloadedFileName;
    restoreJob.currentFileBytes = 0;
    restoreJob.currentFileTotalBytes = source.totalBytes || Number(response.headers.get('content-length') || 0) || 0;

    const fileStream = createWriteStream(finalTemp);
    const reader = response.body.getReader();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            const chunk = Buffer.from(value);
            if (!fileStream.write(chunk)) {
                await once(fileStream, 'drain');
            }

            restoreJob.completedBytes += chunk.length;
            restoreJob.currentFileBytes += chunk.length;
            fileState.downloadedBytes = restoreJob.currentFileBytes;
            fileState.progressPercent = fileState.totalBytes > 0
                ? Math.min(100, Math.round((fileState.downloadedBytes / fileState.totalBytes) * 100))
                : 0;
            updateProgress();
        }

        fileStream.end();
        await once(fileStream, 'finish');

        await fs.rename(finalTemp, finalDestination);

        fileState.state = 'completed';
        fileState.downloadedBytes = fileState.totalBytes || fileState.downloadedBytes;
        fileState.progressPercent = 100;
    } catch (error) {
        fileState.state = 'error';
        fileState.error = error.message;
        fileStream.destroy();
        await fs.rm(finalTemp, { force: true }).catch(() => {});
        throw error;
    }

}

async function restoreAssets() {
    await fs.mkdir(TARGET_DIR, { recursive: true });
    const existingFiles = await fs.readdir(TARGET_DIR);
    await Promise.all(
        existingFiles
            .filter((fileName) => fileName.endsWith(TEMP_SUFFIX))
            .map((fileName) => fs.rm(path.join(TARGET_DIR, fileName), { force: true }))
    );

    const files = await prepareSources();

    // Avvia tutti i download in parallelo (massima parallellizzazione tra le sorgenti)
    const workers = files.map((source, index) => {
        console.log(`Avvio download parallelo ${source.name} da ${source.url}`);
        return downloadFile(source, index).catch((err) => {
            console.error(`Errore download ${source.name}:`, err.message || err);
            // Rilancia per far fallire l'intero restore se desiderato
            throw err;
        });
    });

    await Promise.all(workers);
}

const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    if (req.method === 'GET' && req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getJobSnapshot()));
        return;
    }

    if (req.method !== 'POST' || req.url !== '/restore') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
    }

    try {
        if (restoreJob && restoreJob.state === 'running') {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(getJobSnapshot()));
            return;
        }

        restoreJob = createRestoreJob();
        restoreJob.state = 'running';
        restoreJob.phase = 'preparing';
        restoreJob.message = 'Preparazione download in corso.';
        restoreJob.startedAt = new Date().toISOString();
        restoreJob.completedAt = null;
        restoreJob.error = null;

        console.log('Iniziando il ripristino host-side degli asset...');

        void (async () => {
            try {
                restoreJob.phase = 'downloading';
                await restoreAssets();
                restoreJob.state = 'completed';
                restoreJob.phase = 'completed';
                restoreJob.message = 'Ripristino completato con successo.';
                restoreJob.progressPercent = 100;
                restoreJob.completedAt = new Date().toISOString();
                console.log('Ripristino host-side completato con successo.');
            } catch (error) {
                restoreJob.state = 'error';
                restoreJob.phase = 'error';
                restoreJob.error = error.message;
                restoreJob.message = error.message;
                restoreJob.completedAt = new Date().toISOString();
                console.error('Errore durante il ripristino host-side:', error);
            }
        })();

        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Ripristino avviato.', status: getJobSnapshot() }));
    } catch (error) {
        console.error('Errore durante il ripristino host-side:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
    }
});

const PORT = process.env.PORT || 3011;
server.listen(PORT, () => {
    console.log(`Host downloader in ascolto sulla porta ${PORT}`);
});