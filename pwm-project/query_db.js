const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', user: 'commander_admin', password: 'secret', database: 'pwm_tactical_database', port: 5432 });
async function check() {
  let res = await pool.query(`SELECT id_partita_hash, struttura_partita FROM partite LIMIT 1`);
  console.log(res.rows[0]);
  process.exit(0);
}
check();
