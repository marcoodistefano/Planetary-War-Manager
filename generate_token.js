// generate_token.js
const jwt = require('jsonwebtoken');

// 1. Usa la stessa chiave segreta definita nel server.js
const SECRET_KEY = "MIA_CHIAVE_SEGRETA_2026";

// 2. Definiamo i dati dell'utente (ID 1)
const payload = { 
    id_user: 1 
};

// 3. Generiamo il token (scadenza 1 anno)
const token = jwt.sign(payload, SECRET_KEY, { expiresIn: '365d' });

console.log("Ecco il tuo JWT da incollare in index.html:");
console.log("---------------------------------------------------");
console.log(token);
console.log("---------------------------------------------------");