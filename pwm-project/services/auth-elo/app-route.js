const express = require("express");
const cors = require("cors");
const app = express();
const { json } = require("body-parser");
const PWMSecurity = require("./Manager.js");
const path = require('path');

app.use(cors());
app.use(express.json());

app.post("/auth/test-auth", async (req, res) => {
  console.log("--- Ricevuto dato grezzo ---");
  console.log(req.body);

  try {
    const result = await PWMSecurity.process_register(req.body);

    if (!result.isValid) {
      console.log("--- Validazione Fallita ---");
      return res.status(400).json(result);
    }

    console.log("--- Dato X Sicuro Generato ---");
    console.log(result.data);

    res.json({
      message: "Dato processato secondo standard PWM",
      dato_x_sicuro: result.data,
    });
  } catch (error) {
    console.error("--- ERRORE DURANTE L'ELABORAZIONE ---");
    console.error(error);
    res.status(500).json({ 
      error: "Errore interno del server",
      details: error.message 
    });
  }
});

app.post("/login", async (req, res) => {
  console.log("--- Ricevuto dato da decodificare ---");
  console.log(req.body);
  try {
    const result = await PWMSecurity.process_login(req.body);

    if (!result.isValid) {
      console.log("--- Validazione Fallita ---");
      return res.status(400).json(result);
    }

    console.log("--- Dato X Sicuro Generato ---");
    console.log(result.data);

    res.json({
      message: "Login avvenuto con successo",
      dato_x_sicuro: result.data,
    });
  } catch (error) {
    console.error("--- ERRORE DURANTE L'ELABORAZIONE ---");
    console.error(error);
    res.status(500).json({ 
      error: "Errore interno del server",
      details: error.message 
    });
  }
});

// Serve una semplice pagina di test per il login via GET
app.get('/login', (req, res) => {
  try {
    // prova a servire auth.html presente nella stessa cartella
    res.sendFile(path.join(__dirname, 'auth.html'));
  } catch (err) {
    res.status(500).send('Errore nel servire la pagina di login');
  }
});

app.listen(3001, () =>
  console.log("Servizio PWM Auth attivo su http://localhost:3001"),
);