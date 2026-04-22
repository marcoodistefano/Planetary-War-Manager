# PWM - Tactical Command Interface (Benchmark)

Un'interfaccia 3D per la simulazione e la gestione tattica di unità, basata su **MapLibre GL**, **Three.js** e **Redis**.

## Architettura

Il progetto si compone di tre moduli principali:
1. **Frontend WebGL / Three.js (index.html):** Visualizzazione su mappa 3D del mondo e del posizionamento tattico. Permette lo spawn di migliaia di truppe massimizzando le performance tramite *InstancedMesh* e *Viewport Culling*.
2. **Backend Real-Time (server.js):** Gestisce le comunicazioni tramite Socket.IO, legge i dati biometrici topografici e oceanografici dai file raster TIF e gestisce il salvataggio immediato in memoria cache.
3. **Queue Sync Worker (sync_worker.js):** Si assicura di estrarre le chiavi aggiornate da Redis in cicli di 3 minuti trasferendole stabilmente in un database persistente MySQL, prevenendo la perdita di dati senza rallentare il gioco in tempo reale.

## Prerequisiti

Assicurati di aver installato:
- **Node.js** (v18+)
- **Redis Server** (In esecuzione locale sulla porta 6379)
- **MySQL/MariaDB** (Per il salvataggio persistente tramite `sync_worker.js`, con un db `pwm_tactical` e la relativa tabella `truppe`)

## Installazione

1. Clona la repository o assicurati di aver estratto tutti i file.
2. Installa le dipendenze npm:
   ```bash
   npm install
   ```
3. Avvia una simulazione di prova.

## Avvio Rapido (Tutto in uno)

Puoi avviare il Backend Socket.io, il Worker di Sincronizzazione e il Frontend simultaneamente usando il nuovo file bash interattivo:

```bash
bash start.sh
```

*(Verranno avviati in background il server API su porta `3000` e un file server per l'interfaccia web visibile su `http://localhost:8080`)*

## Autenticazione JWt

Il server si aspetta connessioni socket.io autenticate tramite JWT. Puoi generare un nuovo token valido, ad esempio in `id_user: 1`, semplicemente ricorrendo a:
```bash
node generate_token.js
```