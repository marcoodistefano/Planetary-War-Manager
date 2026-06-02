#!/bin/bash

# Estrae l'URL dal file .env, toglie il protocollo per ottenere il dominio e avvia ngrok
if [ -f .env ]; then
  NGROK_URL=$(grep "^FRONTEND_URL=" .env | cut -d '=' -f2)
  NGROK_DOMAIN=$(echo $NGROK_URL | sed -e 's|^[^/]*//||' -e 's|/.*$||')

  if [ -n "$NGROK_DOMAIN" ] && [[ "$NGROK_DOMAIN" == *"ngrok"* ]]; then
    echo "Avviando Ngrok sul dominio: $NGROK_DOMAIN"
    echo "Porta locale: 8100"
    echo "Premi Ctrl+C per fermare il tunnel."
    echo "--------------------------------------------------------"
    
    # Esegue ngrok in primo piano nel terminale corrente
    ngrok http --domain="$NGROK_DOMAIN" 8100
  else
    echo "Nessun dominio Ngrok valido trovato nella variabile FRONTEND_URL del file .env."
    echo "Valore attuale trovato: $NGROK_URL"
  fi
else
  echo "Errore: file .env non trovato. Assicurati di lanciare lo script dalla radice del progetto."
fi
