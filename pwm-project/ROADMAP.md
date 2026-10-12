# PWM — Roadmap verso la v1.0

> **Creato il:** 12 Ottobre 2026  
> **Basato su:** `FEATURES.md` (commit locale #316)  
> **Obiettivo:** Definire la sequenza di implementazione ordinata per priorità e dipendenze al fine di raggiungere un **primo rilascio ufficiale stabile (v1.0)**.

---

## Indice

1. [Criterio di Priorità](#criterio-di-priorità)
2. [Panoramica delle voci aperte](#panoramica-delle-voci-aperte)
3. [Milestone M1 — Sicurezza e Integrità (Bloccante per il rilascio)](#milestone-m1--sicurezza-e-integrità-bloccante-per-il-rilascio)
4. [Milestone M2 — Core Gameplay Completo](#milestone-m2--core-gameplay-completo)
5. [Milestone M3 — Profilo Utente e UX](#milestone-m3--profilo-utente-e-ux)
6. [Milestone M4 — Moderazione e Sicurezza Avanzata](#milestone-m4--moderazione-e-sicurezza-avanzata)
7. [Milestone M5 — Progressione a Lungo Termine (Post-v1.0)](#milestone-m5--progressione-a-lungo-termine-post-v10)
8. [Dipendenze tra Milestone](#dipendenze-tra-milestone)
9. [Criteri di Accettazione per v1.0](#criteri-di-accettazione-per-v10)
10. [Changelog della Roadmap](#changelog-della-roadmap)

---

## Criterio di Priorità

Ogni voce è classificata in base a tre assi:

| Asse | Domanda guida |
|---|---|
| **Sicurezza / Integrità** | Può causare vulnerabilità, perdita di dati o comportamenti incoerenti? |
| **Core Gameplay** | Impedisce o degrada significativamente il ciclo di gioco principale? |
| **UX / Rifinitura** | Peggiora l'esperienza utente in modo visibile ma non blocca il funzionamento? |

Le milestone sono ordinate: prima le voci **bloccanti per il rilascio**, poi quelle **necessarie per la qualità**, infine quelle **opzionali post-v1.0**.

---

## Panoramica delle Voci Aperte

Di seguito il riepilogo compatto di tutte le funzionalità incomplete o mancanti identificate in `FEATURES.md`, con la milestone di destinazione assegnata.

| # | Voce | Sezione FEATURES | Milestone |
|---|---|---|---|
| A | Invalidazione sessione Redis al Logout | §1, §19.1 | **M1** |
| B | Protezione duplicati richieste di amicizia | §3, §19.1 | **M1** |
| C | Allineamento modello truppe Redis ↔ DB (`sync_workers`) | §18, §19.1 | **M1** |
| D | Fine partita formale + cleanup chiavi Redis | §5.1, §19.2 | **M2** |
| E | Statistiche di combattimento reali nel profilo | §2, §19.2 | **M2** |
| F | Aggiornamento username | §2, §19.3 | **M3** |
| G | Enforcement ban utente (middleware + gateway) | §1, §18, §19.3 | **M4** |
| H | Autenticazione a due fattori (2FA TOTP) | §1, §18, §19.3 | **M4** |
| I | Sistema obiettivi / achievement | §18, §19.4 | **M5** |

---

## Milestone M1 — Sicurezza e Integrità *(Bloccante per il rilascio)*

> Queste voci **devono** essere risolte prima di qualsiasi rilascio pubblico. Impattano la sicurezza delle sessioni, la consistenza dei dati e l'integrità del DB.

---

### M1-A · Invalidazione Sessione Redis al Logout

**Contesto:** Attualmente `POST /auth/logout` elimina il cookie `auth_token` lato client, ma la chiave `session:{sessionId}` in Redis resta attiva fino alla scadenza naturale del TTL (24h). Chiunque in possesso del token JWT può continuare a operare come utente autenticato.

**Struttura Operativa:**

1. **Modifica `POST /auth/logout`** in `user-service`:
   - Estrarre `sessionId` dal JWT decodificato (o dal cookie prima che venga cancellato).
   - Eseguire `DEL session:{sessionId}` su Redis.
   - Eseguire `SREM user_sessions:{userId} {sessionId}` per rimuovere la sessione dal set dell'utente.
   - Restituire `200 OK` solo dopo conferma della cancellazione.

2. **Verificare `authContext.js`:**
   - Assicurarsi che, dopo la verifica del JWT, venga eseguito un lookup in Redis (`EXISTS session:{sessionId}`).
   - Se la chiave non esiste, restituire `401 Unauthorized` anche con JWT valido (token revocato).

3. **Test:**
   - Logout → tentativo di accesso con il vecchio token → atteso `401`.
   - Logout multi-device: verificare che il set `user_sessions:{userId}` si svuoti progressivamente.

**Dipendenze:** Nessuna.  
**Stima complessità:** Bassa (modifiche localizzate in 2 file).

---

### M1-B · Protezione Duplicati Richieste di Amicizia

**Contesto:** `POST /friends/requests/sendByCode` e `POST /friends/requests/sendByUsername` non verificano se esiste già un'amicizia attiva o una richiesta pendente. Questo può causare errori di vincolo a livello DB o record duplicati.

**Struttura Operativa:**

1. **Aggiungere controllo preliminare nel model/service** prima dell'INSERT:

   Verifica amicizia già esistente (con ordinamento canonico):
   ```sql
   SELECT 1 FROM amici
   WHERE (utente1_id = $senderId AND utente2_id = $targetId)
      OR (utente1_id = $targetId AND utente2_id = $senderId);
   ```

   Verifica richiesta pendente in entrambe le direzioni:
   ```sql
   SELECT 1 FROM richieste_amici
   WHERE (mittente_id = $senderId AND destinatario_id = $targetId)
      OR (mittente_id = $targetId AND destinatario_id = $senderId);
   ```

2. **Restituire errore semantico appropriato:**
   - `409 Conflict` con body `{ "error": "friendship_exists" }` se già amici.
   - `409 Conflict` con body `{ "error": "request_pending" }` se richiesta già in volo.

3. **Gestione lato frontend:** Il frontend Angular deve intercettare il `409` e mostrare un messaggio descrittivo all'utente.

**Dipendenze:** Nessuna.  
**Stima complessità:** Bassa.

---

### M1-C · Allineamento Modello Truppe Redis ↔ DB (`sync_workers.js`)

**Contesto:** Lo stato delle truppe in Redis è aggregato a livello di match/giocatore (modello monolitico), mentre la tabella `truppe` in PostgreSQL modella la singola entità. In caso di crash o riavvio, il ripristino dallo stato DB può produrre incoerenze o perdita di dati granulari sulle singole truppe.

**Struttura Operativa:**

1. **Analisi dello stato attuale:**
   - Mappare la struttura della chiave Redis che rappresenta le truppe (es. hash `truppa:{id}` vs. struttura aggregata).
   - Confrontare con lo schema della tabella `truppe` nel DB.

2. **Definire la granularità target — Approccio consigliato per v1.0 (DB come snapshot):**
   - Aggiornare la tabella `truppe` con un dump aggregato per giocatore/match ad ogni ciclo di sync.
   - Accettare che la granularità fine sia mantenuta solo in Redis durante il gioco.
   - Il DB funge da snapshot di ripristino affidabile post-crash.
   - Rimandare la granularità per-entità a una revisione post-v1.0.

3. **Implementare la logica di dump in `sync_workers.js`:**
   - Ad ogni ciclo di sync, eseguire `UPSERT` sulla tabella `truppe` per ogni giocatore attivo nel match.
   - Includere: tipo truppa, quantità, posizione (se rilevante), stato.

4. **Verificare il meccanismo di ripristino al riavvio** (già presente in §17):
   - Assicurarsi che all'avvio del `match-service` le truppe vengano correttamente riallineate da DB → Redis.

5. **Test:**
   - Simulare kill del container `match-service` durante una partita attiva.
   - Al riavvio verificare che lo stato truppe sia coerente con l'ultimo snapshot.

**Dipendenze:** Nessuna (ma va completato prima di M2-D per garantire cleanup affidabile).  
**Stima complessità:** Media.

---

## Milestone M2 — Core Gameplay Completo

> Queste voci non bloccano l'avvio tecnico, ma senza di esse il ciclo di gioco è **incompleto** o produce dati inconsistenti a lungo termine.

---

### M2-D · Fine Partita Formale + Cleanup Chiavi Redis

**Contesto:** Il sistema ELO e la resa (`SURRENDER`) funzionano a livello individuale, ma la **chiusura globale del match** non prevede: archiviazione definitiva dello stato nel DB, pulizia delle chiavi Redis temporanee `match:{id}:*`, notifica formale di fine partita a tutti i partecipanti.

**Struttura Operativa:**

1. **Implementare `closeMatch(matchId)` nel `match-service`:**
   Questa funzione viene invocata dal **Match State Engine** quando viene rilevata una condizione di vittoria o timeout.

   Passi interni:
   - Aggiornare lo stato della partita in DB: `UPDATE partite SET stato = 'conclusa', ...`
   - Calcolare e applicare variazioni ELO per tutti i giocatori rimasti (vincitore/sconfitti).
   - Persistere le statistiche finali di ogni giocatore (vedi M2-E).
   - Trasmettere evento WS `MATCH_ENDED` a tutti i client connessi con classifica finale.
   - Eseguire routine di cleanup Redis (punto 2).

2. **Routine di Cleanup Redis:**
   Enumerare e cancellare tutte le chiavi relative al match usando `SCAN` + pattern matching (evitare `KEYS` in produzione):
   - `match:{id}:*` — tutte le chiavi di stato del match
   - Chiavi relative agli spostamenti attivi del match
   - `combattimenti:{id}:*` — chiavi di combattimento

3. **Gestione casi edge:**
   - Match con un solo giocatore rimasto → vittoria automatica.
   - Match con timeout → classificazione per numero di territori.
   - Match abbandonato da tutti → marcarlo come `annullato`.

4. **Test:**
   - Simulare fine partita per vittoria → verificare cleanup su Redis e archiviazione su DB.
   - Verificare assenza di chiavi `match:{id}:*` residue dopo il cleanup.
   - Verificare ricezione `MATCH_ENDED` sul frontend.

**Dipendenze:** M1-C (snapshot truppe affidabile prima del cleanup).  
**Stima complessità:** Alta.

---

### M2-E · Statistiche di Combattimento Reali nel Profilo

**Contesto:** `getProfileData` in `user-service` restituisce `win_rate`, `kills`, `deaths`, `territories`, `capitals` con valori hardcoded. Non esiste ancora una tabella `statistiche_match` né un meccanismo di aggiornamento a fine partita.

**Struttura Operativa:**

1. **Definire e creare la tabella `statistiche_match`** (aggiungere allo script `db-init`):
   ```sql
   CREATE TABLE statistiche_match (
     id            SERIAL PRIMARY KEY,
     utente_id     UUID NOT NULL REFERENCES utenti(id),
     partita_id    UUID NOT NULL REFERENCES partite(id),
     kills         INT DEFAULT 0,
     deaths        INT DEFAULT 0,
     territories   INT DEFAULT 0,
     capitals      INT DEFAULT 0,
     esito         VARCHAR(20),
     elo_delta     INT DEFAULT 0,
     created_at    TIMESTAMPTZ DEFAULT NOW()
   );
   ```

2. **Aggiornamento in-game:** Durante i round di combattimento in `combatLogic.js`:
   - Incrementare i contatori `kills` / `deaths` per i giocatori coinvolti.
   - Mantenere questi contatori in Redis (`match:{id}:stats:{userId}`) per performance.

3. **Persistenza a fine match** (integrata in `closeMatch()` di M2-D):
   - Dump dei contatori da Redis → tabella `statistiche_match` per ogni partecipante.
   - Calcolare e scrivere `esito` e `elo_delta`.

4. **Aggiornare `getProfileData`** in `user-service` — sostituire i valori hardcoded con query aggregata:
   ```sql
   SELECT
     SUM(kills) AS kills,
     SUM(deaths) AS deaths,
     COUNT(*) FILTER (WHERE esito = 'vinto') AS wins,
     COUNT(*) AS total_matches,
     ROUND(
       COUNT(*) FILTER (WHERE esito = 'vinto')::numeric
       / NULLIF(COUNT(*), 0) * 100, 1
     ) AS win_rate
   FROM statistiche_match
   WHERE utente_id = $userId;
   ```

5. **Test:**
   - Giocare una partita completa → verificare che il profilo mostri dati reali.
   - Edge case: profilo con 0 partite giocate (nessun risultato → zeri, non errore).

**Dipendenze:** M2-D (la persistenza avviene a chiusura partita).  
**Stima complessità:** Media.

---

## Milestone M3 — Profilo Utente e UX

> Raffinamenti dell'account che migliorano l'esperienza utente ma non bloccano il gameplay.

---

### M3-F · Implementazione Aggiornamento Username

**Contesto:** `POST /player/profile/username` esiste nel routing ma risponde con un messaggio placeholder `"Username aggiornato in costruzione"`. Nessuna logica di model è invocata.

**Struttura Operativa:**

1. **Lato backend — implementare il model:**
   - Validare il nuovo username: non vuoto, max 32 caratteri, stessi caratteri ammessi dalla registrazione.
   - Verificare unicità: `SELECT 1 FROM utenti WHERE username = $newUsername AND id != $userId`.
   - Se disponibile: `UPDATE utenti SET username = $newUsername WHERE id = $userId`.
   - Invalidare la cache Redis della home (`DEL home:{userId}`) e del profilo se presente.

2. **Gestione conflitti:**
   - Restituire `409 Conflict` con `{ "error": "username_taken" }` se già in uso.

3. **Considerare un cooldown** (opzionale per v1.0):
   - Limitare il cambio a una volta ogni N giorni per prevenire abusi.
   - Aggiungere campo `username_changed_at` alla tabella `utenti`.

4. **Lato frontend:**
   - Gestire il `409` nel componente profilo e visualizzare feedback appropriato.
   - Aggiornare lo stato globale `user-state.service.ts` con il nuovo username dopo il successo.

5. **Test:**
   - Cambio con username valido e disponibile → `200 OK`.
   - Cambio con username già in uso → `409 Conflict`.
   - Cambio con username non valido (troppo lungo, caratteri non permessi) → `400 Bad Request`.

**Dipendenze:** Nessuna.  
**Stima complessità:** Bassa.

---

## Milestone M4 — Moderazione e Sicurezza Avanzata

> Funzionalità necessarie per operare un servizio pubblico in modo sicuro e responsabile.

---

### M4-G · Enforcement Ban Utente

**Contesto:** La tabella `ban` e i campi `is_banned` / `is_perma_banned` su `utenti` esistono nel DB, ma nessun middleware o logica li verifica durante l'accesso. Un utente bannato può effettuare login e usare il servizio normalmente.

**Struttura Operativa:**

1. **Implementare endpoint di amministrazione ban** (nel pannello `amministratore`):
   - `POST /api/ban/:userId` — Inserisce record in `ban`, imposta `is_banned = true` (o `is_perma_banned`).
   - `POST /api/unban/:userId` — Rimuove il ban e reimposta i flag.
   - Protetti dalla stessa autenticazione Bearer del pannello admin.

2. **Aggiungere controllo ban in `authContext.js`:**
   - Dopo la verifica del JWT, eseguire: `SELECT is_banned, is_perma_banned FROM utenti WHERE id = $userId`.
   - Se bannato → `403 Forbidden` con `{ "error": "account_banned" }`.
   - **Ottimizzazione:** Cachare lo stato ban in Redis (`ban:{userId}` con TTL breve ~60s) per evitare query DB ad ogni richiesta.

3. **Invalidare sessioni Redis al ban:**
   - Quando viene applicato un ban, iterare `user_sessions:{userId}` e cancellare tutte le sessioni attive (logout forzato su tutti i dispositivi).

4. **Lato frontend:**
   - Gestire il `403 account_banned` nell'interceptor HTTP: reindirizzare a pagina dedicata con messaggio esplicativo.

5. **Test:**
   - Bannare un utente attivo → la sua prossima richiesta autenticata restituisce `403`.
   - Unbannare → l'utente torna accessibile normalmente.
   - Verifica invalidazione sessioni Redis al momento del ban.

**Dipendenze:** M1-A (il meccanismo di invalidazione sessione Redis deve essere funzionante).  
**Stima complessità:** Media.

---

### M4-H · Autenticazione a Due Fattori (2FA TOTP)

**Contesto:** I campi `two_fa_method`, `two_fa_secret`, `two_fa_enabled` esistono nella tabella `utenti` ma non c'è alcuna logica applicativa.

**Struttura Operativa:**

1. **Libreria:** Integrare `speakeasy` (o equivalente) per la generazione e verifica di codici TOTP (RFC 6238).

2. **Flusso di attivazione:**
   - `POST /player/profile/2fa/setup` — Genera un segreto TOTP, restituisce URI `otpauth://` e QR code (via libreria `qrcode`).
   - `POST /player/profile/2fa/confirm` — Verifica il primo codice OTP; se valido, salva il segreto in DB e imposta `two_fa_enabled = true`.
   - `DELETE /player/profile/2fa` — Disattiva il 2FA (richiede la password corrente come conferma).

3. **Integrazione nel flusso di Login:**
   - Se `two_fa_enabled = true`, `POST /auth/login` restituisce un token intermedio (non sessione completa) e `{ "requires_2fa": true }`.
   - Nuovo endpoint `POST /auth/login/verify-2fa`: accetta codice OTP + token intermedio; se valido, crea la sessione completa in Redis.

4. **Lato frontend:**
   - Aggiungere schermata di inserimento codice OTP nel flusso di login.
   - Aggiungere sezione 2FA nella pagina profilo (setup + QR code + disattivazione).

5. **Test:**
   - Attivare 2FA → verificare che il login richieda il codice OTP.
   - Codice OTP corretto → sessione creata.
   - Codice OTP errato → `401`.
   - Disattivazione con password corretta → login torna al flusso normale.

**Dipendenze:** M1-A (sessione Redis deve funzionare correttamente).  
**Stima complessità:** Alta.

---

## Milestone M5 — Progressione a Lungo Termine *(Post-v1.0)*

> Funzionalità che arricchiscono l'esperienza nel lungo periodo ma non sono richieste per il primo rilascio ufficiale.

---

### M5-I · Sistema Obiettivi / Achievement

**Contesto:** Le tabelle `obiettivi` e `obiettivi_utente` sono presenti nel DB ma prive di qualsiasi logica backend.

**Struttura Operativa:**

1. **Definire il catalogo degli obiettivi** (popolare la tabella `obiettivi`):
   - Esempi: "Conquista 10 territori in una partita", "Completa 5 ricerche tecnologiche", "Vinci 3 partite consecutive".
   - Campi: `id`, `nome`, `descrizione`, `tipo` (in-game / cumulativo), `target_value`, `ricompensa_tipo`, `ricompensa_valore`.

2. **Implementare il trigger di avanzamento:**
   - Creare un modulo `achievementEngine.js` che ascolta eventi di gioco (fine combattimento, costruzione struttura, fine partita, ecc.).
   - Ad ogni evento rilevante, aggiornare il progresso in `obiettivi_utente`.

3. **Implementare il riscatto ricompense:**
   - `POST /player/achievements/:id/claim` — Verifica completamento, eroga la ricompensa (ELO bonus, cosmetic, badge), aggiorna `obiettivi_utente.riscattato = true`.

4. **Lato frontend:**
   - Aggiungere pagina/sezione "Obiettivi" con barra di avanzamento per ogni achievement.

**Dipendenze:** M2-D, M2-E (dati di partita affidabili necessari come fonte per i trigger).  
**Stima complessità:** Alta.

---

## Dipendenze tra Milestone

```
M1-A (Logout Redis)
  └──► M4-G (Ban Enforcement — usa lo stesso meccanismo di invalidazione sessione)
  └──► M4-H (2FA — si innesta nel flusso di sessione)

M1-C (Sync Truppe Redis/DB)
  └──► M2-D (Cleanup Match — il dump affidabile precede il cleanup sicuro)
       └──► M2-E (Statistiche — la persistenza avviene a chiusura partita)
            └──► M5-I (Achievement — usa i dati statistiche come trigger)

M1-B (Duplicati Amicizie)  →  Indipendente, nessun blocco
M3-F (Update Username)     →  Indipendente, nessun blocco
```

---

## Criteri di Accettazione per v1.0

La release `v1.0` si considera raggiunta quando **tutte le milestone da M1 a M4** sono completate e i seguenti test sono superati:

| Criterio | Verifica |
|---|---|
| **Sessioni sicure** | Logout invalida la sessione in Redis. Token revocati restituiscono `401`. |
| **Integrità dati amici** | Nessuna richiesta duplicata possibile; il DB non entra in stato inconsistente. |
| **Resilienza match** | Riavvio del container `match-service` non causa perdita di stato di gioco. |
| **Ciclo di vita match completo** | Una partita nasce, si svolge e si conclude con cleanup Redis verificato. |
| **Profilo reale** | Il profilo utente mostra statistiche calcolate da partite realmente giocate. |
| **Username modificabile** | Il cambio username funziona con validazione e feedback errori corretti. |
| **Ban funzionante** | Un utente bannato non può autenticarsi; l'admin può bannare/sbannare. |
| **2FA attivabile** | L'utente può attivare/disattivare il 2FA; il login ne richiede il codice quando attivo. |
| **Nessuna chiave Redis orfana** | Dopo la fine di ogni partita, `SCAN match:{id}:*` restituisce 0 risultati. |

---

## Changelog della Roadmap

| Data | Versione | Nota |
|---|---|---|
| 12 Ottobre 2026 | 0.1 | Prima stesura basata su `FEATURES.md` commit #316. |
