const express = require('express');
const Docker = require('dockerode');
const path = require('path');
const axios = require('axios');
const cors = require('cors');

const app = express();
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SECRET = 'PWM{Th1s_1s_Y0UR_F1rs7_Fl4g!}';

// Autenticazione Form
app.post('/api/login', (req, res) => {
    if (req.body.password === SECRET) {
        res.json({ success: true, token: SECRET });
    } else {
        res.status(401).json({ error: 'Password errata' });
    }
});

// Middleware per proteggere le chiamate /api/*
app.use('/api', (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    if (authHeader === `Bearer ${SECRET}`) {
        return next();
    }
    res.status(401).json({ error: 'Non autorizzato' });
});

// Storia delle performance per le ultime 24 ore
const statsHistory = {};
const MAX_HISTORY_POINTS = 1440; // 24 ore * 60 minuti
const RESTORE_HELPER_URL = process.env.RESTORE_HELPER_URL || 'http://host.docker.internal:3011';

const restoreState = {
    active: false,
    phase: 'idle',
    message: 'In attesa di un ripristino.',
    error: null,
    progress: 0,
    currentFile: null,
    currentFileBytes: 0,
    currentFileTotalBytes: 0,
    totalBytes: 0,
    completedBytes: 0,
    files: [],
    startedAt: null,
    completedAt: null
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function snapshotRestoreState() {
    return JSON.parse(JSON.stringify(restoreState));
}

async function getHelperStatus() {
    const response = await axios.get(`${RESTORE_HELPER_URL}/status`);
    return response.data;
}

async function restartProjectContainers({ includeAdmin = false } = {}) {
    const allContainers = await docker.listContainers();
    const projectContainers = allContainers.filter(c => c.Names[0].replace('/', '').startsWith('pwm-'));

    let adminContainerId = null;

    for (const c of projectContainers) {
        if (c.Names[0].includes('amministratore')) {
            adminContainerId = c.Id;
            if (!includeAdmin) {
                continue;
            }
        }

        if (!includeAdmin && c.Names[0].includes('amministratore')) {
            continue;
        }

        try {
            const container = docker.getContainer(c.Id);
            await container.restart();
        } catch (error) {
            console.error(`Errore riavvio ${c.Names[0]}:`, error.message);
        }
    }

    if (includeAdmin && adminContainerId) {
        try {
            const admin = docker.getContainer(adminContainerId);
            await admin.restart();
        } catch (error) {
            console.error('Errore riavvio amministratore:', error.message);
        }
    }

    return projectContainers.length;
}

async function runRestoreWorkflow() {
    restoreState.active = true;
    restoreState.phase = 'starting';
    restoreState.message = 'Avvio ripristino in corso.';
    restoreState.error = null;
    restoreState.startedAt = new Date().toISOString();
    restoreState.completedAt = null;

    try {
        await axios.post(`${RESTORE_HELPER_URL}/restore`);
        restoreState.phase = 'downloading';

        while (true) {
            const helperStatus = await getHelperStatus();

            restoreState.progress = helperStatus.progressPercent || 0;
            restoreState.currentFile = helperStatus.currentFile || null;
            restoreState.currentFileBytes = helperStatus.currentFileBytes || 0;
            restoreState.currentFileTotalBytes = helperStatus.currentFileTotalBytes || 0;
            restoreState.totalBytes = helperStatus.totalBytes || 0;
            restoreState.completedBytes = helperStatus.completedBytes || 0;
            restoreState.files = helperStatus.files || [];
            restoreState.message = helperStatus.message || 'Download in corso.';

            if (helperStatus.state === 'completed') {
                break;
            }

            if (helperStatus.state === 'error') {
                throw new Error(helperStatus.error || 'Ripristino fallito');
            }

            await sleep(1000);
        }

        restoreState.phase = 'restarting';
        restoreState.message = 'Download completati, riavvio dei container in corso.';

        await restartProjectContainers({ includeAdmin: false });

        restoreState.phase = 'completed';
        restoreState.active = false;
        restoreState.progress = 100;
        restoreState.completedAt = new Date().toISOString();
        restoreState.message = 'Ripristino completato con successo.';
    } catch (error) {
        restoreState.phase = 'error';
        restoreState.active = false;
        restoreState.error = error.message;
        restoreState.message = error.message;
        restoreState.completedAt = new Date().toISOString();
        throw error;
    }
}

async function fetchAndStoreStats() {
    try {
        const containers = await docker.listContainers();
        const now = new Date().toISOString();
        
        for (const c of containers) {
            const container = docker.getContainer(c.Id);
            const name = c.Names[0].replace('/', '');
            
            try {
                const stats = await container.stats({ stream: false });
                
                // Calculate CPU percent
                const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
                const systemCpuDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
                const numberCpus = stats.cpu_stats.online_cpus || 1;
                let cpuPercent = 0.0;
                if (systemCpuDelta > 0 && cpuDelta > 0) {
                    cpuPercent = (cpuDelta / systemCpuDelta) * numberCpus * 100.0;
                }

                // Calculate Memory percent
                const memUsage = stats.memory_stats.usage;
                const memLimit = stats.memory_stats.limit;
                const memPercent = memLimit > 0 ? (memUsage / memLimit) * 100.0 : 0.0;

                if (!statsHistory[name]) {
                    statsHistory[name] = [];
                }
                
                statsHistory[name].push({
                    time: now,
                    cpu: parseFloat(cpuPercent.toFixed(2)),
                    memory: parseFloat(memPercent.toFixed(2))
                });
                
                // Keep only last 24h
                if (statsHistory[name].length > MAX_HISTORY_POINTS) {
                    statsHistory[name].shift();
                }
            } catch (err) {
                // Ignore stopped containers stats fetch error
            }
        }
    } catch (error) {
        console.error('Error fetching stats:', error);
    }
}

// Fetch stats every minute
setInterval(fetchAndStoreStats, 60000);
// Initial fetch
fetchAndStoreStats();

app.get('/api/containers', async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        res.json(containers.map(c => ({
            id: c.Id,
            name: c.Names[0].replace('/', ''),
            state: c.State,
            status: c.Status
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/containers/:id/:action', async (req, res) => {
    try {
        const { id, action } = req.params;
        const container = docker.getContainer(id);
        if (action === 'start') await container.start();
        else if (action === 'stop') await container.stop();
        else if (action === 'restart') await container.restart();
        else return res.status(400).json({ error: 'Azione non valida' });
        
        res.json({ success: true, message: `Container ${id} ${action}ed` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Stats API
app.get('/api/stats', async (req, res) => {
    try {
        const containers = await docker.listContainers();
        const statsPromises = containers.map(async (c) => {
            const container = docker.getContainer(c.Id);
            const stats = await container.stats({ stream: false });
            
            // Calculate CPU percent
            const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
            const systemCpuDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
            const numberCpus = stats.cpu_stats.online_cpus || 1;
            let cpuPercent = 0.0;
            if (systemCpuDelta > 0 && cpuDelta > 0) {
                cpuPercent = (cpuDelta / systemCpuDelta) * numberCpus * 100.0;
            }

            // Calculate Memory percent
            const memUsage = stats.memory_stats.usage;
            const memLimit = stats.memory_stats.limit;
            const memPercent = memLimit > 0 ? (memUsage / memLimit) * 100.0 : 0.0;

            return {
                name: c.Names[0].replace('/', ''),
                cpu: cpuPercent.toFixed(2),
                memory: memPercent.toFixed(2),
                memUsage: (memUsage / 1024 / 1024).toFixed(2) + ' MB'
            };
        });
        const stats = await Promise.all(statsPromises);
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint per ottenere la cronologia delle stats
app.get('/api/stats/history', (req, res) => {
    res.json(statsHistory);
});

// Restore trigger
app.post('/api/restore', async (req, res) => {
    try {
        if (restoreState.active) {
            return res.status(409).json({ success: false, message: 'Un ripristino è già in corso.', status: snapshotRestoreState() });
        }

        runRestoreWorkflow().catch((error) => {
            console.error('Errore workflow restore:', error.message);
        });

        res.status(202).json({
            success: true,
            message: 'Ripristino avviato.',
            status: snapshotRestoreState()
        });
    } catch (error) {
        if (error.response) {
            return res.status(error.response.status).json(error.response.data);
        }

        res.status(500).json({ error: error.message });
    }
});

app.get('/api/restore/status', async (req, res) => {
    try {
        // If our local restoreState is active, prefer it; otherwise fetch helper status
        if (restoreState.active) {
            return res.json(snapshotRestoreState());
        }

        const helperStatus = await getHelperStatus();

        const mapped = {
            active: helperStatus.state === 'running' || helperStatus.phase === 'downloading',
            phase: helperStatus.phase || helperStatus.state || 'idle',
            message: helperStatus.message || 'In attesa di un ripristino.',
            error: helperStatus.error || null,
            progress: helperStatus.progressPercent || helperStatus.progress || 0,
            currentFile: helperStatus.currentFile || null,
            currentFileBytes: helperStatus.currentFileBytes || 0,
            currentFileTotalBytes: helperStatus.currentFileTotalBytes || 0,
            totalBytes: helperStatus.totalBytes || 0,
            completedBytes: helperStatus.completedBytes || 0,
            files: helperStatus.files || [],
            startedAt: helperStatus.startedAt || null,
            completedAt: helperStatus.completedAt || null
        };

        return res.json(mapped);
    } catch (error) {
        return res.json(snapshotRestoreState());
    }
});

// Endpoint per riavviare tutti i container
app.post('/api/restart-all', async (req, res) => {
    try {
        // Recuperiamo tutti i container
        const allContainers = await docker.listContainers();
        
        // Filtriamo solo quelli che appartengono al progetto
        const projectContainers = allContainers.filter(c => 
            c.Names[0].replace('/', '').startsWith('pwm-')
        );

        res.json({ success: true, message: `Riavvio di ${projectContainers.length} unità PWM in corso...` });

        setTimeout(async () => {
            let adminContainerId = null;
            
            for (const c of projectContainers) {
                if (c.Names[0].includes('amministratore')) {
                    adminContainerId = c.Id;
                    continue; 
                }
                try {
                    const container = docker.getContainer(c.Id);
                    await container.restart();
                } catch (e) { 
                    console.error(`Errore riavvio ${c.Names[0]}:`, e.message); 
                }
            }

            if (adminContainerId) {
                try {
                    const admin = docker.getContainer(adminContainerId);
                    await admin.restart();
                } catch (e) {}
            }
        }, 500);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = 8080;
app.listen(PORT, () => {
    console.log(`Amministratore in esecuzione sulla porta ${PORT}`);
});