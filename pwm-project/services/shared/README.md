# Shared Services

## Scopo del Servizio
La cartella **Shared** non rappresenta un container o un microservizio eseguibile autonomamente (non c'è alcun `Dockerfile` specifico per lei). Si tratta piuttosto di una libreria interna di utility e moduli comuni, importata e condivisa (montata) dagli altri microservizi del progetto per evitare la duplicazione del codice e standardizzare i comportamenti. 

## Struttura delle Cartelle
- **`postgresClient.js` / `redisClient.js`**: Centralizzano la logica di connessione ai database. Permettono ad esempio a `chat`, `match` o `user-service` di usare la stessa sintassi per interrogare PostgreSQL o Redis, includendo nativamente logiche di riconnessione e pool condivisi.
- **`authContext.js`**: Helper condivisi per l'autenticazione o la manipolazione di contesti utente sicuri.
- **`matchMonolithic.js`**: Funzioni logiche o costanti relative al match che possono servire a più microservizi.
- **`middleware/`**: Script intermedi che possono essere montati dalle istanze Express dei diversi servizi (es. error handler unificati o validatori standard).

## Configurazione Docker
Non esiste un servizio `shared` nel `docker-compose.yml`, ma la cartella viene propagata nei vari container tramite la definizione dei volumi. Ad esempio, nel servizio `user-service`:

```yaml
  user-service:
    ...
    volumes:
      - ./services/user-service:/app/services/user-service
      - ./services/shared:/app/services/shared
```

In questo modo, lo script in `user-service` può tranquillamente eseguire:
`const db = require('../shared/postgresClient');` 
e funzionerà come se quel codice fosse integrato all'interno del microservizio stesso.

## Note
- Modificare un file in questa cartella ha un impatto a cascata (e in tempo reale o al successivo riavvio) su tutti i microservizi che lo utilizzano. È necessario prestare molta attenzione alla retrocompatibilità delle funzioni esportate qui dentro.
- È l'implementazione pratica del pattern D.R.Y. (Don't Repeat Yourself) all'interno di un'architettura distribuita.
