const express = require('express');
const fs = require('fs-extra');
const path = require('path');

const app = express();
app.use(express.json());

const BACKUP_DIR = path.join(__dirname, 'backup_assets');
const TARGET_DIR = path.join(__dirname, 'assets');

app.post('/restore', async (req, res) => {
    try {
        console.log('Iniziando il ripristino degli asset...');
        await fs.emptyDir(TARGET_DIR);
        await fs.copy(BACKUP_DIR, TARGET_DIR);
        console.log('Ripristino completato con successo.');
        res.json({ success: true, message: 'Ripristino completato con successo.' });
    } catch (error) {
        console.error('Errore durante il ripristino:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servizio di ripristino in ascolto sulla porta ${PORT}`);
});