# Piano di testing per LLM - Truppe, ordini e combattimento

## Istruzioni per la LLM

Agisci come QA engineer senior specializzato in sistemi realtime, giochi strategici e applicazioni Angular/Node.js.

Devi verificare il flusso completo di gestione militare del progetto Planetary War Manager senza alterare il comportamento di funzionalita non coinvolte.

Non limitarti a controllare che il codice compili. Devi verificare:

- correttezza funzionale;
- consistenza tra frontend, WebSocket, Redis e PostgreSQL;
- concorrenza e idempotenza;
- comportamento dopo riconnessione;
- sicurezza dei comandi;
- usabilita del flusso operativo;
- prestazioni con molte armate.

Se trovi un problema, non correggerlo automaticamente durante la fase di testing. Riportalo con:

1. severita;
2. file e metodo coinvolto;
3. passaggi per riprodurlo;
4. comportamento atteso;
5. comportamento osservato;
6. possibile causa;
7. test che lo dimostra.

---

## Contesto tecnico

Repository principale:

```text
/home/mrk/Documents/Planetary-War-Manager
```

Servizi principali:

```text
pwm-project/services/match/
pwm-project/services/shared/
pwm-project/frontend/src/app/game/match/
pwm-project/frontend/src/app/game/components/army-modal/
pwm-project/frontend/src/app/game/components/order-center/
pwm-project/frontend/src/app/game/components/combat-center/
```

Componenti coinvolti:

- `services/match/handlers/movement.handler.js`
- `services/match/handlers/army.handler.js`
- `services/match/middleware/movementLogic.js`
- `services/match/middleware/combatLogic.js`
- `services/match/middleware/combatTriggerEngine.js`
- `services/match/middleware/armyState.js`
- `services/match/server.js`
- `frontend/src/app/game/match/match.page.ts`
- `frontend/src/app/game/match/match.page.html`
- `frontend/src/app/game/components/army-modal/army-modal.component.ts`
- `frontend/src/app/game/components/order-center/order-center.component.ts`
- `frontend/src/app/game/components/combat-center/combat-center.component.ts`

Tecnologie:

- Angular/Ionic;
- Node.js;
- WebSocket;
- Redis;
- PostgreSQL;
- MapLibre;
- pathfinding A*;
- Docker Compose.

---

## Funzionalita da verificare

Il sistema attualmente supporta:

- creazione di armate;
- armate con composizioni miste;
- rinforzo delle armate;
- divisione delle armate;
- fusione delle armate;
- template locali di formazione;
- movimento con pathfinding A*;
- waypoint;
- preview del percorso;
- tipo di rotta terrestre, navale o combinata;
- ETA e distanza;
- dichiarazione di guerra esplicita;
- ordini idempotenti tramite `commandId`;
- stati canonici in `army.state`;
- compatibilita con gli stati legacy in `status`;
- ordini multipli;
- gruppi nominati;
- box-select sulla mappa;
- coda missioni per armata;
- partenze sincronizzate tramite ETA;
- Centro ordini;
- storico sintetico degli eventi;
- Centro combattimento;
- combattimento a round;
- snapshot tattico con distanza e gittata;
- ritirata;
- inseguimento;
- mantenimento posizione;
- aggiornamenti realtime via WebSocket;
- ripristino dello stato dopo `INITIAL_STATE`;
- throttling del rendering dei percorsi;
- metriche Redis del combat trigger.

---

## Preparazione dell'ambiente

Prima di eseguire i test:

1. verifica la presenza di Node.js, npm, Docker e Docker Compose;
2. leggi i README e `docker-compose.yml` prima di avviare servizi;
3. verifica che non esistano modifiche utente non correlate;
4. non cancellare database, volumi o dati esistenti senza autorizzazione esplicita;
5. usa un match di test isolato;
6. registra commit o hash di riferimento, se disponibili;
7. annota versione di Node, npm, Angular e Redis.

Comandi iniziali consigliati:

```bash
cd /home/mrk/Documents/Planetary-War-Manager
cd pwm-project/frontend && npm run build
cd ../../
node --check pwm-project/services/match/handlers/army.handler.js
node --check pwm-project/services/match/handlers/movement.handler.js
node --check pwm-project/services/match/middleware/movementLogic.js
node --check pwm-project/services/match/middleware/combatLogic.js
node --check pwm-project/services/match/middleware/combatTriggerEngine.js
node --check pwm-project/services/match/server.js
```

Se Docker e i servizi non sono disponibili, esegui comunque i test statici e dichiarare esplicitamente quali test runtime non sono stati eseguiti.

---

# Livello 0 - Static analysis e build

## 0.1 Build frontend

Eseguire:

```bash
cd pwm-project/frontend
npm run build
```

Criteri:

- il comando termina con codice `0`;
- nessun errore TypeScript o template;
- eventuali warning sono riportati separatamente;
- il bundle viene generato correttamente.

## 0.2 Sintassi backend

Eseguire `node --check` su tutti i file modificati e sui servizi principali.

Criteri:

- nessun errore di parsing;
- nessun import mancante;
- nessun simbolo usato prima di essere definito in modo incompatibile.

## 0.3 Controllo diff

```bash
git diff --check
```

Verificare inoltre:

- nessun file generato accidentalmente modificato;
- nessun log o segreto aggiunto;
- nessun cambiamento non correlato.

---

# Livello 1 - Test del contratto degli ordini

## 1.1 Creazione ordine standard

Scenario:

1. selezionare un'armata standby;
2. selezionare una destinazione valida;
3. visualizzare la preview;
4. confermare l'ordine.

Verificare:

- il payload contiene `commandId`;
- il payload contiene `type` e `mode` compatibile;
- sono presenti `armyId`, destinazione e waypoint;
- il server risponde con `ORDER_ACCEPTED`;
- il movimento viene pubblicato con `TROOPS_MOVED`;
- `army.state` diventa `moving`;
- l'armata appare nel Centro ordini.

## 1.2 Idempotenza

Inviare due volte lo stesso payload con lo stesso `commandId`.

Atteso:

- il primo ordine viene accettato;
- il secondo non crea una seconda missione;
- il server restituisce `ORDER_DUPLICATE`;
- il percorso non viene duplicato;
- non viene dichiarata guerra due volte.

## 1.3 Retry con nuovo commandId

Inviare lo stesso ordine con un nuovo `commandId` dopo un errore temporaneo.

Atteso:

- il secondo comando può essere processato;
- non esistono claim Redis bloccanti del primo tentativo;
- lo stato dell'armata resta coerente.

## 1.4 Errori codificati

Provare almeno:

- match inesistente;
- match non iniziato;
- armata inesistente;
- coordinate di partenza non valide;
- destinazione non valida;
- percorso non valido;
- bersaglio alleato;
- armata in rifornimento;
- ordine non applicabile.

Per ogni errore verificare:

- presenza di `type: ERROR`;
- presenza di un `code` stabile;
- messaggio leggibile nel toast;
- nessuna mutazione parziale del match.

---

# Livello 2 - Test movimento e pathfinding

## 2.1 Movimento terrestre

Verificare:

- percorso valido;
- distanza coerente;
- ETA positiva;
- marker che segue il percorso;
- percorso residuo aggiornato;
- arrivo a destinazione;
- stato finale `standby`;
- pulizia di `path`, `etaMs` e `startTime`.

## 2.2 Movimento navale

Testare:

- destinazione raggiungibile via mare;
- destinazione terrestre non raggiungibile senza porto;
- porto disponibile;
- porto assente;
- unità navale pura;
- rotta combinata terra/mare/terra.

Verificare il campo `routeType` e gli eventuali warning.

## 2.3 Movimento aereo

Testare:

- aeroporto di partenza e arrivo;
- trasporto insufficiente;
- aeroporto mancante;
- ETA coerente con la velocita aerea;
- rotta `land_air_land`.

## 2.4 Waypoint

Verificare:

- aggiunta waypoint;
- spostamento del waypoint;
- eliminazione waypoint;
- ricalcolo preview;
- percorso finale con `routeType: waypoints`;
- ordine inviato con tutti i waypoint.

## 2.5 Annullamento movimento

Annullare un'armata durante il tragitto.

Atteso:

- viene calcolata la posizione corrente;
- viene generato il percorso di ritorno;
- lo stato diventa `returning`/`moving` coerentemente;
- non viene persa la composizione;
- l'ordine compare nel Centro ordini come rientro.

---

# Livello 3 - Test UX e usabilita

## 3.1 Flusso dalla mappa

Verificare il flusso:

```text
Selezione armata -> selezione bersaglio -> scelta azione -> preview -> conferma
```

Criteri:

- nessuna digitazione obbligatoria di coordinate;
- selezione visibile;
- banner di comando presente;
- target leggibile;
- azioni disponibili coerenti col bersaglio;
- annullamento sempre raggiungibile.

## 3.2 Box-select

Testare:

- selezione con `Shift + trascinamento`;
- selezione di una sola armata;
- selezione di piu armate;
- selezione di armate nemiche, che devono essere ignorate;
- rettangolo vuoto;
- selezione su mappa mobile o touch fallback.

## 3.3 Gruppi

Verificare:

- salvataggio gruppo nominato;
- aggiornamento gruppo con stesso nome;
- caricamento gruppo;
- eliminazione gruppo;
- armata rimossa dal match;
- dati separati per utente;
- persistenza dopo refresh.

## 3.4 Preview

Verificare che mostri:

- azione;
- bersaglio;
- numero armate;
- ETA;
- distanza;
- rotta;
- waypoint;
- errori;
- warning diplomatici.

## 3.5 Dichiarazione di guerra

Testare:

1. preview con `requiresWarDeclaration: true`;
2. click su `CONFERMA`;
3. verifica del secondo passaggio;
4. click su `TORNA INDIETRO`;
5. verifica che nessun ordine sia stato inviato;
6. ripetizione e click su `DICHIARA E INVIA`;
7. verifica di ordine e stato guerra.

---

# Livello 4 - Test armate e formazioni

## 4.1 Armata mista

Creare una composizione con almeno tre tipi:

```json
{
  "fante": 500,
  "carro_armato": 40,
  "artiglieria": 12
}
```

Verificare:

- riserve scalate correttamente;
- composizione salvata integralmente;
- HP e danno aggiornati;
- velocita determinata dall'unita piu lenta;
- armata visualizzata correttamente.

## 4.2 Formazione invalida

Provare:

- composizione vuota;
- quantita negativa;
- quantita decimale;
- unita inesistente;
- riserve insufficienti;
- doppio invio.

## 4.3 Split

Verificare:

- split di armata standby;
- divisione a meta delle quantita;
- nuovo identificativo univoco;
- due armate con stato standby;
- split di armata con una sola unita;
- split durante movimento o combattimento.

## 4.4 Merge

Verificare:

- merge di due armate standby nella stessa posizione;
- composizioni sommate;
- armata sorgente rimossa;
- armata destinazione mantenuta;
- merge tra posizioni diverse rifiutato;
- merge durante combattimento rifiutato;
- merge della stessa armata rifiutato.

## 4.5 Rinforzo

Verificare:

- rinforzo di armata standby;
- riserve scalate;
- composizione aggiornata;
- rinforzo con riserve insufficienti;
- rinforzo durante movimento;
- rinforzo durante combattimento.

## 4.6 Template

Verificare:

- salvataggio template;
- sovrascrittura stesso nome;
- caricamento template;
- eliminazione template;
- template isolati tra utenti;
- template con unità non più disponibili;
- validazione delle riserve al momento dell'uso.

---

# Livello 5 - Test Centro ordini

## 5.1 Visualizzazione

Verificare:

- missioni attive filtrate per proprietario;
- stato canonico e fallback legacy;
- destinazione;
- ETA dinamica;
- numero unità;
- ultimo evento;
- stato vuoto.

## 5.2 Filtri

Verificare i filtri:

- tutti;
- movimento;
- combattimento;
- rientro/ritirata.

Ogni filtro deve aggiornare il conteggio e la lista senza alterare il match.

## 5.3 Coda missioni

Per una stessa armata:

1. inviare una prima missione;
2. accodare una seconda missione;
3. accodare una terza missione;
4. attendere `TROOPS_ARRIVED`;
5. verificare invio automatico della successiva.

Testare inoltre:

- annullamento cancella la coda;
- errore della missione successiva;
- riconnessione durante la coda;
- coda su piu armate;
- waypoint distinti per missione.

## 5.4 Sincronizzazione ETA

Inviare un gruppo di armate con ETA diverse.

Atteso:

- le armate piu veloci partono dopo un ritardo;
- gli ordini arrivano nello stesso momento previsto;
- annullando la preview i timer vengono cancellati;
- il pulsante resta disabilitato con meno di due armate.

---

# Livello 6 - Test combattimento

## 6.1 Ingaggio

Verificare:

- passaggio a stato `combat`;
- creazione combattimento;
- rimozione del percorso di movimento;
- Centro combattimento visibile;
- timer prossimo round.

## 6.2 Snapshot tattico

Verificare che `COMBAT_EVENT` contenga:

```json
{
  "combat": {
    "distanceKm": 8.4,
    "attackerRangeKm": 15,
    "defenderRangeKm": 10,
    "nextRoundAt": "..."
  }
}
```

Il frontend deve mostrare i valori senza ricostruirli da dati incompleti.

## 6.3 Danni e round

Verificare:

- danno attaccante;
- danno difensore;
- danno a zero fuori gittata;
- HP aggiornati;
- composizione aggiornata;
- evento `distrutta`;
- evento `sopravvissuta`;
- aggiornamento storico perdite.

## 6.4 Ritirata

Testare:

- pulsante `RITIRATI`;
- annullamento missione durante combattimento;
- stato `retreating`;
- percorso di fuga;
- pulizia del combattimento.

## 6.5 Decisione tattica

Quando arriva `TACTICAL_DECISION_REQUIRED`:

- mostrare il pannello decisione;
- `INSEGUI` invia `PURSUE`;
- `MANTIENI POSIZIONE` invia `HOLD`;
- la decisione scompare dopo l’invio;
- il server aggiorna correttamente il combattimento.

## 6.6 Riconnessione durante combattimento

1. avviare un combattimento;
2. chiudere o interrompere WebSocket;
3. ristabilire la connessione;
4. ricevere `INITIAL_STATE`;
5. verificare stato, HP, timer e Centro combattimento.

---

# Livello 7 - Sicurezza e concorrenza

## 7.1 Ownership

Tentare di comandare un’armata di un altro giocatore.

Atteso:

- rifiuto server;
- nessuna mutazione Redis;
- nessun broadcast illegittimo.

## 7.2 Alleanze

Testare:

- attacco a un alleato;
- conquista territorio alleato;
- merge con armata non propria;
- rinforzo armata non propria.

## 7.3 Race condition

Eseguire in parallelo:

- due ordini sulla stessa armata;
- split e disband simultanei;
- merge e movimento simultanei;
- rinforzo e reclutamento simultanei;
- due client che confermano lo stesso comando.

Verificare:

- una sola mutazione valida;
- nessuna riserva negativa;
- nessuna composizione persa;
- nessun doppio combattimento;
- stato finale coerente.

## 7.4 Payload malevoli

Provare:

- `armyId` non valido;
- quantità enormi;
- quantità negative;
- proprietà extra;
- `commandId` duplicati tra utenti;
- coordinate fuori range;
- waypoint con NaN o stringhe non valide.

---

# Livello 8 - Riconnessione e consistenza dati

Verificare il ripristino dopo:

- refresh pagina;
- chiusura browser;
- perdita temporanea Redis;
- riconnessione WebSocket;
- riavvio del servizio match;
- ripristino da snapshot PostgreSQL.

Controllare coerenza tra:

```text
Frontend matchArmies
Redis match state
PostgreSQL snapshot
mosse
spostamenti
attacco
```

Nessuna armata deve risultare:

- in movimento nel frontend ma standby in Redis;
- in combattimento in Redis ma assente dal pannello;
- con riserve scalate due volte;
- con `status` e `state` incompatibili.

---

# Livello 9 - Performance e carico

## 9.1 Rendering

Testare con:

- 10 armate;
- 50 armate;
- 100 armate;
- 20 armate in movimento simultaneo.

Misurare:

- FPS percepiti;
- durata di `renderArmies()`;
- frequenza di `setData()`;
- uso CPU browser;
- uso memoria;
- latenza interazione mappa.

Verificare che il layer percorsi non superi circa 10 aggiornamenti al secondo.

## 9.2 Combat trigger

Misurare Redis:

```bash
HGETALL metrics:combat_trigger
```

Controllare:

- `cycles` cresce regolarmente;
- `matches_scanned` non cresce per partite terminate;
- `engagements_started` corrisponde agli scontri reali;
- lock `engine_lock:combatTrigger` evita doppie esecuzioni.

## 9.3 Pathfinding

Misurare:

- tempo preview singola;
- tempo preview multipla;
- tempo con waypoint;
- tempo con trasporto porto/aeroporto;
- timeout o errori di pathfinding.

---

# Livello 10 - Test mobile e accessibilita

Verificare su viewport:

- 390x844;
- 768x1024;
- 1366x768;
- 1920x1080.

Controllare:

- pannelli non sovrapposti;
- pulsanti raggiungibili;
- testo senza overflow;
- box-select con touch fallback;
- Centro ordini utilizzabile;
- Centro combattimento leggibile;
- focus e titoli sui pulsanti;
- contrasto colori;
- azioni non affidate solo al colore;
- tastiera e `Escape` dove applicabile.

---

# Criteri globali di accettazione

Il test plan è superato solo se:

- build frontend superato;
- sintassi backend valida;
- nessun test P0 fallisce;
- nessuna riserva diventa negativa;
- nessun comando duplicato produce doppia mutazione;
- gli errori hanno codici stabili;
- il flusso completo e2e funziona;
- riconnessione e `INITIAL_STATE` ripristinano gli ordini;
- combattimenti e ritirate restano coerenti;
- desktop e mobile sono utilizzabili;
- eventuali warning residui sono documentati.

Un singolo fallimento P0 blocca l'approvazione.

---

# Priorita dei test

## P0 - Bloccanti

- build e sintassi;
- creazione armata;
- ordine movimento;
- idempotenza;
- ownership;
- riserve non negative;
- combattimento base;
- riconnessione;
- annullamento e ritirata.

## P1 - Alta priorita

- armate miste;
- split, merge e rinforzo;
- preview navale/aerea;
- Centro ordini;
- coda missioni;
- decisioni tattiche;
- box-select;
- sincronizzazione ETA.

## P2 - Qualita e scalabilita

- template;
- performance rendering;
- metriche Redis;
- test mobile;
- accessibilita;
- test di carico;
- resilienza a riavvio servizi.

---

# Formato obbligatorio del report LLM

```markdown
# Report QA - Planetary War Manager

## Ambiente
- commit:
- node:
- npm:
- browser:
- docker:
- match di test:

## Riepilogo
- test eseguiti:
- passati:
- falliti:
- bloccati:
- severita massima:

## P0
| ID | Test | Esito | Note |
|---|---|---|---|

## P1
| ID | Test | Esito | Note |
|---|---|---|---|

## P2
| ID | Test | Esito | Note |
|---|---|---|---|

## Problemi
### [P0/P1/P2] Titolo
- file/metodo:
- riproduzione:
- atteso:
- osservato:
- causa probabile:
- evidenza:

## Warning

## Test non eseguiti

## Raccomandazione finale
- APPROVATO
- APPROVATO CON RISERVE
- BLOCCATO
```

Non dichiarare `APPROVATO` se un test P0 è fallito o non eseguibile senza motivazione.
