# Redis Schema — progetto PWM

Questa documentazione descrive la struttura Redis usata nel progetto, convenzioni di naming, tipi di dato e linee guida operative. È pensata per essere letta da sviluppatori che implementano o mantengono i servizi (match, chat, frontend, ecc.).

## Principi generali
- Redis è usato come cache e datastore volatile: il database relazionale (Postgres) rimane la source of truth per l'authoritative state.
- Usare chiavi leggibili e prevedibili: prefisso `{servizio}:{entità}:{id}`.
- Preferire JSON stringificato per snapshot complessi (tipo `match:{id}:state`) e tipi nativi (set, hash, list) per elementi ad accesso frequente/atomico.
- Applicare TTL solo alle chiavi che devono scadere automaticamente (es. snapshot partita, status online temporanei).
- Coerenza: quando si aggiorna uno snapshot critico (es. stato partita), scrivere lo stesso snapshot nelle tre chiavi richieste (vedi sotto) in modo atomico o best-effort con retry.

## Identificatori partita (obbligatori)
Per ogni partita sono mantenute tre chiavi distinte con scopi diversi — non normalizzare le tre chiavi in una sola, sono pensate per usi differenti:
- `match:{id_partita}` — id interno (PK numerica `id_partita`). Usato principalmente dai servizi backend per lookups diretti e processi batch.
- `match:{id_partita_hash}` — id hash/opaque (es. `id_partita_hash`). Usato per references esterne e per evitare leak di sequenze numeriche.
- `match:{id_partita_visualizzato}` — id visualizzato/pubblico (usato nelle route e UI).

Le tre chiavi devono contenere lo stesso snapshot JSON di base quando si tratta di uno snapshot globale; possono differire per campi volatile o metadati (es. `updated_at`).

### Esempio di snapshot (string JSON)
{
  "id_partita": 1234,
  "id_partita_hash": "a1b2c3...",
  "id_partita_visualizzato": "XYZ987",
  "caratteristiche": { "nome": "...", "stato": "In attesa", "max_players": 8, ... },
  "players": [ ... ],
  "metadata": { "created_at": "...", "updated_at": "..." }
}

> Nota: in codice esiste l'helper `setMatchCacheAllIds` in `services/match/matchModel.js` che scrive lo stesso payload sotto le tre chiavi e applica TTL.

## Pattern di chiavi rilevanti (non esaustivo)
- Match snapshot (blob JSON):
  - `match:{id_partita}`
  - `match:{id_partita_hash}`
  - `match:{id_partita_visualizzato}`
- Players list / snapshot:
  - `match:{id_visualizzato}:players` (JSON array)
  - `running_match:{id_visualizzato}:participants` (set o hash con id_user)
- Alliances:
  - `match:{id_visualizzato}:alliances` (JSON blob con elenco alleanze)
  - `match:{id_visualizzato}:alliance:{id_alleanza}:members` (JSON array o set)
  - `match:{id_visualizzato}:alliance:{id_alleanza}:join_count` (string int)
  - `match:{id_visualizzato}:player:{id_user}:join:{id_alleanza}` (string boolean)
  - `match:{id_visualizzato}:player:{id_user}:last_leave:{id_alleanza}` (timestamp string)
- Chat (namespace `chat:`):
  - `chat:match:{id_visualizzato}:global` (list)
  - `chat:match:{id_visualizzato}:alliance:{id_alleanza}` (list)
  - `chat:match:{id_visualizzato}:direct:{userA}:{userB}` (list)
  - `chat:match:{id_visualizzato}:user:by-username:{username}` (lookup)
- Player online/offline state:
  - `match:{id_visualizzato}:{id_user}` → "Online" / "Offline" (string TTLed)
- Cache warmup / orchestration
  - `cache_warmup:run_id`

## Tipologie di dato consigliate
- Blob complessi (match snapshot, alliances): string JSON (set/get). Usare compressione se grande.
- Liste di messaggi chat: Redis List (`LPUSH`/`LRANGE`) o Streams se serve persistence/consumer groups.
- Membri di alleanza: Redis Set per join/leave atomici (`SADD`/`SREM`) più un counter persistente/aggiornato.
- Counters: `INCR`/`DECR` su chiavi `match:...:join_count`.

## Linee guida operative per gli sviluppatori
1. Quando crei una partita (flow in `createMatch`): scrivi l'oggetto snapshot sotto le tre chiavi usando l'helper `setMatchCacheAllIds`. Imposta TTL opportuno (es. 24h) e aggiorna `running_match:{id}:participants` e `match:{id}:players` separatamente.
2. Per operazioni transazionali che coinvolgono DB (join/leave/alliance): eseguire la transazione su Postgres, commit, poi aggiornare Redis (write-through). Se si fallisce l'update Redis, loggare e retry in background ma non considerare Redis come fonte primaria.
3. Per lo stato volatile (online/offline), usare chiavi separate per singolo utente (`match:{id}:{id_user}`) con breve TTL e update frequente.
4. Per la chat, usare keyspace `chat:...` e mantenere storico limitato (es. ultimi N messaggi) in Redis con fallback su Postgres per lo storico completo.
5. Documentare ogni nuova chiave aggiunta nel file `docs/redis-schema.md` e mantenere il file aggiornato.

## Consistenza e atomicità
- Non esiste supporto transazionale cross-key (eccetto Lua scripts). Se l'ordine di scrittura è importante, usare:
  - script Lua per scrivere più chiavi atomiche, o
  - scrivere in DB prima, poi patchare Redis con retry e monitoraggio.

## TTL e scadenza
- Snapshot partita: TTL di default 24h, ma sovrascrivibile per partite più lunghe.
- Online status: TTL breve (p.es. 60s) per recuperare automaticamente drop di connessione.
- Chat: non impostare TTL se si vuole mantenere breve storico; invece usare policy di trimming (`LTRIM`).

## Esempi pratici (comandi)
Scrivere snapshot su tre chiavi (helper già presente):

```js
// Esempio minimale
await setMatchCacheAllIds({
  id_partita: 1234,
  id_partita_hash: 'a1b2c3',
  id_partita_visualizzato: 'XYZ987',
  stateObj: { /* JSON */ },
  ttlSeconds: 86400
});
```

Aggiungere user a set membri alleanza:

```redis
SADD match:XYZ987:alliance:AL1:members 42
INCR match:XYZ987:alliance:AL1:join_count
```

## Note per l'integrazione
- `matchModel` ora fornisce `setMatchCacheAllIds` — riutilizzarlo dove si scrive snapshot partita.
- Non rimuovere le chiavi esistenti finché tutti i consumer sono aggiornati; introdurre deprecazioni progressive.

---
File creato automaticamente. Aggiorna o chiedi integrazioni se vuoi esempi aggiuntivi o una versione in italiano/inglese separata.
