const { Pool } = require('pg');
const db = new Pool({ host: 'localhost', user: 'commander_admin', password: 'secret', database: 'pwm_tactical_database', port: 5432 });

async function get() {
    const res = await db.query(`SELECT username FROM utenti`);
    console.log(res.rows);
    process.exit(0);
}
get();
