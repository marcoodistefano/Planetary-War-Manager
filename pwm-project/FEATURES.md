# PWM — Inventario Funzionalità

> **Ultimo aggiornamento:** 11 Ottobre 2026  
> **Commit nella cronologia locale:** 316  
> **Scopo:** Elenco esaustivo di ciò che è già implementato e di ciò che risulta incompleto o mancante. Da usare come punto di partenza per le prossime iterazioni.

---

## 1 · Autenticazione e Sessioni (`user-service`)

### Implementato ✅
| Funzionalità | Note |
|---|---|
| **Registrazione** (`POST /auth/register`) | Validazione username (max 32 char), email, password (min 12 char), regione. Hashing password con Argon2 (middleware `Aslan`). Generazione codice amico univoco. Gestione conflitto username/email duplicati. |
| **Login** (`POST /auth/login`) | Supporta accesso sia con username che con email. Verifica password hash. Creazione sessione JWT (TTL 24h) con `sessionId` in Redis + set `user_sessions:{userId}`. Cookie HttpOnly/Secure/SameSite=Strict. Logging accesso nel DB (tabella `accessi` con IP e User-Agent). |
| **Logout** (`POST /auth/logout`) | Pulizia cookie `auth_token`. |
| **Recupero username** (`POST /auth/login/recovery/username`) | Dato email + password restituisce l'username associato. |
| **Recupero password via email** (`POST /auth/login/recovery/password`) | Genera token con scadenza 10 min, lo salva nel DB, invia email HTML themed via SMTP/Nodemailer con link di reset. |
| **Reset password con token** (`POST /auth/login/recovery/password/:token`) | Verifica validità/scadenza del token, aggiorna hash password, cancella il token usato. Validazione min 12 char. |
| **Contesto autenticazione condiviso** (`authContext.js`) | Estrazione e verifica JWT da cookie o header, risoluzione `userId` — usato da tutti i microservizi. |

### Incompleto / Mancante ⚠️
| Voce | Stato |
|---|---|
| **Logout lato Redis** | Il cookie viene cancellato ma la sessione Redis (`session:{sessionId}`) **non viene rimossa**. Non c'è invalidazione server-side. |
| **2FA** | Lo schema DB ha i campi (`two_fa_method`, `two_fa_secret`, `two_fa_enabled`) ma nessuna logica è implementata. |
| **Ban utente** | La tabella `ban` esiste nello schema; i campi `is_banned` / `is_perma_banned` esistono in `utenti`, ma non c'è nessun middleware o logica di enforcement. |

---

## 2 · Profilo Giocatore (`user-service`)

### Implementato ✅
| Funzionalità | Note |
|---|---|
| **Home / Dashboard** (`GET /home`) | Recupera e restituisce: profilo utente, leaderboard regionale (top 100), leaderboard globale (top 1000), posizione utente in entrambe, partite attive in cui il giocatore è coinvolto, ultime 10 partite joinabili, partite chiuse (ultime 50 con esito: vinta/eliminato/terminata), lista amici. Tutto con caching Redis (TTL 30s). |
| **Partite attive per il browser** (`GET /home/active-matches`) | Lista partite in attesa/in corso a cui l'utente NON partecipa e di cui NON è host. |
| **Profilo utente** (`GET /player/profile`) | Restituisce: username, email, regione, ELO, avatar, codice amico. |
| **Recupero avatar** (`GET /player/avatar`) | Restituisce l'`avatar_id` dell'utente. |
| **Aggiornamento avatar** (`POST /player/profile/avatar`) | Validazione ID avatar (1–37), aggiornamento nel DB, invalidazione cache Redis della home. |
| **Aggiornamento password** (`POST /player/profile/password`) | Verifica vecchia password, hashing nuova password, aggiornamento in DB. Min 12 char. |

### Incompleto / Mancante ⚠️
| Voce | Stato |
|---|---|
| **Aggiornamento username** (`POST /player/profile/username`) | Endpoint esiste ma restituisce `"Username aggiornato in costruzione"` — **non implementato**, nessuna chiamata al model. |
| **Statistiche di combattimento** | `getProfileData` restituisce valori **hardcoded** (win_rate, kills, deaths, territories, capitals, elo_history). Commento nel codice: "In futuro le prenderai da una tabella 'statistiche_match'". |

---

## 3 · Sistema Amicizie (`user-service`)

### Implementato ✅
| Funzionalità | Note |
|---|---|
| **Lista amici** (`GET /friends/list`) | Recupera username, regione, ELO, avatar di ogni amico. |
| **Richieste in sospeso** (`GET /friends/requests`) | Restituisce le richieste pendenti ricevute dall'utente (con dati del mittente). |
| **Invio richiesta per codice amico** (`POST /friends/requests/sendByCode`) | Risolve il `codice_amico`, blocca richieste a se stessi. |
| **Invio richiesta per username** (`POST /friends/requests/sendByUsername`) | Risolve lo username, blocca richieste a se stessi. |
| **Risposta a richiesta** (`POST /friends/requests/respond`) | Accetta (inserisce in `amici` con ordinamento canonico) o rifiuta. Cancella il record dalla tabella `richieste_amici`. |
| **Rimozione amico** (`POST /friends/remove`) | Supporta rimozione sia per UUID che per username. |

### Incompleto / Mancante ⚠️
| Voce | Stato |
|---|---|
| **Cache Redis richieste pendenti** | Commento nel codice: "potremmo voler aggiungere questi dati in redis. in discussione. TO UPDATE". |
| **Protezione duplicati** | Nessuna verifica che l'amicizia esista già prima dell'invio di una nuova richiesta. |

---

## 4 · Chat in tempo reale (`chat`)

### Implementato ✅
| Funzionalità | Note |
|---|---|
| **WebSocket bidirezionale** | Server WS con `noServer: true`. Autenticazione JWT sull'upgrade HTTP. Supporto multi-device per utente (`Map<UserId, Set<WebSocket>>`). PING/PONG heartbeat. |
| **Canali di chat** | 3 tipi: **Globale** (broadcast a tutti i partecipanti), **Alleanza** (solo membri dell'alleanza), **Privata/Diretta** (tra due utenti). |
| **Invio messaggio utente** (WS + `POST /chat/message`) | Validazione contenuto (max 2000 byte), rate limiting (5 msg/sec per utente per match), verifica appartenenza alla partita. Risoluzione destinatario per username. |
| **Messaggi di sistema** (`POST /chat/message/system/...`) | Endpoint dedicato per messaggi `[SYS]`. Supporta destinazione: ALL/GLOBAL, ALLIANCE, PLAYER. Non richiede autenticazione utente. |
| **Persistenza messaggi** | Dual-write: Redis (lista con push+trim via script Lua) + PostgreSQL (transazione con tabelle `messaggi` e `chat`). Persistenza DB asincrona (`setImmediate`). |
| **Storico messaggi** (`GET /chat/history`) | Recupero con paginazione (limit, max 200). Prima tenta Redis, se vuoto fa fallback su DB con query per tipo chat (globale/alleanza/privata). Ripopolamento cache Redis in background. |
| **Presenza utenti** (`GET /chat/presence`) | Restituisce la lista degli utenti connessi via WebSocket ad una specifica partita. |
| **Pub/Sub broadcast** (`ws_broadcast_channel`) | I messaggi vengono pubblicati su un canale Redis per la distribuzione ai WebSocket connessi via `webDispatcher`. |
| **Sanitizzazione** | Rimozione di UUID sensibili dal payload inviato ai client. |

---

## 5 · Partite / Match (`match`)

### 5.1 · Gestione Lifecycle

#### Implementato ✅
| Funzionalità | Note |
|---|---|
| **Creazione partita** (`POST /match/create`) | Parametri: nome, avvio (immediato/attesa), squad, alleanze, ELO, max players, durata, moltiplicatore temporale, modalità, regioni. Codifica stato partita su 56 bit (middleware `Eru`). Genera hash e ID visualizzato. Distribuzione territori iniziali via `territoryGenerator`. |
| **Join partita** (`POST /match/join`, `POST /match/:id/join`) | Aggiunge il giocatore alla partita, assegna territori. |
| **Leave partita** (`POST /match/:id/leave`) | Rimozione dal match. |
| **Lista partite joinabili** (`GET /match/joinable`) | Restituisce partite in attesa/in corso non ancora complete. |
| **Dettagli partita** (`GET /match/:id`) | Dati pubblici: struttura, caratteristiche, lista giocatori (senza dati sensibili come armate/risorse). |
| **Stato partita** (`GET /match/:id/status`) | Stato decodificato, conteggio giocatori, max players, caratteristiche. |
| **Risultato partita** (`GET /match/:id/result`) | Indica se la partita è finita, lista giocatori con conteggio territori. |
| **Storico partita** (`GET /match/:id/history`) | Recupero dati di base dal DB (nome, struttura, data creazione, conteggio giocatori). |
| **Resa / Surrender** (WS `SURRENDER`) | Rimuove il giocatore dalla partita, azzera territori/armate/strutture, applica penalità ELO (K=32) se ranked, rinomina il giocatore in "Abbandonato_XXX". |

### 5.2 · Sistema Alleanze

#### Implementato ✅
| Funzionalità | Note |
|---|---|
| **Creazione alleanza** (`POST /match/:id/create/alliance`) | Nome obbligatorio. Creatore diventa leader. |
| **Lista alleanze** (`GET /match/:id/alliance`) | Restituisce tutte le alleanze della partita. |
| **Join alleanza** (`POST /match/:id/join/:id_alliance`) | Unirsi ad un'alleanza esistente. |
| **Leave alleanza** (`POST /match/:id/leave/:id_alliance`) | Abbandonare un'alleanza. |
| **Kick da alleanza** (`POST /match/:id/kick/:id_alliance`) | Espulsione di un membro con motivazione opzionale. Solo il leader può espellere. |

### 5.3 · Stato iniziale e Fog of War

#### Implementato ✅
| Funzionalità | Note |
|---|---|
| **Initial State** (WS `GET_INITIAL_STATE` + `GET /match/:id/initial-state`) | Restituisce: armate visibili (proprie + alleati + nemiche in range), nazioni, risorse proprie, produzione, strutture (proprie + alleati), risorse regionali, tecnologie, addestramenti in corso, leaderboard, truppe in riserva. |
| **Fog of War** | Le armate nemiche sono filtrate in base a: raggio visione di territori amici, raggio visione delle proprie armate, raggio dei radar (terrestre/anti-aereo). Unità stealth non rilevabili dai radar. Aerei solo dai radar anti-aerei. |

---

## 6 · Economia e Risorse

### Implementato ✅
| Funzionalità | Note |
|---|---|
| **9 tipi di risorse** | Denaro, legno, piombo, acciaio, mattoni, petrolio, gas naturale, uranio, oro. |
| **Generazione risorse periodica** (`resources/sync_workers.js`) | Engine che calcola produzione basata sui territori posseduti e sugli estrattori costruiti. Tiene conto del moltiplicatore temporale della partita. Risorse regionali differenziate (risorsa comune e rara per regione). |
| **Risorse regionali** | Cache Redis `match:{id}:regions_resources` con risorsa più comune e meno comune per ogni regione del match. |
| **Produzione per estrattori** | Le strutture di tipo estrattore producono risorse specifiche in base alla regione in cui sono costruite. Verifiche sulla disponibilità dei giacimenti nella regione. |

---

## 7 · Armate e Truppe

### Implementato ✅
| Funzionalità | Note |
|---|---|
| **Reclutamento unità** (WS `RECRUIT_UNIT`) | Verifica costi (tutte e 9 le risorse), tecnologia richiesta, struttura di produzione. Calcolo tempo addestramento con moltiplicatore. Spawning con coordinate: unità navali → punto d'acqua più vicino, terrestri → punto terra con offset random. Coda addestramento per struttura. |
| **Generatore automatico truppe** (`troopGenerator.js`) | Engine periodico che controlla le code di addestramento completate e aggiunge le truppe alle riserve del giocatore. |
| **Creazione armata** (WS `CREATE_ARMY`) | Prende truppe dalle riserve, crea un'armata con composizione, posizione iniziale e nome. |
| **Scioglimento armata** (WS `DISBAND_ARMY`) | Solo in standby. Restituisce le truppe alle riserve. Broadcast di `ARMY_DISBANDED`. |

---

## 8 · Movimento e Pathfinding

### Implementato ✅
| Funzionalità | Note |
|---|---|
| **Anteprima missioni** (WS `PREVIEW_MISSIONS`) | Calcola path, ETA, distanza per una o più armate senza muoverle. Rate limiting (1 calcolo/sec). |
| **Spostamento truppe** (WS `MOVE_TROOPS`) | Calcola percorso, imposta stato dell'armata (`moving` / `Pronto alla conquista`), supporta waypoints. Auto-conversione in attacco se territorio nemico. Dichiarazione di guerra automatica al primo movimento offensivo. Protezione attacco alleati. Cooldown per aerei. |
| **Annullamento missione** (WS `CANCEL_MISSION`) | Se in combattimento → torna in standby. Se in movimento → calcola path di ritorno con ETA proporzionale al tratto percorso. |
| **Pathfinding dinamico** (Node.js `dynamicPathfinder.js` + Go `pathfinding-service`) | Dual-layer: A* in Go su dati raster ETOPO + Land Cover da Redis. Supporto terreno/acqua/aereo. API REST: `/api/calculate`, `/api/nearest-water`, `/api/nearest-land`. |
| **Cammini minimi pre-calcolati** (`calculate_minimum_paths.js`) | Generazione offline di minimum_path.json, caricato in Redis all'avvio. |
| **Arrival engine** | Polling periodico (1s) su `spostamenti` con `time_to_arrive <= NOW()`. Gestisce: arrivo standard → standby/cooldown, arrivo in territorio nemico → avvio combattimento, arrivo missili → strike nucleare + autodistruzione, arrivo aerei da combattimento → air strike + rientro. |
| **Validazione attraversamento mare** | Verifica se truppe terrestri tentano di attraversare acqua senza porto/trasporto. |

---

## 9 · Combattimento

### Implementato ✅
| Funzionalità | Note |
|---|---|
| **Combat loop** (`combatLogic.js`) | Engine periodico che elabora i combattimenti attivi. Round a turni con calcolo danni basato su composizione, tipo unità, dominio (terra/mare/aria). |
| **Setup combattimento da arrivo** (`setupCombatFromArrival`) | Quando un'armata in modo `conquer` arriva su un territorio nemico, viene impostato il combattimento. |
| **Air Strike** | Bombardamento aereo: attacco → rientro automatico alla base di partenza. |
| **Nuke Strike** | Missili: attacco AOE alla destinazione, autodistruzione del missile. |
| **Decisione tattica** (`POST /match/:id/tactical-decision`) | Dopo un combattimento il giocatore può decidere: `PURSUE` (inseguire armata in fuga → ricalcola percorso) o mantenere la posizione. |
| **Combat trigger engine** (`combatTriggerEngine.js`) | Motore che rileva incontri tra armate nemiche e avvia automaticamente combattimenti. |
| **Sistema ELO** (`eloEngine.js`) | Calcolo ELO con K-factor. Applicato al surrender e alla conclusione delle partite. |

---

## 10 · Costruzione e Tecnologia

### Implementato ✅
| Funzionalità | Note |
|---|---|
| **Costruzione strutture** (WS `BUILD_STRUCTURE`) | Verifica: proprietà del territorio, risorse sufficienti, upgrade obbligatorio (tier precedente), tecnologia ricercata per tier > 1, disponibilità giacimenti per estrattori, unicità per regione. Tempo di costruzione calcolato con moltiplicatore. Supporto upgrade (sostituzione struttura precedente). |
| **Construction engine** | Polling periodico (2s) sulle strutture con `completionTime`. Completa la costruzione e notifica via broadcast. |
| **Ricerca tecnologica** (WS `RESEARCH_TECH`) | Albero tecnologico: verifica prerequisiti (tier precedente), costo in risorse, sblocca strutture/unità di tier superiore. |
| **Regole di gioco da Redis** | Le regole (costi, tempi, prerequisiti) vengono lette dal file `game_rules.json` cachato in Redis (con cache in RAM da 60s). |

---

## 11 · Engine di gioco (loop periodici)

### Implementato ✅
| Engine | Funzione |
|---|---|
| **Troop Generator** | Completa addestramenti scaduti, assegna truppe alle riserve. |
| **Combat Loop** | Elabora round di combattimento attivi. |
| **Fog of War Engine** | Calcola visibilità armate nemiche in base a raggio visione, radar, alleanze. |
| **Combat Trigger Engine** | Rileva incontri tra armate nemiche e avvia combattimenti. |
| **Logistics Engine** | Gestisce logistica (approvvigionamento, spostamenti coordinati). |
| **Arrival Engine** | Gestisce arrivi delle armate a destinazione. |
| **Construction Engine** | Completa costruzioni di strutture. |
| **Snapshot Engine** | Salvataggio periodico dello stato del match dal Redis al DB. |
| **Match State Engine** | Controlla e aggiorna lo stato generale delle partite (es. condizioni di vittoria, timeout). |
| **Leaderboard Engine** | Aggiorna leaderboard in-match periodicamente (`match:{id}:leaderboard`). |

---

## 12 · Gateway (`gateway`)

### Implementato ✅
| Funzionalità | Note |
|---|---|
| **Reverse proxy / routing** | Nginx come entry point + `app-route.js` (Node.js) come application router. Routing verso: `user-service`, `match-service`, `chat-service`. |
| **Servizio asset da Redis** | Pattern match su path `/assets/...`. Serve file binari (JSON, immagini, audio, video, tif, glb) direttamente da Redis (base64). Cache-Control 1h. |
| **CORS configurato** | Whitelist origini (localhost:8100, capacitor, trycloudflare). |
| **WebSocket proxy** | Upgrade HTTP → WS gestito con forwarding ai servizi chat e match. |
| **Middleware di sicurezza** | Blacklist, rate limiting (`Conan.js`), monitoring (`Odino.js`), sicurezza avanzata (`Sauron.js`). |

---

## 13 · Cache Warmup (`cache-warmup`)

### Implementato ✅
| Funzionalità | Note |
|---|---|
| **Caricamento asset in Redis** | Scansione ricorsiva delle directory `2Dmodels/`, `map/`, `profile_icons/` + file root (`game_rules.json`, raster ETOPO, Land Cover). Encoding base64. Manifest JSON. Limite 16 MB per file. |
| **Warmup leaderboard** | Pre-popola leaderboard globale e regionali in Redis. |
| **Warmup partite joinabili** | Pre-carica in Redis la lista di partite a cui ci si può unire. |
| **Caricamento raster GeoTIFF** | Parsing di file ETOPO e Land Cover con libreria `geotiff`. Estrazione pixel grezzi + metadati (width, height, origin, resolution). Salvataggio in Redis come buffer binario + chiave `raster_meta`. |
| **Loop continuo** | Riesegue il warmup ogni 15s per mantenere la cache aggiornata. |

---

## 14 · Ripristino Asset (`ripristina`)

### Implementato ✅
| Funzionalità | Note |
|---|---|
| **Download asset geospaziali** | Scarica ETOPO 2022 (NOAA) e Land Cover MCD12Q1 (Zenodo) con gestione redirect, progress tracking per file, skip se già esistenti. |
| **Stato ripristino** (`GET /status`) | Restituisce stato completo: fase, progresso %, byte correnti/totali per file. |
| **Staging e deploy** | Download in directory staging, poi spostamento nella directory `map/` finale. |

---

## 15 · Pannello Amministratore (`amministratore`)

### Implementato ✅
| Funzionalità | Note |
|---|---|
| **Dashboard web con login** | Interfaccia servita come static HTML. Autenticazione con password segreta via Bearer token. |
| **Lista container Docker** (`GET /api/containers`) | Elenca tutti i container con stato e status. |
| **Azioni su container** (`POST /api/containers/:id/:action`) | Start, stop, restart, rebuild di singoli container. Il rebuild include build dell'immagine + ricreazione container con stessa configurazione (env, network, volumes). |
| **Statistiche real-time** (`GET /api/stats`) | CPU %, memoria %, memoria assoluta per ogni container Docker in esecuzione. |
| **Storico statistiche** (`GET /api/stats/history`) | Cronologia CPU/memoria per container, max 1440 punti (24h a cadenza 1 min). |
| **Restart globale** (`POST /api/restart-all`) | Riavvia in sequenza tutti i container del progetto. |
| **Rebuild globale** (`POST /api/rebuild-all`) | Rebuilda e ricrea in sequenza tutti i container del progetto. |
| **Restore orchestrato** (`POST /api/restore`) | Avvia workflow: download asset via servizio `ripristina` → polling progresso → restart container al completamento. |
| **Stato restore** (`GET /api/restore/status`) | Stato in tempo reale del workflow di ripristino (fase, progresso, errori). |

---

## 16 · Frontend (Angular + Ionic)

### Pagine implementate ✅
| Pagina | Route | Note |
|---|---|---|
| **Login** | `/login` | Guard `noAuth` (redirect se già autenticato). |
| **Registrazione** | `/register` | Guard `noAuth`. |
| **Recupero credenziali** | `/login/recovery/username`, `/login/recovery/password` | Password reset con token da URL. |
| **Home / Dashboard** | `/home` | Guard `auth`. |
| **Profilo** | `/profile` | Guard `auth`. |
| **Browser partite** | `/game-browser` | Guard `auth`. |
| **Partita / Match** | `/game/match`, `/game/match/:id` | Guard `auth`. Mappa di gioco con componenti dedicati. |
| **Storico partite** | `/history` | Guard `auth`. |
| **Leaderboard** | `/leaderboard` | Guard `auth`. |

### Servizi frontend ✅
| Servizio | Funzione |
|---|---|
| `auth-api.service.ts` | Chiamate API di autenticazione. |
| `user-state.service.ts` | Stato globale dell'utente autenticato. |
| `map-assets.service.ts` | Caricamento asset per la mappa di gioco. |
| `match-state.service.ts` | Gestione stato della partita corrente (WebSocket). |
| Auth Guard / No-Auth Guard | Protezione rotte. |
| Interceptor HTTP | Gestione token e credenziali nelle richieste. |
| Build Android (Capacitor) | Configurazione presente per deploy su Android. |

---

## 17 · Infrastruttura e DevOps

### Implementato ✅
| Voce | Note |
|---|---|
| **Docker Compose** | Orchestrazione completa di tutti i servizi. File `.env` per le variabili. |
| **Script di avvio** | `start.bat` (Windows) e `start.sh` (Unix). |
| **Graceful shutdown** | Handler `SIGTERM` nei servizi chat e match per chiusura pulita WebSocket + server HTTP. |
| **Health check** | Endpoint `/health` su chat e match. |
| **Schema DB completo** | 16+ tabelle: `utenti`, `accessi`, `partite`, `partecipanti_partite`, `mosse`, `spostamenti`, `truppe`, `alleanze`, `messaggi`, `chat`, `amici`, `richieste_amici`, `ban`, `obiettivi`, `obiettivi_utente`, `password_recovery_tokens`. |
| **Codifica stato partita su bit** (`Eru`) | 56 bit che encodano: stato (2 bit), max players (3 bit), durata (4 bit), moltiplicatore (4 bit), squad (1 bit), modalità, regioni, alleanze, ranked, ecc. |
| **Ripristino mosse attive al riavvio** | All'avvio del match service, le mosse attive dal DB vengono ricalcolate e riallineate con Redis. |

---

## 18 · Funzionalità nello schema DB ma non (ancora) implementate nel backend

| Tabella/Campo | Stato |
|---|---|
| **`obiettivi` / `obiettivi_utente`** | Tabelle create nello schema, **nessuna logica backend** per creare obiettivi, tracciare progressi o riscuotere ricompense. |
| **`ban`** | Tabella creata, nessun endpoint/middleware per bannare o verificare ban. |
| **`two_fa_*`** (su `utenti`) | Campi presenti, nessuna logica 2FA. |
| **`truppe`** (tabella DB) | La tabella esiste per la persistenza. `sync_workers.js` ha la logica di dump Redis→DB ma la granularità è per singola truppa (hash Redis `truppa:{id}`), il sistema attuale usa un modello monolitico per match in Redis. |

## 19 · Valutazione Funzionalità Mancanti e Roadmap di Implementazione

In base al confronto tra i componenti attivi e le parti ancora scoperte o incomplete, di seguito è riportata la valutazione strutturata per priorità d'impatto sul sistema.

### 19.1 · Priorità Massima (Integrità, Sicurezza e Resilienza)
Funzionalità che impattano la sicurezza del sistema o la coerenza dello stato tra Redis e PostgreSQL:

| Voce | Stato Attuale | Impatto & Soluzione Richiesta |
|---|---|---|
| **Invalidazione sessione Redis al Logout** | Al logout viene rimosso solo il cookie `auth_token`. La sessione in Redis (`session:{sessionId}`) rimane attiva fino a scadenza TTL. | **Sicurezza**: Rimuovere la chiave di sessione in Redis e aggiornare il set `user_sessions:{userId}` durante `POST /auth/logout`. |
| **Persistenza & Granularità Truppe (`sync_workers.js`)** | In Redis lo stato delle truppe è aggregato monoliticamente per match/giocatore, mentre nel DB la tabella `truppe` modella la singola entità/truppa. | **Resilienza**: Allineare il modello di sincronizzazione periodica Redis→Postgres per garantire ripristini coerenti post-crash. |
| **Protezione duplicati richieste di amicizia** | Non viene verificata la presenza di amicizia o richiesta pendente prima di creare una nuova richiesta. | **Integrità dati**: Aggiungere controllo preliminare su `amici` e `richieste_amici` per prevenire conflitti o errori di vincolo DB. |

---

### 19.2 · Priorità Alta (Core Gameplay e Ciclo Partita)
Funzionalità indispensabili per completare l'esperienza di gioco e il ciclo vitale dei match:

| Voce | Stato Attuale | Impatto & Soluzione Richiesta |
|---|---|---|
| **Statistiche di combattimento reali nel profilo** | `getProfileData` restituisce metriche hardcoded (`win_rate`, `kills`, `deaths`, `territories`, `capitals`). | **Progressione**: Persistere le statistiche al termine dei match (o nei round di combattimento) e collegarle dinamicamente alla schermata profilo. |
| **Fine partita formale e cleanup chiavi Redis** | Il surrender e l'ELO funzionano, ma la chiusura globale del match necessita di archiviazione definitiva e pulizia chiavi temporanee. | **Efficienza**: Implementare routine di cleanup di tutte le chiavi `match:{id}:*` al termine della partita. |

---

### 19.3 · Priorità Media (Profilo & Moderazione)
Funzionalità di rifinitura dell'account e gestione dell'utenza:

| Voce | Stato Attuale | Impatto & Soluzione Richiesta |
|---|---|---|
| **Aggiornamento Username (`POST /player/profile/username`)** | Endpoint presente ma risponde con messaggio placeholder *"Username aggiornato in costruzione"*. | **UX**: Implementare validazione unicità, aggiornamento su tabella `utenti` e invalidazione cache profilo. |
| **Enforcement Ban Utente** | Tabella `ban` e flag `is_banned` / `is_perma_banned` definiti a DB ma nessun middleware ne blocca l'accesso. | **Moderazione**: Introdurre controllo ban nel middleware di autenticazione (`authContext.js`) e nel gateway. |
| **Autenticazione a due fattori (2FA)** | Campi DB `two_fa_*` presenti senza logica applicativa. | **Sicurezza avanzata**: Implementare generazione segreto TOTP, verifica codice OTP e QR code. |

---

### 19.4 · Priorità Bassa (Progressione a Lungo Termine)
Funzionalità predisposte a livello di schema ma secondarie per la giocabilità immediata:

| Voce | Stato Attuale | Impatto & Soluzione Richiesta |
|---|---|---|
| **Sistema Obiettivi / Achievement** | Tabelle `obiettivi` e `obiettivi_utente` presenti senza logica. | **Retention**: Definire lista achievement (es. conquiste, ricerche completate), trigger di avanzamento e riscatto ricompense. |

---

### 19.5 · Roadmap Consigliata per le Prossime Sprint
1. **Sprint 1 — Rifiniture immediate:** Invalidazione sessione Redis al logout + implementazione cambio username + controllo duplicati amicizie.
2. **Sprint 2 — Ciclo statistiche & cleanup match:** Salvataggio effettivo dei dati di combattimento a fine partita nel DB e consultazione da profilo; routine di pulizia chiavi Redis a match chiuso.
3. **Sprint 3 — Moderazione & Sicurezza:** Middleware enforcement ban utenti; valutazione attivazione 2FA.
4. **Sprint 4 — Progression:** Sviluppo del modulo obiettivi/ricompense.

---

> **TIP:** Questo inventario e la relativa roadmap consentono di procedere in maniera modulare e incrementale senza regressioni sui sistemi già operativi.
