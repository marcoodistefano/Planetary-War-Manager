# Servizio Amministratore

## Scopo del Servizio
Il servizio **Amministratore** funge da pannello di controllo centralizzato e back-office (Dashboard) per l'intero sistema.
Offre un'interfaccia privilegiata, presumibilmente web-based, attraverso cui gli amministratori possono monitorare lo stato di salute dei container, eseguire azioni forzate sul sistema, ispezionare log, gestire utenti e interagire con i database e i file del progetto. 

## Struttura delle Cartelle
- **`server.js`**: File principale Node.js contenente la logica backend per le operazioni amministrative (e.g. interazione con il Docker engine locale).
- **`public/`**: Interfaccia frontend per il pannello amministrativo, solitamente formata da HTML, CSS, e JS statico serviti direttamente da `server.js`.
- **`Dockerfile`**: Il file per la build dell'immagine Docker specifica per il pannello di controllo.

## Configurazione Docker
Nel file `docker-compose.yml`, l'amministratore è configurato con privilegi elevati (come l'accesso al socket docker):

```yaml
  amministratore:
    build: ./services/amministratore
    ports:
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock 
      - .:/project:ro
    environment:
      - PROJECT_ROOT=/project
```

- **Porta**: Espone direttamente la porta `8080` saltando il reverse-proxy principale per questioni di sicurezza ed indipendenza dal gateway.
- **Docker Socket (`/var/run/docker.sock`)**: Questo mount è fondamentale. Permette a `server.js` di dialogare con il demone Docker (es. con Dockerode) per fermare, avviare e riavviare altri container o leggere i loro log.
- **Volume del Progetto (`.:/project:ro`)**: Permette al servizio di leggere i file del progetto (sola lettura) per ispezionare eventuali configurazioni direttamente dal pannello.

## Note
- Poiché questo servizio ha accesso in lettura a tutta la codebase e controlla il motore Docker host, esso rappresenta il "centro nevralgico" da proteggere adeguatamente in ambiente di produzione. Non deve mai essere esposto senza una forte autenticazione (sebbene spesso limitato alla rete locale o VPN).
