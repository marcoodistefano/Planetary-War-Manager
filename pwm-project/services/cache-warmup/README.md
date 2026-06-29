# Cache Warmup

## Scopo del Servizio
Il servizio **Cache-Warmup** è un piccolo worker eseguito tipicamente all'avvio dell'applicazione. Il suo scopo principale è leggere i dati critici e persistenti dal database principale (PostgreSQL) o dai file di progetto, e pre-caricarli in memoria (Redis). Questo "riscaldamento" della cache garantisce che i servizi dell'applicativo (come il match-service o l'engine-res) trovino le informazioni di cui hanno bisogno già pronte e ad accesso rapidissimo in Redis senza dover interrogare il database relazionale, migliorando drasticamente le performance generali.

## Struttura delle Cartelle
- **`warmup.js`**: Lo script principale. Si occupa della connessione a Postgres e Redis ed esegue le interrogazioni iniziali o il parsing di file necessari a popolare la cache.
- **`Dockerfile`**: Il file usato per pacchettizzare lo script di warmup.
- **`package.json`**: Le dipendenze essenziali del nodo, in particolare i driver per connettersi al database (es. `pg`) e a Redis (es. `ioredis` o `redis`).

## Configurazione Docker
Nel file `docker-compose.yml`, questo servizio dipende dallo stato sia del database che della cache:

```yaml
  cache-warmup:
    build: ./services/cache-warmup
    depends_on:
      redis:
        condition: service_healthy
      db:
        condition: service_healthy
      match-service:
        condition: service_started
    environment:
      - REDIS_URL=redis://redis:6379
      - DB_URL=postgres://commander_admin:secret@db:5432/pwm_tactical_database
      - MATCH_SERVICE_URL=http://match-service:3004
    volumes:
      - ./shared/assets:/app/assets:ro
    restart: unless-stopped
```

- **Dipendenze (depends_on)**: Il servizio attende che Redis e DB siano contrassegnati come "healthy" per essere sicuro di potersi connettere e trasferire i dati.
- **Asset Statici**: Dispone dell'accesso in sola lettura ai file grafici o JSON nella cartella `shared/assets` per poter caricare e indicizzare mappe, statistiche o metadati.
- **Ciclo di vita**: Essendo solitamente configurato per agire all'avvio, il suo design prevede un riavvio su crash o l'esecuzione in background continuo a seconda della sua implementazione (`restart: unless-stopped`).

## Note
- È prassi che i dati in Redis (che è configurato con storage persistente) vengano "sporcati" durante l'utilizzo. Il warmup assicura che in caso di catastrofe, riavvio pulito, o disallineamento, lo stato base di mappe/utenti/dati di sistema sia sempre pronto all'avvio della piattaforma.
