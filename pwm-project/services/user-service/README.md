# User Service

## Scopo del Servizio
Il servizio **User Service** è responsabile della gestione completa degli utenti dell'applicazione.
Si occupa di operazioni critiche quali:
- **Autenticazione e Autorizzazione**: Registrazione, login, hashing delle password e generazione di JSON Web Tokens (JWT).
- **Gestione Profilo**: Modifica di credenziali, reset password, aggiornamento avatar o username.
- **Invio Email**: È il servizio preposto a contattare l'utente via email (ad esempio per conferme o reset) sfruttando il server SMTP.
- **Relazioni**: Se applicabile, gestione dell'amicizia o contatti.

## Struttura delle Cartelle
Questa cartella rispetta uno standard MVC (Model-View-Controller) tipico di Node.js/Express, seppur come API senza vista front-end nativa.
- **`server.js`**: Crea il web-server e lo pone in ascolto. Inizializza i middleware fondamentali e l'interazione globale con Redis/DB.
- **`routes/`**: Elenco e mapping degli endpoint (es. `/login`, `/register`, `/profile`) esposti per il Gateway.
- **`controllers/`**: Racchiude la logica applicativa dietro ogni route (es. l'invio dell'email, il check della password, l'erogazione del token).
- **`models/`**: Le query, ORM, o script diretti SQL per la validazione ed estrazione dei dati degli utenti dal database relazionale.
- **`middleware/`**: Script intermedi che ad esempio decodificano il JWT (Auth) prima di far proseguire l'utente a `/profile`.

## Configurazione Docker
Dal file `docker-compose.yml`:

```yaml
  user-service:
    build: ./services/user-service
    working_dir: /app/services/user-service
    ports:
      - "3000:3000"
    volumes:
      - ./services/user-service:/app/services/user-service
      - ./services/shared:/app/services/shared
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      - REDIS_URL=redis://redis:6379
      - DB_URL=postgres://commander_admin:secret@db:5432/pwm_tactical_database
      - SECRET_KEY=${SECRET_KEY}
      - SMTP_HOST=${SMTP_HOST}
      - SMTP_PORT=${SMTP_PORT}
      - ...
```

- **Sicurezza (Environment Variables)**: L'ambiente richiede pesantemente variabili confidenziali. `SECRET_KEY` è utilizzato per crittografare o firmare i token JWT. I vari `SMTP_*` permettono di dialogare con un mail server.
- **Volume Condiviso (`shared/`)**: Anche in questo caso si accede al blocco di logica in comune come utilità di database o logging di errore per garantire standardizzazione del codice in tutto il progetto.

## Note
- Di norma le richieste dal Frontend all'User Service non viaggiano dirette alla porta 3000, ma passano dal `gateway` (che chiama internamente l'`app-route`, che alla fine effettua un proxy verso `user-service`).
- Non si deve mai memorizzare logiche di partita o sessioni temporanee in questo container, che si deve focalizzare puramente sulla solidità e sicurezza dei dati degli utenti iscritti.
