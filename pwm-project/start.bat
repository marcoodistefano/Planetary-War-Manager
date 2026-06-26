@echo off
setlocal enabledelayedexpansion

:: Usa --build solo se esplicitamente richiesto: start.bat --build
set "BUILD_FLAG="
if "%~1"=="--build" (
    set "BUILD_FLAG=--build"
    echo Starting Planetary War Manager ^(PWM^) Microservices... [modalita BUILD]
) else (
    echo Starting Planetary War Manager ^(PWM^) Microservices... [avvio veloce, usa --build per rebuilddare]
)



docker-compose up -d %BUILD_FLAG%

echo.
echo Container Status:
docker-compose ps

echo.
echo PWM Project is now running!
echo To view logs for a specific service: docker-compose logs -f ^<service_name^>
echo To stop the project: docker-compose down
echo.

echo Recupero il link pubblico da Cloudflare Tunnel in corso...
:: Attendiamo qualche secondo per dare il tempo a Cloudflare di generare il link
ping 127.0.0.1 -n 5 >nul

set "CLOUDFLARE_URL="
:: Uso di powershell per estrarre il link esatto usando le regex (equivalente di grep -o e tail -n 1)
for /f "usebackq tokens=*" %%i in (`powershell -Command "$logs = docker-compose logs cloudflare-tunnel 2>$null; if ($logs) { $matches = [regex]::Matches($logs, 'https://[a-zA-Z0-9-]*\.trycloudflare\.com'); if ($matches.Count -gt 0) { $matches[$matches.Count - 1].Value } }"`) do (
    set "CLOUDFLARE_URL=%%i"
)

if not "!CLOUDFLARE_URL!"=="" (
    echo ==================================================================
    echo 🌍 IL TUO GIOCO E' ONLINE SU CLOUDFLARE!
    echo 👉 URL: !CLOUDFLARE_URL!
    echo ==================================================================
    
    echo Aggiornamento automatico del file .env in corso...
    :: Sostituzione inline nel file .env usando PowerShell (equivalente a sed -i)
    powershell -Command "(Get-Content .env) -replace '^FRONTEND_URL=.*', 'FRONTEND_URL=!CLOUDFLARE_URL!' | Set-Content .env"
    
    echo Riavvio di app-route e user-service per applicare le policy CORS...
    docker-compose up -d app-route user-service
    
    echo ✅ Tutto pronto e configurato in automatico!
) else (
    echo ⚠️  Impossibile recuperare il link di Cloudflare in automatico.
    echo Per vederlo manualmente, esegui: docker-compose logs cloudflare-tunnel ^| findstr trycloudflare
)
