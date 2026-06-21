const { getMatch } = require('./shared/matchMonolithic.js');
async function test() {
  const matchObj = await getMatch("e7d73a5190dfff836763248a80f7de009bd601574a3fef23eda368765385507a");
  const p = matchObj.match.player.find(x => x.username === 'mrk756');
  console.log("Player mrk756:", p ? { id_user: p.id_user, territori: p.territori, hasArmate: !!p.armate } : "Not found");
  process.exit(0);
}
test();
