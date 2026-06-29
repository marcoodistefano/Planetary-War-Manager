# Servizio Ripristina

## Scopo del Servizio
Il servizio **Ripristina** è un'utilità di supporto all'infrastruttura del progetto. Il suo scopo principale è quello di ripristinare, scaricare o sistemare le dipendenze statiche o gli **assets** all'avvio del sistema (ad esempio da una fonte remota o ripristinandole da un archivio di backup). Assicura che i file statici, di grafica o metadati strutturali indispensabili siano correttamente presenti nel sistema di file condiviso.

## Struttura delle Cartelle
- **`server.js`**: Lo script logico che esegue il ripristino. Può collegarsi a CDN, server remoti o estrarre ZIP e posizionare tutto nelle cartelle corrette.
- **`Dockerfile`**: Compilazione dell'immagine che esegue questo script in modalità stand-alone.

## Configurazione Docker
Dal file `docker-compose.yml`:

```yaml
  ripristina:
    build:
      context: .
      dockerfile: ./services/ripristina/Dockerfile
    volumes:
      - ./shared/assets:/app/assets
    networks:
      - pwm-net
```

- **Volumi**: L'accesso vitale è al volume montato `./shared/assets:/app/assets`. Qualsiasi operazione compiuta da questo servizio si rifletterà direttamente nella cartella `shared/assets` locale della macchina host, la quale verrà a sua volta letta dagli altri container (Frontend, Gateway, Cache-warmup).
- Questo servizio può essere invocato singolarmente o agire preventivamente rispetto ad altri container per accertarsi che le risorse fisiche ci siano già prima del caricamento (infatti, ad esempio, l'amministratore dipende da `ripristina`).

## Note
- Un uso tipico è all'installazione pulita del progetto (first deploy). In quel caso mancano le icone, le mappe vettoriali, ecc. Questo container preleva tutto e le inietta nel sistema senza doverle versionare sul repository Git per risparmiare peso.
