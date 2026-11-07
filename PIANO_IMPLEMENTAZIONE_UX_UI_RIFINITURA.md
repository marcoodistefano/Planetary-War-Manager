# Piano di implementazione UX/UI - Rifinitura interfaccia di gioco

## Obiettivo

Portare l'interfaccia di gioco da funzionalmente completa a coerente, leggibile e pronta per un utilizzo prolungato su desktop e mobile.

Il piano riguarda esclusivamente la user experience e la user interface. Non modifica le regole di movimento, combattimento o pathfinding salvo quando serve a rappresentare correttamente uno stato all'utente.

## Flusso operativo target

```text
Ingresso nel match
  -> stato di caricamento chiaro
  -> lettura della mappa e degli indicatori
  -> selezione armata
  -> scelta bersaglio
  -> preview tattica
  -> conferma o annullamento
  -> feedback di invio
  -> monitoraggio dal Centro ordini
  -> evento di arrivo, errore o combattimento
  -> decisione tattica
  -> stato finale leggibile
```

## Aree coinvolte

File principali:

- `pwm-project/frontend/src/app/game/match/match.page.ts`
- `pwm-project/frontend/src/app/game/match/match.page.html`
- `pwm-project/frontend/src/app/game/match/match.page.scss`
- `pwm-project/frontend/src/app/game/components/army-modal/army-modal.component.ts`
- `pwm-project/frontend/src/app/game/components/army-modal/army-modal.component.html`
- `pwm-project/frontend/src/app/game/components/army-modal/army-modal.component.scss`
- `pwm-project/frontend/src/app/game/components/order-center/`
- `pwm-project/frontend/src/app/game/components/combat-center/`
- `pwm-project/frontend/src/app/game/components/_home-modal-shell.scss`
- `pwm-project/frontend/src/app/global.scss`

---

# Fase UX-0 - Inventario e regole visive

## Obiettivo

Stabilire una base coerente prima di modificare singoli pannelli.

## Attivita

- inventariare colori, bordi, ombre, raggi e spaziature esistenti;
- creare variabili SCSS per:
  - superficie;
  - superficie elevata;
  - bordo neutro;
  - bordo informativo;
  - stato positivo;
  - stato warning;
  - stato pericolo;
  - testo primario;
  - testo secondario;
  - testo disabilitato;
- uniformare la tipografia dei titoli, label, dati e timer;
- ridurre gli stili inline nei template;
- standardizzare dimensioni e icone dei pulsanti;
- definire una scala responsive comune.

## Criteri di completamento

- Nessun nuovo colore inserito direttamente nei componenti senza variabile motivata.
- Gli stessi stati usano sempre lo stesso colore e la stessa icona.
- Pulsanti equivalenti hanno dimensioni e gerarchia coerenti.

---

# Fase UX-1 - Stati di caricamento e connessione

## Obiettivo

Rendere sempre evidente cosa sta succedendo quando il gioco sta caricando, calcolando o riconnettendo.

## Stati da rappresentare

- caricamento partita;
- caricamento mappa;
- caricamento regole;
- calcolo percorso;
- invio ordine;
- ordine accettato;
- ordine rifiutato;
- riconnessione WebSocket;
- connessione persa;
- stato sincronizzato;
- errore temporaneo;
- errore definitivo.

## Implementazione

Aggiungere un piccolo `ConnectionStatusBanner` o un blocco equivalente nella pagina match:

```text
ONLINE
SINCRONIZZAZIONE...
RICONNESSIONE...
OFFLINE
```

Aggiungere indicatori di caricamento locali:

- skeleton nel Centro ordini;
- spinner o progress indicator durante la preview;
- stato `Invio ordine...` sul pulsante conferma;
- disabilitazione temporanea dei comandi duplicabili.

## Criteri di completamento

- L'utente non può confondere un'attesa con un comando fallito.
- Un ordine non può essere inviato due volte mentre il primo è ancora in elaborazione.
- Dopo riconnessione compare un feedback di sincronizzazione completata.

---

# Fase UX-2 - Feedback e messaggi

## Obiettivo

Sostituire feedback frammentati o ambigui con messaggi contestuali e coerenti.

## Regole

- toast: solo per eventi brevi e non bloccanti;
- inline message: per errori legati al pannello aperto;
- dialog: solo per azioni irreversibili o diplomatiche;
- banner: per stato connessione, guerra o evento globale;
- centro ordini: per cronologia missioni;
- centro combattimento: per decisioni tattiche.

## Interventi

- evitare toast duplicati tra conferma locale e `ORDER_ACCEPTED`;
- visualizzare il codice errore solo nei dettagli tecnici, non nel messaggio principale;
- fornire sempre un'azione quando possibile:
  - `Riprova`;
  - `Apri armata`;
  - `Centra sulla mappa`;
  - `Annulla`;
  - `Torna alla preview`;
- distinguere errore di validazione, errore di rete e rifiuto del server;
- mostrare una conferma chiara per dichiarazione di guerra, nucleare, abbandono e scioglimento.

## Criteri di completamento

Ogni messaggio deve rispondere almeno a una domanda:

```text
Cosa è successo?
Perché è successo?
Cosa posso fare ora?
```

---

# Fase UX-3 - Mappa e selezione delle armate

## Obiettivo

Rendere la mappa leggibile anche con molte armate e ridurre gli errori di selezione.

## Interventi

- evidenziare in modo persistente le armate selezionate;
- differenziare selezione singola, multipla e gruppo;
- mostrare un contorno dedicato alle armate proprie;
- mostrare il percorso residuo con gerarchia visiva rispetto alla preview;
- aggiungere legenda compatta per:
  - proprie armate;
  - alleati;
  - nemici visibili;
  - armate in movimento;
  - armate in combattimento;
  - destinazione;
  - waypoint;
- evitare che marker sovrapposti nascondano il conteggio;
- mostrare un riepilogo quando il box-select seleziona zero armate;
- fornire un fallback touch al box-select desktop;
- mantenere sempre visibile il bersaglio selezionato durante la preview.

## Test UX

- una armata;
- piu armate vicine;
- armate proprie e nemiche nella stessa area;
- zoom basso;
- zoom alto;
- mappa mobile;
- mappa con connessione lenta.

---

# Fase UX-4 - Preview e conferma ordine

## Obiettivo

Rendere la preview una decisione tattica chiara e non solo un riepilogo tecnico.

## Pannello preview

Mostrare in ordine di importanza:

1. azione;
2. bersaglio;
3. armate coinvolte;
4. validita percorso;
5. ETA;
6. distanza;
7. tipo rotta;
8. waypoint;
9. warning diplomatici;
10. rischio o limitazione.

## Stati del pannello

### Calcolo

```text
Calcolo del percorso...
```

### Valido

```text
Ordine pronto per la conferma
```

### Non valido

```text
Ordine non eseguibile
Motivo: ...
Azione suggerita: ...
```

### Dichiarazione di guerra

Usare un secondo passaggio esplicito, con:

- proprietario del bersaglio;
- conseguenza diplomatica;
- pulsante primario distruttivo;
- pulsante per tornare alla preview.

## Criteri di completamento

- Nessun ordine definitivo parte durante il calcolo preview.
- Il pulsante primario riflette l'azione reale.
- I comandi non validi sono disabilitati con spiegazione visibile.
- Il pannello non copre il bersaglio sulla mappa.

---

# Fase UX-5 - Centro ordini

## Obiettivo

Trasformare il Centro ordini in una console di monitoraggio rapida e non invasiva.

## Interventi

- aggiungere stato di caricamento;
- mostrare il conteggio per filtro;
- evidenziare ordini appena cambiati;
- aggiungere timeline espandibile degli ultimi eventi;
- distinguere ETA, prossimo round e stato di rifornimento;
- mostrare la coda missioni per armata;
- indicare quando un ordine è stato ripristinato dopo riconnessione;
- permettere apertura diretta della preview o del combattimento;
- aggiungere un'azione `Rimuovi dalla coda`;
- mostrare errori individuali nei comandi di gruppo.

## Layout

Desktop:

- pannello laterale;
- lista densa;
- dettaglio espandibile.

Mobile:

- bottom sheet;
- una scheda per ordine;
- azioni sticky nella parte inferiore.

---

# Fase UX-6 - Centro combattimento

## Obiettivo

Rendere il combattimento leggibile in pochi secondi e supportare decisioni rapide.

## Informazioni

- nome delle due armate;
- proprietari;
- HP attuali e massimi;
- composizione sintetica;
- danno dell'ultimo round;
- distanza;
- gittata attaccante e difensore;
- prossimo round;
- stato della ritirata;
- evento più recente;
- eventuale decisione tattica pendente.

## Azioni

- `Ritirati`;
- `Insegui`;
- `Mantieni posizione`;
- `Apri sulla mappa`;
- `Apri storico`.

## Stati

- combattimento attivo;
- fuori gittata;
- ritirata disponibile;
- decisione richiesta;
- combattimento concluso;
- dati in sincronizzazione.

## Criteri di completamento

- Il giocatore capisce chi sta subendo danni e perché.
- Le decisioni tattiche non sono affidate esclusivamente a toast.
- Il pannello resta coerente dopo refresh o riconnessione.

---

# Fase UX-7 - Modale armate e formazioni

## Obiettivo

Rendere la gestione delle formazioni rapida anche per utenti non esperti.

## Interventi

- mostrare sempre il totale delle unità assegnate;
- mostrare riserve residue in tempo reale;
- evidenziare l'unità più lenta;
- mostrare effetto stimato su HP, danno e velocità;
- distinguere creazione, rinforzo e modifica;
- rendere evidente quale armata è attiva;
- impedire invii con composizione vuota;
- descrivere perché una combinazione non è valida;
- aggiungere conferma per split, merge e scioglimento;
- mostrare anteprima del risultato prima della mutazione.

## Template

- ricerca template;
- ordinamento per nome o utilizzo;
- rinomina;
- sovrascrittura esplicita;
- eliminazione con conferma;
- indicazione delle unità non più disponibili.

---

# Fase UX-8 - Responsive e accessibilita

## Viewport minimi

Testare almeno:

- 390x844;
- 768x1024;
- 1366x768;
- 1920x1080.

## Controlli

- nessun pannello sovrapposto in modo incoerente;
- nessun testo tagliato;
- nessun pulsante troppo piccolo;
- ordine dei controlli coerente con la priorità;
- dialog e bottom sheet chiudibili con gesto e tastiera;
- focus visibile;
- aria-label per icone senza testo;
- contrasto sufficiente;
- informazioni non comunicate solo tramite colore;
- supporto a `Escape` per preview, popup e gruppi;
- interazioni touch equivalenti a quelle desktop.

---

# Fase UX-9 - Onboarding e aiuto contestuale

## Obiettivo

Ridurre il tempo necessario per capire il primo ordine.

## Interventi

- tutorial non bloccante al primo ingresso;
- evidenziazione della sequenza selezione → bersaglio → preview;
- spiegazione breve dei colori della mappa;
- tooltip per icone non ovvie;
- spiegazione della differenza tra spostamento, attacco e conquista;
- messaggio esplicativo per il primo combattimento;
- possibilità di disattivare il tutorial;
- riapertura dell'aiuto dal menu impostazioni.

Il tutorial non deve coprire permanentemente la mappa e non deve impedire il gioco dopo il primo completamento.

---

# Fase UX-10 - Pulizia tecnica UI

## Interventi

- correggere il warning Angular sull'optional chaining;
- ridurre gli stili inline;
- estrarre componenti ripetuti per banner, pulsanti e timer;
- rimuovere codice morto e commenti temporanei;
- centralizzare le label degli stati;
- evitare duplicazione tra toast e pannelli;
- verificare `OnPush` e `ChangeDetectorRef` nei componenti realtime;
- controllare la distruzione di timer, marker, subscription e listener;
- mantenere la UI aggiornata senza `detectChanges()` superflui.

---

# Ordine operativo di implementazione

## Release UX-1 - Stati e feedback

1. Fase UX-0;
2. Fase UX-1;
3. Fase UX-2;
4. correzione warning Angular;
5. test responsive iniziali.

## Release UX-2 - Comando sulla mappa

1. Fase UX-3;
2. Fase UX-4;
3. verifica box-select e touch;
4. test ordine completo.

## Release UX-3 - Monitoraggio

1. Fase UX-5;
2. Fase UX-6;
3. test riconnessione;
4. test combattimento.

## Release UX-4 - Gestione formazioni

1. Fase UX-7;
2. verifica rinforzi, split e merge;
3. test template;
4. test riserve.

## Release UX-5 - Qualita prodotto

1. Fase UX-8;
2. Fase UX-9;
3. Fase UX-10;
4. test end-to-end;
5. test di carico;
6. revisione finale UX.

---

# Criteri finali di accettazione

Il lavoro UX/UI è pronto quando:

- ogni azione importante ha un feedback chiaro;
- loading, errori, offline e riconnessione sono comprensibili;
- la mappa resta leggibile con molte armate;
- preview e conferma non generano ambiguità;
- Centro ordini e Centro combattimento sono utilizzabili senza toast aggiuntivi;
- modale armate e template mostrano sempre l'effetto delle modifiche;
- desktop e mobile hanno flussi equivalenti;
- tastiera, touch e screen reader ricevono feedback adeguato;
- non restano warning noti non documentati;
- test funzionali, responsive e realtime sono superati.

## Formato di verifica per ogni intervento

```text
Area:
Componente:
Problema UX:
Modifica:
Stato di caricamento:
Stato di successo:
Stato di errore:
Stato offline:
Desktop:
Mobile:
Accessibilita:
Test eseguito:
Risultato:
```