# Chat Service

## Scopo del Servizio
Il servizio **Chat** gestisce le comunicazioni in tempo reale tra gli utenti della piattaforma. È responsabile per l'instradamento, la persistenza e la distribuzione dei messaggi sia per chat globali che per stanze private/partita. Inoltre, mantiene traccia dello stato di connessione (online/offline) degli utenti e notifica il resto del sistema quando avvengono determinati eventi.

## Struttura delle Cartelle
- **`server.js`**: È l'entry-point del servizio e ospita il server Socket.IO (o equivalente). Inizializza le connessioni WebSocket, i middleware di autenticazione dei socket, e i client Redis/DB.
- **`Dispatcher/`**: Contiene logiche per smistare e diramare gli eventi (es. routing di un messaggio specifico alla stanza del match giusto).
- **`controllers/`**: Logica di gestione della chat (invio messaggio, fetch cronologia, gestione stanze) legata alle route o agli eventi socket.
- **`models/`**: Schema dei dati, tipicamente query o modelli per l'interazione con PostgreSQL dove vengono memorizzati i log delle conversazioni o gli archivi dei messaggi.
- **`routes/`**: Qualora il servizio esponga anche API REST (es. cronologia chat, messaggi non letti), qui sono definiti i relativi endpoint express.

## Configurazione Docker
Dal file `docker-compose.yml`:

```yaml
  chat:
    build: ./services/chat
    working_dir: /app/services/chat
    volumes:
      - ./services/chat:/app/services/chat
      - ./services/shared:/app/services/shared
    depends_on:
      redis:
        condition: service_healthy
      db:
        condition: service_healthy
    environment:
      - REDIS_URL=redis://redis:6379
      - DB_URL=postgres://commander_admin:secret@db:5432/pwm_tactical_database
      - JWT_SECRET=${SECRET_KEY}
```

- **Redis**: È indispensabile. Il servizio chat utilizza Redis non solo per i dati cache, ma solitamente come "pub/sub" e come "adapter" (es. `socket.io-redis`) per sincronizzare gli eventi WebSocket se il sistema venisse scalato in multi-nodo. 
- **Volumi condivisi (`shared/`)**: Accede a codice condiviso (come configurazioni di connessione DB o logger).
- **Autenticazione**: Viene passato il `JWT_SECRET` affinché il servizio chat possa confermare la validità del token dell'utente alla prima connessione socket.

## Note
- Quando Nginx (il gateway) riceve una richiesta di `Upgrade: websocket`, la instrada a questo servizio. È fondamentale che `Nginx` sia configurato per mantenere vive queste connessioni asincrone.
- Tutti i messaggi critici o per stanze persistenti vengono memorizzati tramite `DB_URL` per poterne fare il fetch cronologico successivo.
