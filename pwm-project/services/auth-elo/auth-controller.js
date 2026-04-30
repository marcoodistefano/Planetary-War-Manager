const express = require('express');
const router = express.Router();
const PWMSecurity = require('./security');
const app = express();
// Schema di validazione basato sulle regole PWM[cite: 1]
const registrationSchema = {
    username: { required: true },
    email: { required: true },
    password: { required: true, minLength: 12 }, //[cite: 1]
    regione: { required: true }
};

router.post('/register', (req, res) => {
    // Fase 1 & 2: Sanitizzazione e Parsing[cite: 1]
    const validation = PWMSecurity.parseAndValidate(req.body, registrationSchema);

    if (!validation.isValid) {
        return res.status(400).json({
            status: "error",
            message: "Validazione fallita",
            details: validation.errors
        });
    }

    // A questo punto validation.data è il dato "X sicuro"[cite: 1]
    const { username, email, password, regione } = validation.data;

    // Proseguire con Hashing Argon2id e salvataggio DB...
    console.log(`Dato sanitizzato pronto per il DB: ${username}`);
    res.status(201).json({ message: "Dati validati con successo" });
});

app.use('/register', router);

module.exports = router;