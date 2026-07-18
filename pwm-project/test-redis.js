const { getMatch } = require('./services/shared/matchMonolithic.js');
const db = require('./services/shared/postgresClient.js');

async function test() {
  const matches = await db.query("SELECT id_partita_hash FROM partite LIMIT 1");
  if (matches.rows.length === 0) return console.log("No matches found");
  const matchId = matches.rows[0].id_partita_hash;
  console.log("Checking match:", matchId);
  
  const matchData = await getMatch(matchId);
  if (!matchData || !matchData.match || !matchData.match.player) return console.log("No match data");
  
  const player = matchData.match.player[0];
  console.log("Player:", player.username);
  console.log("Risorse:", player.risorse);
  console.log("Produzione:", player.produzione);
  console.log("Truppe:", player.truppe);
  
  process.exit(0);
}

test();
