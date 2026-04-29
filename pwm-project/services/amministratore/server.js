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
        // Call the ripristina service
        const response = await axios.post('http://ripristina:3000/restore');
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint per riavviare tutti i container
app.post('/api/restart-all', async (req, res) => {
    try {
        const containers = await docker.listContainers();
        
        // Rispondiamo al client prima di iniziare la sequenza di riavvio, 
        // specialmente per non lasciare la richiesta appesa quando questo container si riavvierà.
        res.json({ success: true, message: 'Riavvio globale in corso...' });

        // Asincrono: riavviamo prima gli altri container, infine se stesso
        setTimeout(async () => {
            let adminContainerId = null;
            
            for (const c of containers) {
                if (c.Names[0].includes('amministratore')) {
                    adminContainerId = c.Id;
                    continue; // Rimandiamo alla fine
                }
                try {
                    const container = docker.getContainer(c.Id);
                    await container.restart();
                } catch (e) { 
                    console.error(`Errore rinvio container ${c.Names[0]}:`, e.message); 
                }
            }

            // Riavvia l'amministratore come ultimo container
            if (adminContainerId) {
                try {
                    const adminContainer = docker.getContainer(adminContainerId);
                    await adminContainer.restart();
                } catch (e) {}
            }
        }, 500);

    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

const PORT = 8080;
app.listen(PORT, () => {
    console.log(`Amministratore in esecuzione sulla porta ${PORT}`);
});