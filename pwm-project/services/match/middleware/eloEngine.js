const db = require('../../shared/postgresClient.js');

const K_FACTOR = 32;

const calculateExpectedScore = (ratingA, ratingB) => {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
};

/**
 * Aggiorna l'ELO di due giocatori nel DB, ma solo se la partita è ranked (has_elo = true).
 * @param {string} id_partita_hash
 * @param {string} winnerUsername 
 * @param {string} loserUsername 
 */
const updateElo = async (id_partita_hash, winnerUsername, loserUsername) => {
    if (!id_partita_hash || !winnerUsername || !loserUsername || winnerUsername === loserUsername) return;

    // Ignora i bot (terminano con _bot o non sono in db)
    if (winnerUsername.includes('_bot') || loserUsername.includes('_bot')) return;

    let client;
    try {
        client = await db.connect();
        await client.query('BEGIN');

        // Check if ranked
        const matchRes = await client.query('SELECT has_elo FROM partite WHERE id_partita_hash = $1', [id_partita_hash]);
        if (matchRes.rows.length === 0 || !matchRes.rows[0].has_elo) {
            await client.query('ROLLBACK');
            return;
        }

        const resW = await client.query('SELECT elo_rating FROM utenti WHERE username = $1 FOR UPDATE', [winnerUsername]);
        const resL = await client.query('SELECT elo_rating FROM utenti WHERE username = $1 FOR UPDATE', [loserUsername]);

        if (resW.rows.length === 0 || resL.rows.length === 0) {
            await client.query('ROLLBACK');
            return;
        }

        const ratingW = resW.rows[0].elo_rating || 1000;
        const ratingL = resL.rows[0].elo_rating || 1000;

        const expectedW = calculateExpectedScore(ratingW, ratingL);
        const expectedL = calculateExpectedScore(ratingL, ratingW);

        const newRatingW = Math.round(ratingW + K_FACTOR * (1 - expectedW));
        const newRatingL = Math.max(0, Math.round(ratingL + K_FACTOR * (0 - expectedL)));

        await client.query('UPDATE utenti SET elo_rating = $1 WHERE username = $2', [newRatingW, winnerUsername]);
        await client.query('UPDATE utenti SET elo_rating = $1 WHERE username = $2', [newRatingL, loserUsername]);

        await client.query('COMMIT');
        
        console.log(`[ELO_ENGINE] ELO aggiornato per partita ${id_partita_hash}: ${winnerUsername} (${ratingW} -> ${newRatingW}) ha sconfitto ${loserUsername} (${ratingL} -> ${newRatingL})`);
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('[ELO_ENGINE] Errore aggiornamento ELO:', error);
    } finally {
        if (client) client.release();
    }
};

module.exports = { updateElo };
