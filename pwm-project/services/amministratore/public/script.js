const PROJECT_PREFIX = 'pwm-'; // Filtro per i container del progetto
const token = localStorage.getItem('adminToken');
const charts = {};

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

function logout() { localStorage.removeItem('adminToken'); window.location.href = '/login.html'; }

// Init
updateDashboard();
setInterval(updateDashboard, 5000);