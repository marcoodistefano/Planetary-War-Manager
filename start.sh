#!/bin/bash

echo "🚀 Avvio dei servizi PWM Tactical Command..."

echo "🗄️ Configurazione Database PostgreSQL..."
DB_NAME="planetary_war_manager_database"

# Controllo se PostgreSQL è in esecuzione
if ! systemctl is-active --quiet postgresql; then
    echo "Servizio PostgreSQL non attivo. Tento l'avvio..."
    sudo systemctl start postgresql
    sleep 2
fi

# Controllo se il database esiste, se no lo creo
if ! sudo -u postgres psql -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
    echo "Creazione del database $DB_NAME..."
    sudo -u postgres createdb "$DB_NAME"
else
    echo "✅ Database $DB_NAME già esistente."
fi

# Applica sempre lo schema (le tabelle non verranno duplicate grazie agli IF NOT EXISTS)
if [ -f "database.sql" ]; then
    echo "Sincronizzazione delle tabelle da database.sql..."
    sudo -u postgres psql -d "$DB_NAME" -f database.sql > /dev/null
    echo "✅ Tabelle sincronizzate con successo!"
else
    echo "⚠️ File database.sql non trovato. Tabelle non create."
fi

if [ ! -d "node_modules" ]; then
    echo "📦 Dipendenze non trovate. Installazione in corso..."
    npm init -y > /dev/null
    npm install express socket.io ioredis jsonwebtoken geotiff cors pg pg-format
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