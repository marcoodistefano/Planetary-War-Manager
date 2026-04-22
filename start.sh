#!/bin/bash

echo "🚀 Avvio dei servizi PWM Tactical Command..."

# Avvia il server backend
echo "▶️ Avvio server.js..."
node server.js &
SERVER_PID=$!

# Avvia il worker di sincronizzazione Redis -> MySQL
echo "▶️ Avvio sync_worker.js..."
node sync_worker.js &
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