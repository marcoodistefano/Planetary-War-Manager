# Piano di implementazione UX - Truppe, ordini e combattimento

## Obiettivo

Rendere il comando delle truppe piu rapido, leggibile e prevedibile, mantenendo l'architettura attuale Angular + WebSocket + Redis + PostgreSQL.

Il flusso principale da ottenere e:

```text
Seleziona armata -> seleziona bersaglio sulla mappa -> preview tattica -> conferma ordine -> monitoraggio -> completamento o annullamento
```

Il piano evita una riscrittura completa del motore. Riutilizza la preview dei percorsi, i waypoint, gli eventi WebSocket e la gestione attuale delle missioni.

## Stato implementazione

- [x] Fase 0, primo incremento: `commandId`, `type` missione e idempotenza Redis sugli ordini `MOVE_TROOPS`.
- [x] Feedback frontend per ordine accettato o duplicato.
- [x] Codici errore stabili e messaggi frontend piu leggibili per gli ordini di movimento.
- [x] Stato canonico `army.state` introdotto con fallback per gli stati legacy.
- [x] Writer principali di movimento, combattimento, arrivo e reset aggiornati a `army.state`.
- [x] Build Angular e controllo sintattico backend superati.
- [x] Fase 0, migrazione dei writer match a `army.state`, mantenendo le letture legacy compatibili.
- [x] Fase 1, banner persistente per selezione armate, gestione rapida e annullamento.
- [x] Fase 1, pannello preview con azione, bersaglio, ETA, distanza, waypoint ed errori leggibili.
- [x] Fase 1, conferma esplicita a due passaggi per la dichiarazione di guerra.
- [x] Fase 2, metadati preview per tipo rotta, avvisi e dichiarazione di guerra.
- [x] Fase 1, conferma tattica dalla mappa completa.
- [x] Fase 3, Centro ordini con missioni attive, ETA, stato, centratura mappa e annullamento.
- [x] Fase 3, storico sintetico eventi e ripristino degli ordini attivi dopo `INITIAL_STATE`.
- [x] Fase 4, creazione di armate miste con composizione validata lato client e backend.
- [x] Fase 4, comando backend `SPLIT_ARMY` e `MERGE_ARMIES` con validazioni di standby e posizione.
- [x] Fase 4, azione UI `DIVIDI` per creare un distaccamento dalla modale.
- [x] Fase 4, selezione UI filtrata per fondere due armate nella stessa posizione.
- [x] Fase 4, rinforzo di un armata standby con composizione validata e riserve scalate atomicamente.
- [x] Fase 4, template locali per salvare, caricare ed eliminare composizioni.
- [x] Fase 5, gruppi nominati persistenti e selezione multipla dalla mappa.
- [x] Fase 5, box-select Shift+trascinamento per selezionare piu armate proprie.
- [x] Fase 5, filtri Centro ordini per movimento, combattimento e rientro.
- [x] Fase 5, coda missioni per armata con avanzamento automatico all'arrivo.
- [x] Fase 5, sincronizzazione opzionale delle partenze in base alle ETA.
- [x] Fase 5 completata.
- [x] Fase 6, Centro combattimento con HP, unita, bersaglio, timer, distanza e gittata.
- [x] Fase 6, snapshot tattico server allegato agli eventi `COMBAT_EVENT`.
- [x] Fase 6, ritirata, inseguimento e mantenimento posizione collegati alle decisioni esistenti.
- [x] Fase 6 completata.
- [x] Fase 7, throttling del layer percorsi mappa a 10 Hz con firma differenziale.
- [x] Fase 7, metriche Redis per cicli radar, partite analizzate e ingaggi avviati.
- [x] Fase 7 completata a livello operativo.

## Stato di partenza

Capacita gia disponibili:

- movimento con pathfinding A*;
- waypoint e preview multipla delle missioni;
- calcolo di distanza ed ETA;
- trasporto automatico tramite porti e aeroporti;
- annullamento con percorso di rientro;
- intercettazione automatica delle armate;
- combattimento a round;
- ritirata strategica e richiesta di inseguimento;
- aggiornamenti realtime tramite Redis/WebSocket;
- cache del percorso lato client per il movimento delle armate.

Limiti principali:

- il comando operativo richiede ancora nome e coordinate inseriti manualmente;
- la creazione di un'armata gestisce una sola tipologia di truppa per richiesta;
- gli stati delle armate non sono uniformi;
- movimento, attacco e conquista sono troppo accoppiati;
- le informazioni tattiche sono distribuite tra mappa, toast e modale;
- il radar di combattimento puo generare carico crescente con molte partite e armate.

## Priorita

| Priorita | Area | Risultato |
|---|---|---|
| P0 | Comando dalla mappa | Riduzione immediata dei passaggi necessari per impartire un ordine |
| P0 | Stati e contratti missione | Comportamento coerente tra frontend e backend |
| P1 | Preview tattica | Ordini piu consapevoli e meno errori |
| P1 | Centro ordini | Controllo chiaro di missioni, rientri e combattimenti |
| P1 | Armate miste | Formazioni realmente utilizzabili |
| P2 | Gruppi e coda ordini | Gestione efficiente di molte armate |
| P2 | Ottimizzazione radar e mappa | Scalabilita del motore |

---

## Fase 0 - Preparazione dei contratti

### Obiettivo

Stabilire un modello comune per ordini e stati prima di aggiungere nuove interazioni.

### Backend

File principali:

- `pwm-project/services/match/handlers/movement.handler.js`
- `pwm-project/services/match/handlers/army.handler.js`
- `pwm-project/services/match/server.js`
- `pwm-project/services/match/middleware/movementLogic.js`

Introdurre un contratto di missione esplicito:

```json
{
  "commandId": "uuid",
  "armyId": "army-1",
  "type": "move",
  "target": {
    "name": "region-42",
    "coords": [12.3, 45.6]
  },
  "waypoints": [],
  "issuedAt": 1762500000000
}
```

Tipi iniziali:

```text
move
attack_army
attack_city
conquer
bombard
scout
retreat
return
```

Uniformare gli stati dell'armata:

```text
standby
moving
engaging
combat
retreating
returning
resupplying
destroyed
```

Separare sempre:

```text
status       = stato corrente
missionType  = tipo dell'ordine
```

Aggiungere validazione centralizzata per:

- armata appartenente all'utente;
- bersaglio valido;
- alleanze e guerra;
- cooldown e rifornimento;
- dominio dell'armata;
- duplicazione dello stesso comando.

### Frontend

File principali:

- `pwm-project/frontend/src/app/game/match/match.page.ts`
- `pwm-project/frontend/src/app/game/components/army-modal/army-modal.component.ts`

Creare interfacce TypeScript condivise localmente per:

- `ArmyStatus`;
- `MissionType`;
- `ArmyMission`;
- `MissionPreview`;
- `CombatSummary`.

### Criteri di completamento

- Un ordine ripetuto con lo stesso `commandId` non produce una seconda missione.
- Frontend e backend usano gli stessi nomi per stati e tipi di missione.
- Gli errori restituiscono un codice stabile oltre al messaggio leggibile.

---

## Fase 1 - Comando diretto dalla mappa

### Obiettivo

Permettere di impartire un ordine senza digitare coordinate o nomi.

### Interazione desktop

1. Click su un'armata propria.
2. Click su una citta, regione, struttura o armata nemica.
3. Apertura di un menu contestuale o radiale.
4. Scelta dell'azione disponibile.
5. Visualizzazione della preview.
6. Conferma dell'ordine.

Azioni mostrate in base al bersaglio:

- `Sposta qui`;
- `Attacca`;
- `Conquista`;
- `Bombarda`;
- `Ricognizione`;
- `Imposta waypoint`.

Azioni non valide devono essere disabilitate con una motivazione chiara, per esempio:

```text
Impossibile attraversare il mare: nessun porto collegato e capacita di trasporto insufficiente.
```

### Interazione mobile

- tap su armata;
- tap su bersaglio;
- bottom sheet con le azioni;
- preview e conferma nello stesso pannello;
- pulsante Annulla sempre raggiungibile.

### File coinvolti

- `pwm-project/frontend/src/app/game/match/match.page.ts`
- `pwm-project/frontend/src/app/game/match/match.page.html`
- `pwm-project/frontend/src/app/game/match/match.page.scss`
- `pwm-project/frontend/src/app/game/components/army-modal/army-modal.component.html`

Riutilizzare i gestori esistenti di click e hover della mappa e collegarli a un unico `selectedArmyId` / `selectedTarget`.

### Criteri di completamento

- Un ordine standard richiede al massimo tre interazioni dopo la selezione dell'armata.
- Le coordinate sono compilabili solo tramite una modalita avanzata.
- La selezione dell'armata resta visibile sulla mappa e nel pannello ordini.
- Il comportamento e coerente su desktop e mobile.

---

## Fase 2 - Preview tattica e conferma

### Obiettivo

Trasformare la preview esistente in una decisione tattica comprensibile.

### Informazioni da mostrare

- percorso completo e percorso residuo;
- distanza totale;
- ETA reale;
- velocita dell'armata;
- penalita del terreno;
- uso previsto di porto o aeroporto;
- consumo logistico stimato;
- raggio d'attacco al termine;
- presenza di nemici rilevati;
- rischio di intercettazione;
- eventuale dichiarazione di guerra;
- motivo di invalidita del percorso.

### Backend

Estendere `PATH_PREVIEW_RESULT` con dati strutturati:

```json
{
  "isValid": true,
  "distanceKm": 1240,
  "etaMs": 7200000,
  "routeType": "land_sea_land",
  "warnings": [],
  "risks": ["enemy_detection_possible"],
  "requiresWarDeclaration": true,
  "arrivalCombat": {
    "possible": true,
    "attackRangeKm": 15
  }
}
```

Non usare il testo del messaggio come unico modo per determinare il comportamento dell'interfaccia.

### Frontend

Aggiungere un pannello di riepilogo con:

```text
Armata: Prima Armata
Azione: Conquista
Destinazione: Regione X
Durata: 02:14:30
Percorso: terrestre + navale
Rischio: medio
Conferma richiesta: dichiarazione di guerra
```

Il marker di destinazione deve restare trascinabile e la preview deve essere ricalcolata automaticamente.

### Criteri di completamento

- Il giocatore sa perche un ordine e invalido senza consultare log o console.
- Gli ordini che dichiarano guerra richiedono una conferma esplicita.
- L'ETA visualizzata corrisponde al valore usato dal server.
- La preview non invia l'ordine definitivo.

---

## Fase 3 - Centro ordini e controllo operativo

### Obiettivo

Dare al giocatore un'unica vista per controllare tutte le missioni attive.

### Nuovo componente consigliato

Creare:

```text
pwm-project/frontend/src/app/game/components/order-center/
```

Il componente dovrebbe mostrare per ogni ordine:

- armata;
- icona del tipo di missione;
- destinazione;
- stato;
- ETA o timer combattimento;
- HP e numero unita;
- percorso residuo;
- ultimo evento ricevuto.

Azioni rapide:

- `Apri sulla mappa`;
- `Annulla`;
- `Rientra`;
- `Ritirati`;
- `Reindirizza`;
- `Insegui`;
- `Rinforza`.

### Eventi WebSocket da standardizzare

```text
ORDER_ACCEPTED
ORDER_REJECTED
ORDER_UPDATED
ORDER_COMPLETED
ORDER_CANCELLED
COMBAT_STARTED
COMBAT_ROUND_RESOLVED
COMBAT_RETREAT_AVAILABLE
COMBAT_ENDED
```

Gli eventi attuali come `TROOPS_MOVED`, `COMBAT_EVENT` e `TACTICAL_DECISION_REQUIRED` possono essere mantenuti temporaneamente per compatibilita, ma ogni nuovo evento dovrebbe seguire il contratto standard.

### Criteri di completamento

- Tutti gli ordini attivi sono visibili senza aprire la modale esercito.
- La perdita della connessione non fa perdere lo stato visuale dell'ordine.
- Alla riconnessione il client ricostruisce il centro ordini dallo stato iniziale del match.

---

## Fase 4 - Armate miste e gestione delle formazioni

### Obiettivo

Permettere di costruire formazioni militari complete e modificarle durante la partita.

### Backend

Modificare la creazione dell'armata per accettare una composizione completa:

```json
{
  "armyId": "army-1",
  "armyName": "Prima Armata",
  "composition": {
    "fante": 500,
    "carro_armato": 40,
    "artiglieria": 12,
    "sam_mobile": 8
  },
  "location": "region-42"
}
```

Aggiungere operazioni distinte:

- `CREATE_ARMY`;
- `UPDATE_ARMY_COMPOSITION`;
- `SPLIT_ARMY`;
- `MERGE_ARMIES`;
- `REINFORCE_ARMY`;
- `DISBAND_ARMY`.

Validare:

- riserve disponibili;
- capacita di trasporto;
- compatibilita di dominio;
- velocita minima della formazione;
- requisiti logistici;
- eventuali limiti di comando.

### Frontend

Sostituire il selettore singolo della modale con una tabella di composizione:

```text
Tipo unita       Disponibili       Assegnate       Quantita
Fanteria         1200              500             [-] 500 [+]
Carri            80                40              [-] 40 [+]
Artiglieria      30                12              [-] 12 [+]
```

Aggiungere:

- template salvabili;
- duplicazione formazione;
- suggerimento automatico della composizione;
- indicazione dell'unita piu lenta;
- stima di danno, HP e velocita prima della conferma.

### Criteri di completamento

- Un'armata puo contenere piu tipologie di truppe.
- L'utente vede subito l'effetto della composizione su velocita, danno e HP.
- Una formazione non valida non puo essere inviata al server.

---

## Fase 5 - Gruppi, selezione multipla e coda ordini

### Obiettivo

Ridurre il numero di azioni necessarie quando il giocatore controlla molte armate.

### Funzioni

- selezione multipla con Ctrl/tap prolungato;
- selezione rettangolare sulla mappa;
- gruppi numerati o nominati;
- filtro per dominio e stato;
- ordine simultaneo a piu armate;
- waypoint condivisi;
- coda di ordini per singola armata;
- sincronizzazione dell'arrivo con ETA comune.

Il backend deve gestire missioni indipendenti per ogni armata, anche quando il frontend invia un comando di gruppo.

Il frontend deve mostrare gli errori individuali senza annullare gli ordini validi delle altre armate.

### Criteri di completamento

- Un ordine di gruppo indica quante armate sono state accettate e quante rifiutate.
- Ogni armata conserva il proprio percorso e la propria ETA.
- Una modifica a un membro del gruppo non modifica implicitamente gli altri.

---

## Fase 6 - Combattimento leggibile e decisioni tattiche

### Obiettivo

Rendere il combattimento comprensibile e controllabile senza nascondere la logica dietro semplici toast.

### UI combattimento

Visualizzare:

- attaccante e difensore;
- composizione delle due armate;
- HP attuali e massimi;
- danno dell'ultimo round;
- prossima risoluzione;
- distanza e gittata;
- stato della ritirata;
- opzioni disponibili.

Azioni possibili:

- continua attacco;
- ritirati;
- insegui;
- cambia bersaglio, se consentito;
- interrompi missione;
- richiedi rinforzi.

### Backend

Aggiungere un identificativo stabile del combattimento e uno snapshot sintetico:

```json
{
  "combatId": "combat-1",
  "attackerArmyId": "army-1",
  "defenderArmyId": "army-2",
  "round": 4,
  "nextRoundAt": 1762500000000,
  "distanceKm": 8.4,
  "attackerCanFire": true,
  "defenderCanFire": true,
  "retreatAvailable": false
}
```

Questo evita che il frontend debba ricostruire lo stato da eventi parziali.

### Criteri di completamento

- L'utente capisce perche una parte infligge o non infligge danno.
- La ritirata e l'inseguimento sono azioni esplicite.
- Un combattimento resta coerente dopo riconnessione o refresh.

---

## Fase 7 - Ottimizzazione del motore

### Obiettivo

Mantenere tempi di risposta stabili con molte armate e partite attive.

### Radar di combattimento

File principale:

- `pwm-project/services/match/middleware/combatTriggerEngine.js`

Interventi:

1. mantenere in Redis una lista delle armate in movimento o in combattimento;
2. usare indici geografici Redis per cercare solo i nemici vicini;
3. eliminare le query PostgreSQL ripetute per ogni armata;
4. caricare le mosse attive con una query aggregata o una cache Redis;
5. elaborare solo le partite con attivita recente;
6. usare eventi di arrivo quando possibile, invece di affidarsi sempre al polling;
7. conservare lock e idempotenza per evitare doppi combattimenti.

### Rendering mappa

File principale:

- `pwm-project/frontend/src/app/game/match/match.page.ts`

Interventi:

- aggiornare solo le armate cambiate;
- separare marker, percorsi e stati in sorgenti diverse;
- evitare `renderArmies()` completo a ogni tick;
- aggiornare i percorsi a intervalli ridotti;
- usare `requestAnimationFrame` solo per l'animazione necessaria;
- mantenere una cache `armyId -> feature`;
- rimuovere marker e layer non piu presenti in modo differenziale.

### Metriche da aggiungere

- tempo medio di calcolo percorso;
- tempo medio di preview;
- numero di ordini rifiutati;
- latenza comando WebSocket;
- durata aggiornamento mappa;
- numero di armate controllate dal radar;
- query SQL per ciclo del combat engine;
- tempo di risoluzione di un round.

---

## Test necessari

### Backend

Aggiungere test per:

- ordine duplicato;
- ordine verso alleato;
- dichiarazione di guerra esplicita;
- percorso invalido;
- attraversamento mare senza trasporto;
- annullamento durante movimento;
- annullamento durante combattimento;
- armata mista;
- split e merge;
- ritirata e inseguimento;
- riconnessione durante una missione;
- riconnessione durante un combattimento.

### Frontend

Verificare almeno:

- selezione armata e bersaglio sulla mappa;
- preview aggiornata trascinando il marker;
- conferma e annullamento ordine;
- selezione multipla;
- visualizzazione timer;
- aggiornamento dopo evento WebSocket;
- ripristino dopo `INITIAL_STATE`;
- layout mobile;
- messaggi di errore leggibili.

### Test end-to-end

Scenario minimo:

```text
Crea armata -> seleziona armata -> seleziona regione -> visualizza preview -> conferma
-> ricevi movimento -> intercetta nemico -> combatti -> ritirati o conquista
```

---

## Ordine di consegna consigliato

### Release 1

- Fase 0: contratti e stati;
- Fase 1: comando dalla mappa;
- Fase 2: preview tattica;
- test del flusso base.

### Release 2

- Fase 3: centro ordini;
- eventi WebSocket standardizzati;
- gestione riconnessione;
- annullamento e rientro piu chiari.

### Release 3

- Fase 4: armate miste;
- rinforzi, split, merge;
- template di formazione.

### Release 4

- Fase 5: gruppi e coda ordini;
- Fase 6: pannello combattimento;
- decisioni tattiche esplicite.

### Release 5

- Fase 7: ottimizzazione radar e rendering;
- metriche operative;
- test di carico.

## Risultato atteso

Al termine del piano il giocatore dovrebbe poter controllare le operazioni dalla mappa, capire in anticipo costi e rischi, gestire piu armate con pochi comandi e prendere decisioni durante il combattimento senza ricorrere a coordinate manuali, toast ambigui o schermate separate.
