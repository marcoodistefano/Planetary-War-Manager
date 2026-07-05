# Progetto PWM (Planetary War Manager)

## Introduzione
Questo repository contiene l'intero ecosistema del progetto PWM, un'applicazione web complessa distribuita con architettura a microservizi. Tutto il codice sorgente del progetto si trova all'interno della cartella `pwm-project/`.

Il sistema gestisce utenti, chat in tempo reale e partite (match), il tutto sorretto da tecnologie moderne quali Node.js, Redis, PostgreSQL e un frontend SPA (Angular/Ionic). 

L'intero ambiente è interamente dockerizzato per garantire portabilità, facile scalabilità e coerenza tra sviluppo e produzione.

## Architettura e Tecnologie
- **Gateway (Nginx + App-Route)**: Punto di ingresso unico che si occupa del bilanciamento del carico, del routing e dell'esposizione protetta delle API e del frontend statico.
- **Frontend**: Sviluppato con Angular e Ionic, serve l'interfaccia cliente, interattiva e responsiva.
- **Microservizi Node.js**: Il nucleo logico. Suddiviso in domini (`user-service`, `chat`, `match`, `resources`), ciascuno responsabile di una parte dell'applicazione.
- **Redis**: Funge da spina dorsale per la comunicazione veloce. Utilizzato per il Pub/Sub (es. eventi in tempo reale tra microservizi e gateway), per lo storage istantaneo di dati mutevoli e per il caching.
- **PostgreSQL**: Database relazionale per l'archiviazione permanente, sicura e strutturata (es. dati utente, storico partite).

## Struttura della Repository
Tutta l'infrastruttura si trova in `pwm-project/`. I moduli principali sono:

- `pwm-project/gateway/`: Reverse Proxy Nginx e API Router centralizzato.
- `pwm-project/frontend/`: Codice sorgente dell'interfaccia client.
- `pwm-project/db-init/`: Script per l'inizializzazione dello schema del database (include schema Entity-Relationship completo).
- `pwm-project/services/`: Contiene tutti i microservizi (`amministratore`, `chat`, `match`, `user-service`, `resources`, `cache-warmup`, `ripristina`, `shared`).

> **Nota per l'avvio e ulteriori dettagli**: 
> Per le istruzioni su come avviare il progetto tramite Docker Compose e per i link a tutte le sotto-documentazioni, si prega di fare riferimento al README principale del progetto situato qui: **[pwm-project/README.md](./pwm-project/README.md)**.
