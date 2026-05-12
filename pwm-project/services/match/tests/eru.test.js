const assert = require("node:assert/strict");
const Eru = require("../midleware/Eru");

const buildExpectedBinary = (match) => {
  const widths = [2, 1, 1, 1, 1, 3, 4, 4, 4, 29];
  const values = [
    match.stato,
    match.is_squad,
    match.alleanze_consentite,
    match.ranked,
    match.alleanze_win,
    match.max_players,
    match.duration,
    match.moltiplicatore_temporale,
    match.modalita,
    match.regioni,
  ];

  return values
    .map((value, index) => value.toString(2).padStart(widths[index], "0"))
    .join("")
    .padEnd(56, "0");
};

const logSection = (title) => {
  console.log(`\n=== ${title} ===`);
};

const assertMatchCreation = (name, body) => {
  logSection(name);
  console.log("input body:");
  console.log(JSON.stringify(body, null, 2));

  const { match, binary_match } = Eru.procedure_create_match({ body });
  const expectedBinary = buildExpectedBinary(match);

  console.log("mapped match:");
  console.log(JSON.stringify(match, null, 2));
  console.log(`binary_match: ${binary_match}`);
  console.log(`expected   : ${expectedBinary}`);

  assert.equal(typeof binary_match, "string", `${name}: binary_match must be a string`);
  assert.equal(binary_match.length, 56, `${name}: binary_match must be 56 bits long`);
  assert.match(binary_match, /^[01]{56}$/, `${name}: binary_match must contain only 0 and 1`);
  assert.equal(binary_match, expectedBinary, `${name}: binary_match encoding mismatch`);
};

const assertThrowsCase = (name, fn, messagePattern) => {
  logSection(name);
  assert.throws(
    () => {
      fn();
    },
    messagePattern,
  );
  console.log("expected failure observed");
};

const assertRegionCase = (name, regions, expected, note) => {
  logSection(name);
  console.log(`regions: ${JSON.stringify(regions)}`);
  const result = Eru.procedure_enstablish_regions(regions);
  console.log(`result: ${result}`);
  if (note) {
    console.log(note);
  }
  assert.equal(result, expected, `${name}: unexpected region result`);
};

assert.equal(Eru.switch_stato("In attesa"), 0b00);
assert.equal(Eru.switch_stato("Terminata"), 0b10);
assert.equal(Eru.switch_stato("Eliminata"), 0b11);
assert.equal(Eru.switch_stato("Completata"), 0b10);
assert.equal(Eru.switch_max_players("100"), 0b100);
assert.equal(Eru.switch_max_players("50v50"), 0b111);
assert.equal(Eru.switch_max_duration("Nessun limite"), 0b1111);
assert.equal(Eru.switch_moltiplicatore_temporale("Produzione Istantanea"), 0b1111);
assert.equal(Eru.switch_squad(true), 0b1);
assert.equal(Eru.switch_squad(false), 0b0);
assert.equal(Eru.switch_ranked(true), 0b1);
assert.equal(Eru.switch_alleanze_consentite(false), 0b0);
assert.equal(Eru.switch_alleanze_win(true), 0b1);

assertRegionCase(
  "region priority: world dominates",
  ["World", "Europe"],
  Eru.switch_regioni("World"),
  "World is intentionally kept as the only valid region when present.",
);

assertRegionCase(
  "region priority: world in the middle",
  ["Europe", "World", "Asia"],
  Eru.switch_regioni("World"),
  "World must override any previously collected regions.",
);

assertRegionCase(
  "region priority: world at the end",
  ["Europe", "Asia", "World"],
  Eru.switch_regioni("World"),
  "World must override regions even if it appears last.",
);

assertRegionCase(
  "region rejection: unsupported combo",
  ["Europe", "Oceania"],
  Eru.switch_regioni("Europe"),
  "Europe + Oceania is not a supported combination, so the first valid region remains.",
);

assertThrowsCase(
  "invalid region name",
  () => Eru.switch_regioni("Atlantis"),
  /Regione non valida/,
);

assertThrowsCase(
  "invalid max players",
  () => Eru.switch_max_players("999"),
  /Numero di giocatori non valido/,
);

assertThrowsCase(
  "invalid duration",
  () => Eru.switch_max_duration("0 giorni"),
  /Durata massima non valida/,
);

assertThrowsCase(
  "invalid multiplier",
  () => Eru.switch_moltiplicatore_temporale("x999"),
  /Moltiplicatore temporale non valido/,
);

assertThrowsCase(
  "invalid mode",
  () => Eru.switch_modalita("Conquest"),
  /Modalità di gioco non valida/,
);

assertMatchCreation("frontend-compatible ffa", {
  stato: "In attesa",
  squad: "Tutti contro tutti",
  alleanzeConsentite: false,
  ranked: true,
  alleanzeWin: false,
  maxPlayers: "100",
  duration: "Nessun limite",
  moltiplicatoreTemporale: "Produzione Istantanea",
  modalita: "Domination",
  regioni: ["Europe", "Asia", "Africa"],
});

assertMatchCreation("squad configuration", {
  stato: "In corso",
  squad: true,
  alleanzeConsentite: true,
  ranked: false,
  alleanzeWin: true,
  maxPlayers: "10v10",
  duration: "7 giorni",
  moltiplicatoreTemporale: "x30",
  modalita: "Capture the Flag",
  regioni: ["World"],
});

assertThrowsCase(
  "invalid create match payload",
  () =>
    Eru.procedure_create_match({
      body: {
        stato: "In attesa",
        squad: false,
        alleanzeConsentite: false,
        ranked: true,
        alleanzeWin: false,
        maxPlayers: "999",
        duration: "Nessun limite",
        moltiplicatoreTemporale: "x1",
        modalita: "Domination",
        regioni: ["Europe"],
      },
    }),
  /Numero di giocatori non valido/,
);

console.log("Eru tests passed");
