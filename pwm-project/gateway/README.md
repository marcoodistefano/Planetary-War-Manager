# Gateway & App-Route

## Scopo del Servizio
La cartella `gateway` raggruppa il punto di ingresso principale dell'intera applicazione. Essa contiene sia la configurazione per il reverse proxy (Nginx) sia un servizio API Router in Node.js (App-Route).
- **Nginx (`gateway`)**: Gestisce le richieste HTTP(S) in ingresso da parte dei client e provvede al bilanciamento e smistamento (reverse proxy) delle rotte verso i corretti microservizi (es. il frontend statico, i socket per la chat o le chiamate API all'app-route). 
- **App-Route (`app-route`)**: Funge da API Gateway interno. Invece di far comunicare il client direttamente con i microservizi (`user-service`, `match-service`), smista centralmente le logiche di routing e autenticazione per le chiamate REST, fungendo da "ponte".

## Struttura delle Cartelle
- **`nginx.conf`**: Configurazione di Nginx, che include la definizione del proxy per le rotte, la riscrittura degli URL e i settaggi per i WebSocket.
- **`app-route.js` / `app-controller.js`**: I file sorgenti del server Node.js che espone gli endpoint raggruppati, gestendo i controller per le chiamate API e la comunicazione con gli altri microservizi tramite Redis.
- **`middleware/`**: Contiene funzioni middleware di Express (ad es. autenticazione/controllo JWT) da applicare alle rotte protette.
- **`Dockerfile.app-route`**: Configurazione per la build dell'immagine Docker del router API.

## Configurazione Docker
Nel file `docker-compose.yml`, ci sono due servizi distinti originati da questa cartella:

1. **Il container Nginx (`gateway`)**:
```yaml
  gateway:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./gateway/nginx.conf:/etc/nginx/nginx.conf:ro
      - ../frontend/www:/usr/share/nginx/html
```
Esso si mette in ascolto sulla porta pubblica (80) ed espone l'interfaccia statica ed indirizza i percorsi `/api/` agli altri servizi.

2. **Il container Router (`app-route`)**:
```yaml
  app-route:
    build:
      context: .
      dockerfile: ./gateway/Dockerfile.app-route
    ports:
      - "4000:3001"
    environment:
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${SECRET_KEY}
```
L'app-route comunica internamente con i vari servizi tramite la rete Docker (`pwm-net`) o tramite Pub/Sub su Redis. 

## Note
- Nginx funge da scudo esposto pubblicamente e aiuta molto nella corretta gestione del protocollo WebSocket essenziale per la chat e lo stato online.
- App-Route è il componente ideale se occorre orchestrare logiche di livello superiore prima di toccare i veri e propri microservizi (ad esempio per rate-limiting e validazione token unificati).
