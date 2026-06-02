#!/bin/bash

echo "Starting Planetary War Manager (PWM) Microservices..."
echo "Building and starting containers in detached mode..."

if ! pgrep -f "services/ripristina/host-downloader.js" >/dev/null 2>&1; then
	nohup node services/ripristina/host-downloader.js > /tmp/pwm-host-downloader.log 2>&1 &
fi

docker-compose up -d --build

echo ""
echo "Container Status:"
docker-compose ps

echo ""
echo "PWM Project is now running!"
echo "To view logs for a specific service: docker-compose logs -f <service_name>"
echo "To stop the project: docker-compose down"
echo ""

echo "Recupero il link pubblico da Cloudflare Tunnel in corso..."
# Attendiamo qualche secondo per dare il tempo a Cloudflare di generare il link
sleep 4
CLOUDFLARE_URL=$(docker-compose logs cloudflare-tunnel 2>/dev/null | grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' | tail -n 1)

if [ -n "$CLOUDFLARE_URL" ]; then
  echo "=================================================================="
  echo "🌍 IL TUO GIOCO E' ONLINE SU CLOUDFLARE!"
  echo "👉 URL: $CLOUDFLARE_URL"
  echo "=================================================================="
  
  echo "Aggiornamento automatico del file .env in corso..."
  sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=$CLOUDFLARE_URL|" .env
  
  echo "Riavvio di app-route e user-service per applicare le policy CORS..."
  docker-compose up -d app-route user-service
  
  echo "✅ Tutto pronto e configurato in automatico!"
else
  echo "⚠️  Impossibile recuperare il link di Cloudflare in automatico."
  echo "Per vederlo manualmente, esegui: docker compose logs cloudflare-tunnel | grep trycloudflare"
fi
