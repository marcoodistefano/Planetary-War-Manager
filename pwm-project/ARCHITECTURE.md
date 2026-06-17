# Planetary War Manager (PWM) - Architecture & Services

Questo documento descrive nel dettaglio l'architettura a microservizi di PWM, il funzionamento di ciascun nodo, le logiche di routing e il passaggio dei dati attraverso l'ecosistema.

---

## 1. Nodi dell'Infrastruttura (Orchestrazione Docker)

L'intero ecosistema è configurato all'interno della rete Docker `pwm-net`, sicura e isolata dall'esterno. Solamente i gateway e gli strumenti diagnostici amministrativi hanno porte esposte verso l'host.

### Core Data & State Management
*   **`redis` (Porta Interna 6379):** È il cuore pulsante e in-memory del backend. Viene usato per code asincrone, posizioni geografiche in O(1) time (`geoadd`, `geosearch`), e per memorizzare l'hitbox temporanea e le properties di tutte le truppe. Funge da buffer per assorbire il carico prima che i dati tocchino il disco.
*   **`db` (Postgres 15 - Porta Interna 5432):** Il database relazionale permanente. Gestisce i log in accumulo, le tabelle di utenti, lo storico degli scontri e gli snapshot "hard" del gioco.
*   **`pgadminer` (Adminer - Porta Esterna 8085):** Un client web leggero per ispezionare, lanciare query SQL native e debuggare graficamente l'istanza PostgreSQL.
*   **`redis-ui` (Redis Commander - Porta Esterna 8086):** Interfaccia GUI per curiosare all'interno dei key-pair, sets e hashes che ruotano dentro il database Redis, perfetta per vedere la fluttuazione geografica real-time.

### Nodi Micro-servizi (App Container in Node.js)
Tutti questi servizi girano internamente alla porta `3000` (non esposta sull'host) e sono protetti dall'API Gateway.
*   **`engine-move`:** Gestisce il calcolo geografico spaziale, leggendo attivamente file ad alta risoluzione in formato TIFF. Riceve l'input dalle truppe, controlla collisioni di base, estrae l'altitudine reale al pixel da ETOPO, deduce il bioma corrente da LANDCOVER e infine aggiorna le coordinate su Redis notificando in broadcasting le app frontend in ascolto via Websocket.
*   **`engine-res` (Worker Sincronizzatore):** Non riceve vere e proprie connessioni esterne. È un Cron-Job asincrono (`sync_workers.js`) che ciclicamente esplora la memoria del servizio `redis` tramite chiavi del tipo `modificati:*`. Prende questi record volatilizzati e consolida una query massiva multi-riga su `db` per far persistere i movimenti non appena considerati stabili (INSERT ... ON CONFLICT DO UPDATE).
*   **`engine-combat` (in deploy):** Un placeholder node che separerà tutta la pesante matematica di risoluzione danni, dadi, resistenze di modulo, armature dall'engine di spostamento.
*   **`auth-service`:** Un nodo dedicato unicamente alla convalida SSO (JSON Web Tokens) interfacciandosi con la base d'utenza in Postgres e firmando i permessi di validazione payload in entrata nel gateway.
*   **`chat`:** Nodo WebSocket a minor priorità dedito solo a smistare room-messages, notifiche utente ed eventi diplomatici in-game, non sporcando minimamente le pipeline dei calcoli geografici.

---

## 2. API Gateway e Routing del Traffico

Il traffico è gestito integralmente da **`gateway` (Nginx - Porta Esterna 80)**. 
Tutte le connessioni, sia statiche HTTP che continue (WebSocket/TCP), passano per Nginx, che funge da reverse-proxy:

1.  **`/` (Document Root Frontend):** Serve e cachea l'`index.html` e tutti i framework grafici client-side (`Three.js`, stili CSS, UI layer logici) in maniera passiva.
2.  **`/socket.io/` (Engine WebSocket):**
    *   Le instanze WebSocket generate dal browser (`const sensorSocket = io('/', { path: '/socket.io' })`) passano il JWT token.
    *   Il server Nginx intercetta le route `/socket.io/` elaborando l'header HTTP `Upgrade` per trasformare la normale handshake port-80 in un bind TCP prolungato continuo asincrono.
    *   Redirige permanentemente il socket sul demone `engine-move:3000` autorizzandolo.
3.  **`/auth/`:** Endpoint che intercetta i fetch classici JSON, dirottandoli ad `auth-service:3000`.

---

## 3. Scorrimento Temporale dei Dati e Pipeline

Per un game loop da manuale il flusso è:

1.  **Imput:** L'utente preme lo schermo (Frontend), generando tramite socket un evento `query_point` o comandi truppa. Viene emesso a `80`.
2.  **Proxying:** Il Gateway lo cede nativamente al router WebSocket su `engine-move`.
3.  **Analisi / Memoria Caching:** `engine-move` decripta i dati JWT. Legge l'asset (TIFF). Invia `HSET` su **Redis** per ridefinire la locazione o gli indici interni. Aggionge la stringa allo stack `modificati:*` in **Redis**. Invia `socket.emit` per chiudere l'istante grafico nel frontend.
4.  **Consolidazione Background:** Lo sheduler di `engine-res` rileva un delta di variazioni non storicizzate. Trasforma la cache temporanea Redis in una mega transazione PostgresQL `db`, cancellando subito dopo la lista pendente Redis `processing`! In questo modo il gioco resta leggero ma con archiviazione storica intatta.

🛰️ Planetary War Manager (PWM) - Architecture & Services
Questo documento descrive l'architettura a microservizi di PWM, il funzionamento dei nodi Docker e la pipeline dei dati attraverso l'ecosistema.

1. Orchestrazione e Rete Docker (pwm-net)
L'intero ecosistema è isolato all'interno della rete virtuale pwm-net. In Docker, i container comunicano tra loro usando il nome del servizio come indirizzo (es. http://engine-move:3000), garantendo un'astrazione totale dall'IP dell'host.

Il Magazzino Dati Condiviso (Shared Volume)
Una delle colonne portanti è il volume shared/assets. Questo volume è montato in sola lettura su più container contemporaneamente:

engine-move: Lo usa per leggere i file .tif e calcolare l'altitudine.

gateway: Lo usa per servire i modelli .glb e il database .json direttamente al browser dell'utente.

2. Analisi dei Nodi
Core Data & Persistence
redis: Database in-memory. Gestisce i dati "caldi" (posizioni truppe, code di movimento). Utilizza indici geospaziali per query rapide sulla mappa.

db (Postgres 15): Database relazionale per dati "freddi" e permanenti (utenti, statistiche, snapshot storici). Viene inizializzato all'avvio tramite gli script SQL in db-init/.

pgadminer & redis-ui: Strumenti di debug esposti rispettivamente sulle porte 8085 e 8086 per l'ispezione visuale dei dati.

Business Logic (Node.js Containers)
engine-move: Il "cervello" geografico. Carica i GeoTIFF all'avvio dal volume condiviso. Gestisce i WebSocket per ricevere input dal player e notificare i movimenti in tempo reale.

engine-res (Worker): Un servizio invisibile che non riceve traffico web. Esegue un loop (performDump) ogni 5 secondi: preleva le modifiche da Redis e le scrive massivamente su Postgres per garantire la persistenza dei dati.

auth-service: Gestisce il login e la firma dei JWT. Fondamentale: condivide la SECRET_KEY con gli altri nodi per permettere a engine-move di convalidare l'identità dell'utente nei socket.

3. API Gateway (Nginx) - Il Vigile del Traffico
Il container gateway è l'unico punto di accesso pubblico (Porta 80). Smista le richieste in base al prefisso URL:

Traffico Statico (/): Serve l'HTML e il JS del frontend.

Asset di Gioco (/assets/): Punta direttamente al volume condiviso ./shared/assets, permettendo al browser di scaricare modelli 3D e mappe senza passare per i microservizi.

WebSocket (/socket.io/): Effettua l'upgrade del protocollo e "aggancia" il browser direttamente a engine-move.

API REST (/auth/): Dirotta le richieste di login ad auth-service.

4. Pipeline del Dato: Il Ciclo di Vita di un Movimento
Input: Il player clicca sulla mappa. Il frontend invia un evento query_point via WebSocket al Gateway.

Elaborazione: Il Gateway passa l'evento a engine-move. Il servizio legge il pixel del TIFF, calcola l'altitudine e aggiorna Redis (HSET truppa:id ...).

Feedback: engine-move risponde immediatamente al player via socket per aggiornare la grafica.

Persistenza: Dopo pochi secondi, engine-res nota la modifica su Redis, la preleva e la salva permanentemente in una riga della tabella truppe su Postgres.