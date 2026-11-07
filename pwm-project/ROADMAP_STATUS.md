# PWM — Stato di Avanzamento Roadmap v1.0

> Documento di tracciamento dello stato di implementazione delle voci definite in `ROADMAP.md`.  
> Ultima verifica del codice effettuata: **7 Novembre 2026**

---

## Legenda
- [x] **Completato**: Implementazione presente, funzionante ed integrata.
- [ ] **Da Implementare**: Nessuna logica o logica fittizia/incompleta (placeholder, TODO, non collegata).

---

## Panoramica delle Voci

| Codice | Voce | Milestone | Priorità | Stato | Note di Verifica nel Codice |
|---|---|---|---|:---:|---|
| **M1-A** | Invalidazione sessione Redis al Logout | M1 | Bloccante | [x] | Estratto `sessionId` e `userId` da cookie/token in `authController.js` (`logout`); cancellata la chiave `session:{sessionId}`, rimosso dal set `user_sessions:{userId}` e ripulito il record su DB (`accessi`). |
| **M1-B** | Protezione duplicati richieste di amicizia | M1 | Bloccante | [x] | Aggiunto `checkFriendshipOrPending` in `playerModel.js`: verifica se già amici in `amici` o se c'è una richiesta pendente in `richieste_amici`, restituendo `409 Conflict` semantico con gestione del codice di violazione di unicità (23505). |
| **M1-C** | Allineamento modello truppe Redis ↔ DB (`sync_workers`) | M1 | Bloccante | [x] | Aggiornato `performDump` in `sync_workers.js` per scansionare lo stato monolitico delle partite attive e fare `UPSERT` su `truppe` con coordinate, armata e stato. Integrato `restoreActiveMatchesState` all'avvio del `match-service` per ripristinare partite da snapshot DB se assenti in Redis. |
| **M2-D** | Fine partita formale + cleanup chiavi Redis | M2 | Core Gameplay | [x] | Implementata `closeMatch` e `cleanupMatchRedisKeys` (SCAN iterativo sicuro) in `matchModel.js`. Aggiorna stato DB a terminata/abbandonata, applica variazioni ELO tra vincitore e ranked rimasti, invia evento WS broadcast `MATCH_ENDED` con classifica e gestisce l'evento sul frontend navigando a `/home`. |
| **M2-E** | Statistiche di combattimento reali nel profilo | M2 | Core Gameplay | [x] | Creata tabella `statistiche_match` in `database.sql` (con indici e vincoli). Aggiunto conteggio in-game in Redis (`match:{hash}:stats:{user}`) in `combatLogic.js`. Persistenza a fine partita in `closeMatch` e calcolo aggregato reale (`kills`, `deaths`, `territories`, `win_rate`) in `playerModel.js` (`getProfileData`). |
| **M3-F** | Aggiornamento username (`POST /player/profile/username`) | M3 | UX / Profilo | [x] | Implementati validazione `3-32` caratteri alfanumerici/underscore, unicità case-insensitive, update DB, invalidazione `home_info:{userId}`, risposta `409 username_taken` e gestione inline nel modal Angular con aggiornamento di `UserStateService`. |
| **M4-G** | Enforcement ban utente (middleware + gateway) | M4 | Moderazione | [x] | Aggiunto controllo cache/DB in `authContext.js` e login con `403 account_banned`; il pannello admin espone ban/unban protetti, aggiorna `utenti`, registra la scadenza in `ban` e invalida tutte le sessioni Redis. L'interceptor Angular redirige al login con messaggio esplicativo. |
| **M4-H** | Autenticazione a due fattori (2FA TOTP) | M4 | Sicurezza Avanzata | [ ] | Saltato su richiesta; colonne `two_fa_*` presenti in `utenti`, ma nessun endpoint né logica TOTP/QR code. |
| **M5-I** | Sistema obiettivi / achievement | M5 | Progressione (Post-v1.0) | [x] | Creato `achievementEngine.js` con catalogo e trigger a fine partita; aggiunti endpoint lista/claim, premio ELO e UI Angular con progresso reale e riscatto. |

---

## Dettaglio per Milestone

### Milestone M1 — Sicurezza e Integrità (Bloccante per il rilascio)
- [x] **M1-A · Invalidazione Sessione Redis al Logout**
  - [x] Estrazione `sessionId` e `userId` dal JWT / cookie in `POST /auth/logout`
  - [x] Rimozione chiave `session:{sessionId}` in Redis
  - [x] Rimozione `sessionId` dal set `user_sessions:{userId}`
  - [x] Pulizia eventuale sessione DB (`accessi`)
  - [x] Verifica `authContext.js` (rifiuto `401` quando la sessione non è presente su Redis)
- [x] **M1-B · Protezione Duplicati Richieste di Amicizia**
  - [x] Controllo amicizia esistente prima dell'invio richiesta (ordinamento canonico `id_user < id_amico`)
  - [x] Controllo richiesta pendente (in entrambe le direzioni tra mittente e destinatario)
  - [x] Ritorno errore coerente (`409 Conflict` con codice semantico `friendship_exists` o `request_pending`)
  - [x] Gestione violazione vincolo unicità Postgres `23505` come fallback di sicurezza
  - [x] Toast feedback già presente e compatibile sul frontend Angular (`friends.component.ts`)
- [x] **M1-C · Allineamento Modello Truppe Redis ↔ DB (`sync_workers.js`)**
  - [x] Dump periodico con snapshot aggregato da stato monolitico Redis → DB (`INSERT ... ON CONFLICT DO UPDATE` su tabella `truppe`)
  - [x] Supporto retrocompatibile per le chiavi legacy `modificati:*` in `sync_workers.js`
  - [x] Implementazione `restoreActiveMatchesState` all'avvio del container `match-service` prima del ripristino mosse
  - [x] Sincronizzazione automatica coordinata con lo `snapshotEngine` (che persiste `stato_partita_json` su `partite`)

---

### Milestone M2 — Core Gameplay Completo
- [x] **M2-D · Fine Partita Formale + Cleanup Chiavi Redis**
  - [x] Implementazione funzione `closeMatch(matchId, reason, explicitWinner)` nel `match-service`
  - [x] Aggiornamento bitmask struttura stato in PostgreSQL (`10` terminata, `11` annullata/abbandonata)
  - [x] Calcolo e persistenza variazioni ELO tra vincitore e partecipanti ranked rimasti
  - [x] Notifica WebSocket broadcast `MATCH_ENDED` con classifica territori e motivo chiusura
  - [x] Ricezione e toast informativo con redirect a `/home` nel client Angular (`match.page.ts`)
  - [x] Routine di rimozione chiavi temporanee Redis con SCAN non-bloccante (`cleanupMatchRedisKeys`)
- [x] **M2-E · Statistiche di Combattimento Reali nel Profilo**
  - [x] Creazione tabella `statistiche_match` in `database.sql` (con `utente_id`, `partita_id`, `kills`, `deaths`, `territories`, `capitals`, `esito`, `elo_delta`)
  - [x] Incremento contatori in-game ad alte prestazioni in Redis (`match:{hash}:stats:{username}`) all'interno di `combatLogic.js`
  - [x] Dump e persistenza delle statistiche aggregate a chiusura partita in `closeMatch` di `matchModel.js`
  - [x] Query reale aggregata in `playerModel.js` (`getProfileData`) con calcolo `win_rate`, `kills`, `deaths`, `territories` e fallback sicuro a zero se l'utente non ha partite giocate

---

### Milestone M3 — Profilo Utente e UX
- [x] **M3-F · Implementazione Aggiornamento Username**
  - [x] Validazione sintassi e unicità nuovo username
  - [x] Aggiornamento record tabella `utenti`
  - [x] Invalidazione cache Redis (`home_info:{userId}`)
  - [x] Integrazione gestione errore 409 e salvataggio nel frontend

---

### Milestone M4 — Moderazione e Sicurezza Avanzata
- [x] **M4-G · Enforcement Ban Utente**
  - [x] Controllo stato ban in `authContext.js` (con cache Redis veloce)
  - [x] Endpoint admin per applicazione/revoca ban
  - [x] Invalidazione immediata sessioni attive al ban
- [ ] **M4-H · Autenticazione a Due Fattori (2FA TOTP)** *(saltato su richiesta)*
  - [ ] Generazione segreto TOTP e QR code (`/player/profile/2fa/setup`)
  - [ ] Conferma attivazione con verifica OTP (`/player/profile/2fa/confirm`)
  - [ ] Intercettazione login con richiesta 2FA quando attivo
  - [ ] Disattivazione 2FA con verifica password

---

### Milestone M5 — Progressione a Lungo Termine (Post-v1.0)
- [x] **M5-I · Sistema Obiettivi / Achievement**
  - [x] Popolamento catalogo obiettivi in DB
  - [x] Sviluppo `achievementEngine.js` collegato alla chiusura partita
  - [x] Endpoint di riscatto ricompense (`claim`) con premio ELO
  - [x] Schermata obiettivi nel client Angular con progresso e riscatto

### Ottimizzazione Asset Statici
- [x] Conversione di tutti i 143 PNG/JPEG locali in WebP
- [x] Aggiornamento riferimenti Angular e MIME type del gateway
- [x] Riduzione peso asset da circa 569 MB a circa 9,9 MB

