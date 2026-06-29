# Match Service

## Scopo del Servizio
Il servizio **Match** è il cuore delle dinamiche di gioco del progetto PWM. Si occupa della creazione, gestione, aggiornamento e conclusione delle partite tra giocatori. 
Ospita la logica di matchmaking, il mantenimento in memoria dello stato attivo della partita, le validazioni sulle mosse o le interazioni dei giocatori, e coordina eventuali timer e turnazioni. Interagisce fittamente con Redis per garantire che lo stato del match sia letto o scritto alla massima velocità possibile.

## Struttura delle Cartelle
- **`server.js`**: Avvia il server Node.js esposto per il servizio match (es. porta 3004). Può inizializzare i listener per Pub/Sub su Redis per interagire con il Gateway e la Chat.
- **`matchRoute.js` / `matchController.js`**: Gestiscono le API di creazione, annullamento, completamento di un match ed espongono gli endpoint ad `app-route` (Gateway interno).
- **`matchModel.js`**: Contiene la complessa logica di business e le interazioni con il database PostgreSQL (per lo storico e le statiche di fine partita) e con Redis (per memorizzare in cache lo stato di gioco effettivo in tempo reale).
- **`Dispatcher/`**: (Simile a chat) Moduli dedicati all'inoltro di eventi verso code o verso altri servizi, per notificare lo stato avanzamento della partita.
- **`middleware/`**: Eventuali controlli di validazione (es. l'utente può entrare in questo match?).

## Configurazione Docker
Dal file `docker-compose.yml`:

```yaml
  match-service:
    build: ./services/match
    working_dir: /app/services/match
    ports:
      - "3004:3004"
    volumes:
      - ./services/match:/app/services/match
      - ./services/shared:/app/services/shared
      - ./shared:/app/shared
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      - REDIS_URL=redis://redis:6379
      - DB_URL=postgres://commander_admin:secret@db:5432/pwm_tactical_database
      - SECRET_KEY=${SECRET_KEY}
      - CHAT_SERVICE_URL=http://chat:3001
```

- **Dipendenze DB e Redis**: Essenziali. Il DB serve per salvare lo storico e aggiornare le statistiche dei giocatori a fine partita, mentre Redis gestisce le posizioni, i timer e i turni istantanei per non caricare il relazionale.
- **`CHAT_SERVICE_URL`**: Serve per permettere al Match Service di comunicare direttamente con la chat (es. notificare automaticamente in chat una determinata mossa o l'inizio/fine del match).
- **Volumi**: Importa cartelle condivise (sia le utils dei servizi che gli asset condivisi `shared/` come mappe o config statiche per validare l'azione di gioco).

## Note
- Questo è uno dei servizi maggiormente soggetti a letture e scritture veloci. Usa pesantemente Redis tramite primitive specifiche (es. hashes e list) o tramite Lock concorrenziali per evitare che due giocatori facciano una mossa contemporaneamente sullo stesso oggetto.
