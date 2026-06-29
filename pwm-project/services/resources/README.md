# Engine Resources Service

## Scopo del Servizio
Il servizio **Resources** (conosciuto nel `docker-compose` come `engine-res`) funge da motore di sincronizzazione per le risorse globali, l'inventario o l'economia del gioco. Si occupa periodicamente, o su evento, di aggiornare la disponibilità delle risorse degli utenti, i cooldown, la generazione passiva di elementi in-game o lo stato dei task in background che necessitano di essere costantemente valutati ed elaborati, senza sovraccaricare il servizio primario.

## Struttura delle Cartelle
- **`server.js`**: Script entry-point che potrebbe inizializzare il servizio web o i vari worker.
- **`sync_workers.js`**: (O file analoghi) È la componente "Cron" o Worker che ciclicamente controlla i parametri su Redis e/o DB (PostgreSQL) per calcolare la produzione o il decremento di specifiche risorse utente, applicando i dovuti calcoli per sincronizzare lo stato effettivo.
- **`services/`**: Se presente, contiene sottomoduli logici o helper per le funzioni di sincronizzazione.

## Configurazione Docker
Dal `docker-compose.yml`:

```yaml
  engine-res:
    build: ./services/resources
    volumes:
      - ./services/resources:/app
      - ./services/shared:/app/services/shared
    depends_on:
      redis:
        condition: service_healthy
      db:
        condition: service_healthy
    environment:
      - REDIS_URL=redis://redis:6379
      - DB_HOST=db
      - DB_USER=commander_admin
      - DB_PASSWORD=secret
      - DB_NAME=pwm_tactical_database
      - DB_PORT=5432
```

- **Dipendenze Database**: Si collega a DB e Redis fornendo le credenziali necessarie. Generalmente usa Redis come fonte rapida per le letture e le scritture temporanee o di check e il DB per persistere periodicamente i dati dell'economia (o simili) in maniera sicura.
- **Volumi**: Accede regolarmente alla libreria `shared` per riutilizzare schemi comuni di modelli dati e utilità di connessione.
- **Porte Esterne assenti**: Tipicamente non espone API all'esterno per cui non ha porte `ports` mappate (come il match service). Comunica internamente con DB, Redis e al massimo processa tramite code asincrone.

## Note
- Affidare questi task pesanti ad un container `engine-res` distaccato permette di scalare questa elaborazione parallelamente.
- Essendo un engine puramente logico-sincronizzatore, è essenziale che non venga bloccato da altre operazioni per mantenere l'ecosistema di "tempo in gioco" costantemente fluido.
