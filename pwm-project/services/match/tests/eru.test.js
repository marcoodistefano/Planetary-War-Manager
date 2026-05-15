const assert = require("node:assert/strict");
const Eru = require("../middleware/Eru"); // Assicurati che il path sia corretto

// ============================================================================
// INGEGNERIA DEL TEST: COSTRUZIONE FRAME A 56 BIT
// Verifichiamo che il risultato del modulo coincida matematicamente
// ============================================================================
const buildExpectedBinary = (match) => {
  // Maschera di larghezza esatta (MSB -> LSB)
  // Stato(2), Squad(1), All_Cons(1), Ranked(1), All_Win(1), Rand_Spawn(1), 
  // Max_Pl(3), Dur(4), Molt(4), Mod(4), Regioni(34)
  // Totale: 56 bit esatti.
  const widths = [2, 1, 1, 1, 1, 1, 3, 4, 4, 4, 34];
  const values = [
    match.stato,
    match.is_squad,
    match.alleanze_consentite,
    match.ranked,
    match.alleanze_win,
    match.random_spawn, // NUOVO PIN INSERITO
    match.max_players,
    match.duration,
    match.moltiplicatore_temporale,
    match.modalita,
    match.regioni,
  ];

  return values
    // Nota: value è ora un BigInt.toString(2). Usiamo padStart per l'allineamento.
    // Nessun padEnd distruttivo in coda.
    .map((value, index) => value.toString(2).padStart(widths[index], "0"))
    .join("");
};

const logSection = (title) => {
  console.log(`\n=== [TEST RUN] ${title} ===`);
};

const assertMatchCreation = (name, body) => {
  logSection(name);
  console.log("Input payload (JSON):");
  console.log(JSON.stringify(body, null, 2));

  const { match, binary_match } = Eru.procedure_create_match({ body });
  const expectedBinary = buildExpectedBinary(match);

  // Essendo BigInt, per stamparli leggibili potremmo fare toString, ma lo JSON.stringify 
  // fallisce sui BigInt nativi senza un replacer. Scriviamo un piccolo replacer per i log:
  const bigIntReplacer = (key, value) => typeof value === 'bigint' ? value.toString() + 'n' : value;
  console.log("Mapped Match (BigInts):");
  console.log(JSON.stringify(match, bigIntReplacer, 2));
  
  console.log(`Binary OUT: ${binary_match}`);
  console.log(`Binary EXP: ${expectedBinary}`);

  assert.equal(typeof binary_match, "string", `${name}: binary_match deve essere una stringa per il DB`);
  assert.equal(binary_match.length, 56, `${name}: Il bus dati deve essere di ESATTAMENTE 56 bit`);
  assert.match(binary_match, /^[01]{56}$/, `${name}: binary_match deve contenere solo puro segnale binario (0/1)`);
  assert.equal(binary_match, expectedBinary, `${name}: Errore di codifica nel multiplexer (mismatch)`);
};

const assertThrowsCase = (name, fn, messagePattern) => {
  logSection(name);
  assert.throws(
    () => {
      fn();
    },
    messagePattern,
  );
  console.log("-> Expected failure observed (Eccezione intercettata con successo)");
};

const assertRegionCase = (name, regions, expected, note) => {
  logSection(name);
  console.log(`Regions Input: ${JSON.stringify(regions)}`);
  const result = Eru.procedure_enstablish_regions(regions);
  console.log(`Result (BigInt): ${result}n`);
  if (note) {
    console.log(`Note: ${note}`);
  }
  // Confronto rigido tra BigInt
  assert.equal(result, expected, `${name}: Unexpected region masking result`);
};

// ============================================================================
// SONDE LOGICHE SUI METODI SWITCH (Tipi di dato aggiornati a BigInt nativo 'n')
// ============================================================================
logSection("Unit Tests: Costanti e Switch Methods");
assert.equal(Eru.switch_stato("In attesa"), 0b00n);
assert.equal(Eru.switch_stato("Terminata"), 0b10n);
assert.equal(Eru.switch_stato("Eliminata"), 0b11n);
assert.equal(Eru.switch_stato("Completata"), 0b10n);
assert.equal(Eru.switch_max_players("100"), 0b100n);
assert.equal(Eru.switch_max_players("50v50"), 0b111n);
assert.equal(Eru.switch_max_duration("Nessun limite"), 0b1111n);
assert.equal(Eru.switch_moltiplicatore_temporale("Produzione Istantanea"), 0b1111n);
assert.equal(Eru.switch_squad(true), 0b1n);
assert.equal(Eru.switch_squad(false), 0b0n);
assert.equal(Eru.switch_ranked(true), 0b1n);
assert.equal(Eru.switch_alleanze_consentite(false), 0b0n);
assert.equal(Eru.switch_alleanze_win(true), 0b1n);
console.log("-> Switch logic OK");

// ============================================================================
// TEST REGOLE REGIONI
// ============================================================================
assertRegionCase(
  "region priority: world dominates",
  ["World", "Europe"],
  Eru.switch_regioni("World"),
  "World is intentionally kept as the only valid region when present."
);

assertRegionCase(
  "region priority: world in the middle",
  ["Europe", "World", "Asia"],
  Eru.switch_regioni("World"),
  "World must override any previously collected regions."
);

assertRegionCase(
  "region priority: world at the end",
  ["Europe", "Asia", "World"],
  Eru.switch_regioni("World"),
  "World must override regions even if it appears last."
);

assertRegionCase(
  "region rejection: unsupported combo",
  ["Europe", "Oceania"],
  Eru.switch_regioni("Europe"),
  "Europe + Oceania is not a supported combination, so the first valid region remains."
);

// ============================================================================
// TEST ERROR HANDLING (Gestione Eccezioni)
// ============================================================================
assertThrowsCase(
  "invalid region name",
  () => Eru.switch_regioni("Atlantis"),
  /Regione non valida/
);

assertThrowsCase(
  "invalid max players",
  () => Eru.switch_max_players("999"),
  /Numero di giocatori non valido/
);

assertThrowsCase(
  "invalid duration",
  () => Eru.switch_max_duration("0 giorni"),
  /Durata massima non valida/
);

assertThrowsCase(
  "invalid multiplier",
  () => Eru.switch_moltiplicatore_temporale("x999"),
  /Moltiplicatore temporale non valido/
);

assertThrowsCase(
  "invalid mode",
  () => Eru.switch_modalita("Conquest"),
  /Modalità di gioco non valida/
);

// ============================================================================
// INTEGRATION TESTS: CREAZIONE PACCHETTO DI RETE
// ============================================================================
assertMatchCreation("frontend-compatible ffa", {
  stato: "In attesa",
  squad: "Tutti contro tutti",
  alleanzeConsentite: false,
  ranked: true,
  alleanzeWin: false,
  randomSpawn: true, // Aggiunto per il nuovo sistema
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
  randomSpawn: false, // Aggiunto per il nuovo sistema
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
        randomSpawn: false,
        maxPlayers: "999", // Triggera l'errore
        duration: "Nessun limite",
        moltiplicatoreTemporale: "x1",
        modalita: "Domination",
        regioni: ["Europe"],
      },
    }),
  /Numero di giocatori non valido/
);

console.log("\n[SYSTEM_READY] Tutti i test Eru superati con successo.");