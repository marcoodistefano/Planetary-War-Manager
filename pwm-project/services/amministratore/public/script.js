const PROJECT_PREFIX = 'pwm-'; // Filtro per i container del progetto
const token = localStorage.getItem('adminToken');
const charts = {};
let restorePollTimer = null;

if (!token) window.location.href = '/login.html';

// Intercettore Token per API
const originalFetch = window.fetch;
window.fetch = async function() {
    let [resource, config] = arguments;
    if (!config) config = {};
    if (!config.headers) config.headers = {};
    if (typeof resource === 'string' && resource.startsWith('/api/')) {
        config.headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await originalFetch(resource, config);
    if (response.status === 401) {
        localStorage.removeItem('adminToken');
        window.location.href = '/login.html';
    }
    return response;
};

async function updateDashboard() {
    try {
        const containersRes = await fetch('/api/containers');
        let containers = await containersRes.json();

        // FILTRO CRUCIALE: Mostra solo i container del progetto
        containers = containers.filter(c => c.name.toLowerCase().startsWith(PROJECT_PREFIX));
        
        document.getElementById('active-count').innerText = `${containers.length} UNITÀ ATTIVE`;

        const statsRes = await fetch('/api/stats');
        const stats = await statsRes.json();
        const statsMap = Object.fromEntries(stats.map(s => [s.name, s]));

        const histRes = await fetch('/api/stats/history');
        const historyData = await histRes.json();

        const grid = document.getElementById('containers-grid');
        
        containers.forEach(c => {
            const stat = statsMap[c.name] || { cpu: 0, memory: 0, memUsage: '0 MB' };
            const isRunning = c.state === 'running';
            let card = document.getElementById(`card-${c.id}`);

            if (!card) {
                card = document.createElement('div');
                card.id = `card-${c.id}`;
                card.className = "card";
                card.innerHTML = `
                    <h3 style="color:var(--neon-blue)">${c.name.toUpperCase()}</h3>
                    <div class="stats-text" style="font-size:0.85em; margin-bottom:10px;"></div>
                    <div class="chart-container"><canvas id="chart-${c.name}"></canvas></div>
                    <div class="actions" style="margin-top:15px; display:flex; gap:10px;"></div>
                `;
                grid.appendChild(card);
            }

            card.querySelector('.stats-text').innerHTML = `
                STATUS: <span style="color:${isRunning ? 'var(--neon-green)' : 'var(--neon-red)'}">${c.state.toUpperCase()}</span><br>
                UPTIME: <span style="color:var(--text)">${c.status}</span><br> 
                LOAD: CPU ${stat.cpu}% | RAM ${stat.memUsage}
            `;

            card.querySelector('.actions').innerHTML = `
                <button class="btn btn-outline" style="font-size:0.7em" onclick="azione('${c.id}', 'restart')">REBOOT</button>
                <button class="btn btn-red" style="font-size:0.7em" onclick="azione('${c.id}', 'stop')" ${!isRunning ? 'disabled' : ''}>ABORT</button>
            `;

            renderChart(c.name, historyData[c.name] || []);
        });
    } catch(e) { console.error("Errore Dashboard:", e); }
}

function renderChart(name, history) {
    const ctx = document.getElementById(`chart-${name}`);
    if (!ctx) return;

    const labels = history.map(h => new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    
    // Estrazione di entrambi i flussi di dati
    const cpuData = history.map(h => h.cpu);
    const ramData = history.map(h => h.memory);

    if (charts[name]) {
        charts[name].data.labels = labels;
        charts[name].data.datasets[0].data = cpuData;
        charts[name].data.datasets[1].data = ramData;
        charts[name].update('none');
    } else {
        charts[name] = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'CPU %',
                        data: cpuData,
                        borderColor: '#00f2ff', // Celeste
                        backgroundColor: 'rgba(0, 242, 255, 0.1)',
                        fill: true,
                        tension: 0.4,
                        borderWidth: 2,
                        pointRadius: 0
                    },
                    {
                        label: 'RAM %',
                        data: ramData,
                        borderColor: '#ff2e63', // Rosso
                        backgroundColor: 'transparent',
                        fill: false,
                        tension: 0.4,
                        borderWidth: 2,
                        borderDash: [5, 5], // Linea tratteggiata per distinguere la RAM
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true, // Fondamentale per seguire il CSS
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { 
                        display: true, // Mantieni gli assi per la leggibilità ma piccoli
                        beginAtZero: true, 
                        max: 100,
                        ticks: { font: { size: 8 }, color: '#8892b0' },
                        grid: { color: 'rgba(255, 255, 255, 0.03)' }
                    },
                    x: { display: false }
                }
            }
        });
    }
}

// ... resto della logica (azione, updateDashboard, etc.) ...

async function azione(id, act) { 
    await fetch(`/api/containers/${id}/${act}`, { method: 'POST' }); 
    setTimeout(updateDashboard, 1500); 
}

function setGlobalFeedback(message, kind = 'info') {
    const feedback = document.getElementById('global-feedback');
    if (!feedback) return;

    feedback.className = `action-feedback is-${kind}`;
    feedback.textContent = message;
}

function renderRestoreStatus(status) {
    const label = document.getElementById('restore-progress-label');
    const percent = document.getElementById('restore-progress-percent');
    const bar = document.getElementById('restore-progress-bar');
    const detail = document.getElementById('restore-progress-detail');
    const filesList = document.getElementById('restore-files-list');

    if (!label || !percent || !bar || !detail) {
        return;
    }

    const phase = status.phase || status.state || 'idle';
    const progress = Math.max(0, Math.min(100, Number(status.progressPercent ?? status.progress ?? 0)));
    const currentFile = status.currentFile || 'Nessun file attivo';
    const currentBytes = Number(status.currentFileBytes || 0);
    const currentTotal = Number(status.currentFileTotalBytes || 0);
    const totalBytes = Number(status.totalBytes || 0);
    const completedBytes = Number(status.completedBytes || 0);
    const files = status.files || [];

    // Protezione: non mostrare completedBytes maggiore di totalBytes
    const cappedCompleted = totalBytes > 0 ? Math.min(completedBytes, totalBytes) : completedBytes;

    bar.style.width = `${progress}%`;
    percent.textContent = `${progress}%`;

    if (phase === 'downloading') {
        label.textContent = 'Download in corso';
        // Render per-file bars if multiple
            if (files.length > 0) {
            filesList.innerHTML = '';
            files.forEach(f => {
                const fp = Math.max(0, Math.min(100, Number(f.progressPercent ?? 0)));
                const entry = document.createElement('div');
                entry.className = 'file-entry';
                entry.innerHTML = `
                    <div class="file-label">${f.name || f.url}</div>
                    <div class="file-track"><div class="file-bar" style="width:${fp}%"></div></div>
                    <div class="file-percent">${fp}%</div>
                `;
                filesList.appendChild(entry);
            });

            detail.textContent = `Totale: ${totalBytes > 0 ? `${Math.round(cappedCompleted / 1024 / 1024)} MB / ${Math.round(totalBytes / 1024 / 1024)} MB` : `${progress}%`}.`;
        } else {
            filesList.innerHTML = '';
            const filePercent = currentTotal > 0 ? Math.round((currentBytes / currentTotal) * 100) : 0;
            detail.textContent = `${currentFile} - ${filePercent}% file. Totale: ${totalBytes > 0 ? `${Math.round(cappedCompleted / 1024 / 1024)} MB / ${Math.round(totalBytes / 1024 / 1024)} MB` : `${progress}%`}.`;
        }
    } else if (phase === 'restarting') {
        label.textContent = 'Riavvio container in corso';
        detail.textContent = 'I download sono terminati. I container PWM vengono riavviati automaticamente.';
    } else if (phase === 'completed') {
        label.textContent = 'Tutti i file ripristinati';
        detail.textContent = 'Download e riavvio completati.';
        filesList.innerHTML = '';
    } else if (phase === 'error') {
        label.textContent = 'Ripristino fallito';
        detail.textContent = status.error || 'Si è verificato un errore durante il ripristino.';
    } else if (phase === 'starting') {
        label.textContent = 'Avvio ripristino';
        detail.textContent = status.message || 'Preparazione download in corso.';
    } else {
        label.textContent = 'Nessun ripristino in corso';
        detail.textContent = status.message || 'Premi Wipe & Restore per avviare il processo.';
        filesList.innerHTML = '';
    }
}

function stopRestorePolling() {
    if (restorePollTimer) {
        clearTimeout(restorePollTimer);
        restorePollTimer = null;
    }
}

async function fetchRestoreStatus() {
    const response = await fetch('/api/restore/status');
    if (!response.ok) {
        throw new Error('Impossibile leggere lo stato del ripristino');
    }

    return response.json();
}

async function pollRestoreStatus() {
    try {
        const status = await fetchRestoreStatus();
        renderRestoreStatus(status);

        if (status.phase === 'completed') {
            stopRestorePolling();
            setGlobalFeedback('Ripristino completato e container riavviati.', 'success');
            const button = document.getElementById('restore-all-btn');
            if (button) {
                button.disabled = false;
                button.textContent = '🔥 Wipe & Restore';
            }
            setTimeout(updateDashboard, 1500);
            return;
        }

        if (status.phase === 'error') {
            stopRestorePolling();
            setGlobalFeedback(status.error || 'Ripristino fallito.', 'error');
            const button = document.getElementById('restore-all-btn');
            if (button) {
                button.disabled = false;
                button.textContent = '🔥 Wipe & Restore';
            }
            return;
        }

        restorePollTimer = setTimeout(pollRestoreStatus, 1000);
    } catch (error) {
        stopRestorePolling();
        setGlobalFeedback(error.message || 'Impossibile leggere il progresso del ripristino.', 'error');
        const button = document.getElementById('restore-all-btn');
        if (button) {
            button.disabled = false;
            button.textContent = '🔥 Wipe & Restore';
        }
    }
}

async function riavviaTutti() {
    const button = document.getElementById('restart-all-btn');

    if (button) {
        button.disabled = true;
        button.textContent = '⏳ Riavvio in corso...';
    }

    setGlobalFeedback('Riavvio globale avviato: i container PWM verranno riavviati in sequenza.', 'info');

    try {
        const response = await fetch('/api/restart-all', { method: 'POST' });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Riavvio globale fallito');
        }

        setGlobalFeedback('Riavvio globale completato con successo.', 'success');
        setTimeout(updateDashboard, 1500);
    } catch (error) {
        setGlobalFeedback(error.message || 'Riavvio globale fallito.', 'error');
        throw error;
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = '🔄 Riavvio Globale';
        }
    }
}

async function ripristinaDati() {
    const button = document.getElementById('restore-all-btn');

    if (button) {
        button.disabled = true;
        button.textContent = '⏳ Ripristino in corso...';
    }

    stopRestorePolling();
    setGlobalFeedback('Ripristino avviato: download e copia degli asset condivisi in corso.', 'info');
    renderRestoreStatus({ phase: 'starting', progress: 0, message: 'Avvio ripristino...' });

    try {
        const response = await fetch('/api/restore', { method: 'POST' });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Ripristino fallito');
        }

        const data = await response.json().catch(() => ({}));
        setGlobalFeedback(data.message || 'Ripristino avviato.', 'info');
        pollRestoreStatus();
    } catch (error) {
        setGlobalFeedback(error.message || 'Ripristino fallito.', 'error');
        throw error;
    }
}

function logout() { localStorage.removeItem('adminToken'); window.location.href = '/login.html'; }

// Init
updateDashboard();
setInterval(updateDashboard, 5000);