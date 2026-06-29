# Progetto PWM (Planetary War Manager)
![Leonida](./Leonida.jpeg)

## Introduzione
Questo repository contiene l'intero ecosistema del progetto PWM, un'applicazione web complessa distribuita con architettura a microservizi. Il sistema gestisce utenti, chat in tempo reale e partite (match), il tutto sorretto da tecnologie moderne quali Node.js, Redis, PostgreSQL e un frontend SPA (Angular/Ionic). 

L'intero ambiente è interamente dockerizzato per garantire portabilità, facile scalabilità e coerenza tra sviluppo e produzione.

## Architettura e Tecnologie
- **Gateway (Nginx + App-Route)**: Punto di ingresso unico che si occupa del bilanciamento del carico, del routing e dell'esposizione protetta delle API e del frontend statico.
- **Frontend**: Sviluppato con Angular e Ionic, serve l'interfaccia cliente, interattiva e responsiva.
- **Microservizi Node.js**: Il nucleo logico. Suddiviso in domini (`user-service`, `chat`, `match`, `resources`), ciascuno responsabile di una parte dell'applicazione.
- **Redis**: Funge da spina dorsale per la comunicazione veloce. Utilizzato per il Pub/Sub (es. eventi in tempo reale tra microservizi e gateway), per lo storage istantaneo di dati mutevoli e per il caching.
- **PostgreSQL**: Database relazionale per l'archiviazione permanente, sicura e strutturata (es. dati utente, storico partite).

## Struttura della Repository
Troverai i seguenti moduli principali all'interno della cartella:

- `gateway/`: Reverse Proxy Nginx e API Router centralizzato. ([Vedi README dedicato](gateway/README.md))
- `frontend/`: Codice sorgente dell'interfaccia client. ([Vedi README dedicato](frontend/README.md))
- `db-init/`: Script per l'inizializzazione dello schema del database. ([Vedi README dedicato](db-init/README.md))
- `services/`: La "casa" dei microservizi:
  - `amministratore/`: Pannello di gestione del server. ([Vedi README](services/amministratore/README.md))
  - `chat/`: Motore di messaggistica real-time. ([Vedi README](services/chat/README.md))
  - `match/`: Logica per l'esecuzione delle partite. ([Vedi README](services/match/README.md))
  - `user-service/`: Gestione account, autenticazione e sicurezza. ([Vedi README](services/user-service/README.md))
  - `resources/`: Sincronizzazione risorse periodiche. ([Vedi README](services/resources/README.md))
  - `cache-warmup/`: Inizializzazione della cache. ([Vedi README](services/cache-warmup/README.md))
  - `ripristina/`: Utilità per il ripristino asset. ([Vedi README](services/ripristina/README.md))
  - `shared/`: Codice condiviso (connessioni DB/Redis, helper). ([Vedi README](services/shared/README.md))

## Avvio del Progetto

Il progetto fa uso intensivo di **Docker Compose**. Per l'avvio puoi usare gli script forniti in root:

### Windows
Esegui `start.bat`. Lo script validerà l'installazione di Docker e farà partire l'infrastruttura, aprendo il browser alla fine dell'avvio.

### Linux / macOS
Esegui `./start.sh` (ricordati di dargli i permessi con `chmod +x start.sh`).

In alternativa, puoi avviare manualmente tramite:
```bash
docker-compose up -d --build
```

Al termine dell'avvio, l'applicazione sarà accessibile all'indirizzo `http://localhost:8100` oppure al link fornito da cloudflare (tunnel). Il pannello admin è accessibile all'indirizzo `http://localhost:8080`, inserendo username e password.

## Ulteriori Dettagli
Si prega di far riferimento al file `ARCHITECTURE.md` per schemi e decisioni progettuali più approfondite, e di esplorare i `README.md` specifici di ciascuna directory per comprendere il dettaglio di ogni microservizio.
