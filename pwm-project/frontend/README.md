# Frontend

## Scopo del Servizio
La cartella `frontend` contiene il codice sorgente per l'interfaccia utente dell'applicazione. È sviluppata utilizzando **Angular** e **Ionic Framework**, garantendo così un'esperienza fluida sia per la visualizzazione via web che per eventuali build native mobili (iOS/Android).
Il frontend funge da client principale per il giocatore/utente, permettendogli di visualizzare lo stato della partita, accedere alla chat, gestire il proprio profilo e interagire con le dinamiche di gioco.

## Struttura delle Cartelle
- **`src/`**: Contiene il codice sorgente vero e proprio dell'applicazione Angular.
  - **`app/`**: I componenti, i servizi, le route e le interfacce principali.
  - **`assets/`**: Immagini, icone e altre risorse statiche (alcune possono essere iniettate tramite bind dei volumi dai servizi condivisi).
  - **`environments/`**: Variabili di ambiente per le build Angular (es. `environment.ts`, `environment.prod.ts`).
- **`www/`**: (Generata) Contiene i file compilati e minificati (HTML, JS, CSS) che verranno serviti da Nginx in ambiente di produzione.
- **`android/`**: (Se presente) File di progetto Android per Capacitor/Cordova.
- **`Dockerfile.dev`**: Il Dockerfile utilizzato per eseguire il progetto in modalità sviluppo con hot-reload attivato.
- **`angular.json` / `ionic.config.json` / `capacitor.config.ts`**: File di configurazione per i relativi framework.

## Configurazione Docker
In ambiente di sviluppo, il `docker-compose.yml` avvia il frontend tramite il servizio `frontend-dev`:

```yaml
  frontend-dev:
    build: 
      context: ./frontend
      dockerfile: Dockerfile.dev
    ports:
      - "8100:8100"
    volumes:
      - ./frontend:/app
      - frontend_node_modules:/app/node_modules
      - ./shared/assets:/app/src/assets
```

- **Hot-Reload**: L'applicazione espone la porta 8100. Montando la cartella `./frontend` in `/app`, ogni modifica ai file sorgenti farà scattare un ricaricamento istantaneo dell'interfaccia.
- **Nginx in Produzione**: Il container `gateway` preleva i file statici compilati preesistenti in `www/` per l'esposizione al pubblico sulla porta 80.

## Note
- Affinché il proxy interno (o Nginx) possa comunicare correttamente, il frontend deve far puntare le chiamate API verso `/api/` oppure utilizzare la porta fornita dalle variabili d'ambiente (es. Cloudflare tunnel).
- La cartella `./shared/assets` è montata per permettere al frontend di leggere in live asset comuni (grafiche di gioco, etc.) anche mentre vengono aggiornati o creati.
