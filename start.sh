#!/bin/bash

echo "🚀 Avvio dei servizi PWM Tactical Command..."

if [ ! -d "node_modules" ]; then
    echo "📦 Dipendenze non trovate. Installazione in corso..."
    npm init -y > /dev/null
    npm install express socket.io ioredis jsonwebtoken geotiff cors mysql2
    echo "✅ Installazione completata!"
fi

# Avvia il server backend
echo "▶️ Avvio server.js..."
node server.js &
SERVER_PID=$!

# Avvia il worker di sincronizzazione Redis -> MySQL
echo "▶️ Avvio sync_workers.js..."
node sync_workers.js &
WORKER_PID=$!

# Avvia il server web per il frontend
echo "▶️ Avvio frontend (http-server su porta 8080)..."
npx http-server -p 8080 &
FRONTEND_PID=$!

echo ""
echo "✅ Tutti i servizi sono in esecuzione!"
echo "🌐 Frontend disponibile a: http://localhost:8080"
echo "🛑 Premi Ctrl+C per fermare tutti i servizi."

# Intercetta Ctrl+C per chiudere tutti i processi lanciati
trap "echo 'Terminazione dei servizi...'; kill $SERVER_PID $WORKER_PID $FRONTEND_PID; exit" EXIT

wait