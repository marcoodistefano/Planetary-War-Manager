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
const STAGING_DIR = path.join(__dirname, '.restore-staging');

dns.setDefaultResultOrder('ipv4first');

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

                const downloadedFileName = getDownloadedFileName(source, response);
                const destinationPath = path.join(STAGING_DIR, downloadedFileName);

                try {
                    await fs.ensureDir(path.dirname(destinationPath));
                    const fileStream = fs.createWriteStream(destinationPath);
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

app.post('/restore', async (req, res) => {
    try {
        console.log('Iniziando il ripristino degli asset...');

        await fs.emptyDir(STAGING_DIR);

        for (const source of ASSET_SOURCES) {
            console.log(`Scaricamento ${source.name} da ${source.url}`);

            await downloadAsset(source);
        }

        await fs.emptyDir(TARGET_DIR);
        await fs.copy(STAGING_DIR, TARGET_DIR);
        await fs.remove(STAGING_DIR);

        console.log('Ripristino completato con successo.');
        res.json({ success: true, message: 'Ripristino completato con successo.' });
    } catch (error) {
        console.error('Errore durante il ripristino:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servizio di ripristino in ascolto sulla porta ${PORT}`);
});