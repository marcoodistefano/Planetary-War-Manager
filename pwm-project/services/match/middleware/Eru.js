// ============================================================================
// COSTANTI DI SISTEMA (ALLOCATE A 64-BIT BIGINT)
// La lettera 'n' finale è obbligatoria per evitare il downcast a 32-bit.
// ============================================================================

const STATO = {
  // 2 bit
  IN_ATTESA: 0b00n,
  IN_CORSO: 0b01n,
  TERMINATA: 0b10n,
  ELIMINATA: 0b11n,
};

const SQUAD = {
  // 1 bit
  FREE_FOR_ALL: 0b0n,
  SQUAD: 0b1n,
};

const ALLEANZE_CONSENTITE = {
  // 1 bit
  NO_ALLIANCES: 0b0n,
  ALLIANCES_ALLOWED: 0b1n,
};

const RANKED = {
  // 1 bit
  UNRANKED: 0b0n,
  RANKED: 0b1n,
};

const ALLEANZE_WIN = {
  // 1 bit
  NO_ALLIANCES_WIN: 0b0n,
  ALLIANCES_CAN_WIN: 0b1n,
};

const RANDOM_SPAWN = {
  // 1 bit
  NO_RANDOM_SPAWN: 0b0n,
  RANDOM_SPAWN: 0b1n,
};

const MAX_PLAYERS = {
  // 3 bit
  ten: 0b000n,
  twenty: 0b001n,
  thirty: 0b010n,
  fifty: 0b011n,
  hundred: 0b100n,
  undred: 0b100n,
  twohundred_fifty: 0b101n,
  fivehundred: 0b110n,
  v1: 0b000n,
  v2: 0b001n,
  v3: 0b010n,
  v4: 0b011n,
  v5: 0b100n,
  v10: 0b101n,
  v25: 0b110n,
  v50: 0b111n,
};

const DURATION_MAX = {
  // 4 bit
  CONTROLLO: 0b0000n,
  RUSH: 0b0001n,
  CRAZY: 0b0010n,
  INSANE: 0b0011n,
  FAST: 0b0100n,
  SHORT: 0b0101n,
  MEDIUM: 0b0110n,
  DEFAULT: 0b0111n,
  MEDIUM_LONG: 0b1000n,
  LONG: 0b1001n,
  CHILL: 0b1010n,
  VERY_LONG: 0b1011n,
  HARD: 0b1100n,
  MAX: 0b1110n,
  UNLIMITED: 0b1111n,
};

const MOLTIPLICATORE_TEMPORALE = {
  // 4 bit
  x1: 0b0000n,
  x2: 0b0001n,
  x3: 0b0010n,
  x4: 0b0011n,
  x5: 0b0100n,
  x10: 0b0101n,
  x20: 0b0110n,
  x30: 0b0111n,
  x40: 0b1000n,
  x50: 0b1001n,
  x60: 0b1010n,
  x100: 0b1011n,
  x200: 0b1100n,
  x500: 0b1101n,
  x1000: 0b1110n,
  UNLIMITED: 0b1111n,
};

const MODALITA = {
  // 4 bit
  FREE_FOR_ALL: 0b0000n,
  CAPTURE_THE_FLAG: 0b0001n,
  KING_OF_THE_HILL: 0b0010n,
  DOMINATION: 0b0011n,
  DESTRUCTION: 0b0100n,
  OTHER: 0b0111n,
  OTHER1: 0b1000n,
  OTHER2: 0b1001n,
  OTHER3: 0b1010n,
  OTHER4: 0b1011n,
  OTHER5: 0b1100n,
  OTHER6: 0b1101n,
  OTHER7: 0b1110n,
  OTHER8: 0b0101n,
  CONTROLLO: 0b1111n,
};

const normalizeStringValue = (value) => typeof value === "string" ? value.trim() : value;
const isEnabledValue = (value) => value === true || value === 1 || value === "1" || value === "true";
const isDisabledValue = (value) => value === false || value === 0 || value === "0" || value === "false";

const maxPlayersLookup = new Map([
  ["10", MAX_PLAYERS.ten], ["ten", MAX_PLAYERS.ten], ["20", MAX_PLAYERS.twenty], ["twenty", MAX_PLAYERS.twenty],
  ["30", MAX_PLAYERS.thirty], ["thirty", MAX_PLAYERS.thirty], ["50", MAX_PLAYERS.fifty], ["fifty", MAX_PLAYERS.fifty],
  ["100", MAX_PLAYERS.hundred], ["hundred", MAX_PLAYERS.hundred], ["undred", MAX_PLAYERS.undred],
  ["250", MAX_PLAYERS.twohundred_fifty], ["twohundred_fifty", MAX_PLAYERS.twohundred_fifty],
  ["500", MAX_PLAYERS.fivehundred], ["fivehundred", MAX_PLAYERS.fivehundred],
  ["1v1", MAX_PLAYERS.v1], ["2v2", MAX_PLAYERS.v2], ["3v3", MAX_PLAYERS.v3], ["4v4", MAX_PLAYERS.v4],
  ["5v5", MAX_PLAYERS.v5], ["10v10", MAX_PLAYERS.v10], ["25v25", MAX_PLAYERS.v25], ["50v50", MAX_PLAYERS.v50],
]);

// =======================================================================
// INGEGNERIA DEL BUS DATI (REGIONI A 34 BIT)
// Il padding di 3 bit è integrato matematicamente. I bit 0, 1 e 2 sono vuoti.
// Questo forza l'intero blocco REGIONI a occupare esattamente 34 bit nel payload.
// =======================================================================
const REGIONI = {
  CONTROLLO:     0n,
  WORLD:         1n << 33n,
  EUROPE:        1n << 32n,
  ASIA:          1n << 31n,
  AFRICA:        1n << 30n,
  OCEANIA:       1n << 29n,
  AMERICA_NORTH: 1n << 28n,
  AMERICA_SOUTH: 1n << 27n,
  ANTARTICA:     1n << 26n,
  MIDDLE_EAST:   1n << 25n,
  ITALY:         1n << 24n,
  OLD_WORLD:     1n << 23n,
  PANGEA:        1n << 22n,
  SIBERIA:       1n << 21n,
  RUSSIA:        1n << 20n,
  CUSTOM:        1n << 19n,
  OTHER:         1n << 18n,
  OTHER1:        1n << 17n,
  OTHER2:        1n << 16n,
  OTHER3:        1n << 15n,
  OTHER4:        1n << 14n,
  OTHER5:        1n << 13n,
  OTHER6:        1n << 12n,
  OTHER7:        1n << 11n,
  OTHER8:        1n << 10n,
  OTHER9:        1n << 9n,
  OTHER10:       1n << 8n,
  OTHER11:       1n << 7n,
  OTHER12:       1n << 6n,
  OTHER13:       1n << 5n,
  OTHER14:       1n << 4n,
  OTHER15:       1n << 3n,
};

const validCombos = new Set([
  REGIONI.EUROPE, REGIONI.ASIA, REGIONI.AFRICA, REGIONI.OCEANIA,
  REGIONI.AMERICA_NORTH, REGIONI.AMERICA_SOUTH, REGIONI.ANTARTICA,
  REGIONI.EUROPE | REGIONI.ASIA,
  REGIONI.EUROPE | REGIONI.AFRICA,
  REGIONI.ASIA | REGIONI.AFRICA,
  REGIONI.EUROPE | REGIONI.ASIA | REGIONI.AFRICA,
  REGIONI.ASIA | REGIONI.OCEANIA,
  REGIONI.AFRICA | REGIONI.ANTARTICA,
  REGIONI.OCEANIA | REGIONI.ANTARTICA,
  REGIONI.AFRICA | REGIONI.OCEANIA | REGIONI.ANTARTICA,
  REGIONI.AMERICA_NORTH | REGIONI.AMERICA_SOUTH,
  REGIONI.AMERICA_NORTH | REGIONI.AMERICA_SOUTH | REGIONI.ASIA,
  REGIONI.AMERICA_NORTH | REGIONI.AMERICA_SOUTH | REGIONI.EUROPE,
  REGIONI.AMERICA_NORTH | REGIONI.AMERICA_SOUTH | REGIONI.AFRICA,
  REGIONI.AMERICA_NORTH | REGIONI.AMERICA_SOUTH | REGIONI.EUROPE | REGIONI.AFRICA,
  REGIONI.AMERICA_NORTH | REGIONI.AMERICA_SOUTH | REGIONI.EUROPE | REGIONI.AFRICA | REGIONI.ASIA,
  REGIONI.AMERICA_NORTH | REGIONI.AMERICA_SOUTH | REGIONI.ANTARTICA,
]);

const supportedMask =
  REGIONI.WORLD | REGIONI.EUROPE | REGIONI.ASIA | REGIONI.AFRICA |
  REGIONI.OCEANIA | REGIONI.AMERICA_NORTH | REGIONI.AMERICA_SOUTH | REGIONI.ANTARTICA;

const Eru = {
  switch_stato: (stato) => {
    switch (normalizeStringValue(stato)) {
      case "In attesa": return STATO.IN_ATTESA;
      case "In corso": return STATO.IN_CORSO;
      case "Terminata": case "Completata": return STATO.TERMINATA;
      case "Eliminata": case "Annullata": return STATO.ELIMINATA;
      default: throw new Error("Stato non valido");
    }
  },
  switch_squad: (squad) => {
    if (isEnabledValue(squad)) return SQUAD.SQUAD;
    if (isDisabledValue(squad)) return SQUAD.FREE_FOR_ALL;
    switch (normalizeStringValue(squad)) {
      case "Tutti contro tutti": return SQUAD.FREE_FOR_ALL;
      case "Squad": return SQUAD.SQUAD;
      default: throw new Error("Valore squad non valido");
    }
  },
  switch_alleanze_consentite: (alleanzeConsentite) => {
    if (isEnabledValue(alleanzeConsentite)) return ALLEANZE_CONSENTITE.ALLIANCES_ALLOWED;
    if (isDisabledValue(alleanzeConsentite)) return ALLEANZE_CONSENTITE.NO_ALLIANCES;
    switch (normalizeStringValue(alleanzeConsentite)) {
      case "No alleanze": return ALLEANZE_CONSENTITE.NO_ALLIANCES;
      case "Alleanze consentite": return ALLEANZE_CONSENTITE.ALLIANCES_ALLOWED;
      default: throw new Error("Valore alleanze consentite non valido");
    }
  },
  switch_ranked: (ranked) => {
    if (isEnabledValue(ranked)) return RANKED.RANKED;
    if (isDisabledValue(ranked)) return RANKED.UNRANKED;
    switch (normalizeStringValue(ranked)) {
      case "Unranked": return RANKED.UNRANKED;
      case "Ranked": return RANKED.RANKED;
      default: throw new Error("Valore ranked non valido");
    }
  },
  switch_alleanze_win: (alleanzeWin) => {
    if (isEnabledValue(alleanzeWin)) return ALLEANZE_WIN.ALLIANCES_CAN_WIN;
    if (isDisabledValue(alleanzeWin)) return ALLEANZE_WIN.NO_ALLIANCES_WIN;
    switch (normalizeStringValue(alleanzeWin)) {
      case "Le alleanze non portano alla vittoria": return ALLEANZE_WIN.NO_ALLIANCES_WIN;
      case "Le alleanze possono portare alla vittoria": return ALLEANZE_WIN.ALLIANCES_CAN_WIN;
      default: throw new Error("Valore alleanze win non valido");
    }
  },
  
  switch_random_spawn: (randomSpawn) => {
    if (isEnabledValue(randomSpawn)) return RANDOM_SPAWN.RANDOM_SPAWN;
    if (isDisabledValue(randomSpawn)) return RANDOM_SPAWN.NO_RANDOM_SPAWN;
    if (randomSpawn === undefined || randomSpawn === null) return RANDOM_SPAWN.RANDOM_SPAWN;
    switch (normalizeStringValue(randomSpawn)) {
      case "RANDOM_SPAWN": case "random_spawn": case "random spawn": return RANDOM_SPAWN.RANDOM_SPAWN;
      default: return RANDOM_SPAWN.NO_RANDOM_SPAWN;
    }
  },

  switch_max_players: (maxPlayers) => {
    const maxPlayersValue = maxPlayersLookup.get(normalizeStringValue(maxPlayers));
    if (maxPlayersValue !== undefined) return maxPlayersValue;
    throw new Error("Numero di giocatori non valido");
  },
  switch_max_duration: (maxDuration) => {
    switch (normalizeStringValue(maxDuration)) {
      case "1 ora": return DURATION_MAX.RUSH;
      case "6 ore": return DURATION_MAX.CRAZY;
      case "12 ore": return DURATION_MAX.INSANE;
      case "1 giorno": return DURATION_MAX.FAST;
      case "3 giorni": return DURATION_MAX.SHORT;
      case "5 giorni": return DURATION_MAX.MEDIUM;
      case "7 giorni": return DURATION_MAX.DEFAULT;
      case "10 giorni": return DURATION_MAX.MEDIUM_LONG;
      case "14 giorni": return DURATION_MAX.LONG;
      case "32 giorni": return DURATION_MAX.CHILL;
      case "60 giorni": return DURATION_MAX.VERY_LONG;
      case "90 giorni": return DURATION_MAX.HARD;
      case "120 giorni": return DURATION_MAX.MAX;
      case "Nessun limite": case "nessun limite di tempo": return DURATION_MAX.UNLIMITED;
      default: throw new Error("Durata massima non valida");
    }
  },

  switch_moltiplicatore_temporale: (moltiplicatoreTemporale) => {
    switch (normalizeStringValue(moltiplicatoreTemporale)) {
      case "x1": return MOLTIPLICATORE_TEMPORALE.x1;
      case "x2": return MOLTIPLICATORE_TEMPORALE.x2;
      case "x3": return MOLTIPLICATORE_TEMPORALE.x3;
      case "x4": return MOLTIPLICATORE_TEMPORALE.x4;
      case "x5": return MOLTIPLICATORE_TEMPORALE.x5;
      case "x10": return MOLTIPLICATORE_TEMPORALE.x10;
      case "x20": return MOLTIPLICATORE_TEMPORALE.x20;
      case "x30": return MOLTIPLICATORE_TEMPORALE.x30;
      case "x40": return MOLTIPLICATORE_TEMPORALE.x40;
      case "x50": return MOLTIPLICATORE_TEMPORALE.x50;
      case "x60": return MOLTIPLICATORE_TEMPORALE.x60;
      case "x100": return MOLTIPLICATORE_TEMPORALE.x100;
      case "x200": return MOLTIPLICATORE_TEMPORALE.x200;
      case "x500": return MOLTIPLICATORE_TEMPORALE.x500;
      case "x1000": return MOLTIPLICATORE_TEMPORALE.x1000;
      case "Produzione Istantanea": case "produzione istantanea": return MOLTIPLICATORE_TEMPORALE.UNLIMITED;
      default: throw new Error("Moltiplicatore temporale non valido");
    }
  },

  switch_modalita: (modalita) => {
    switch (normalizeStringValue(modalita)) {
      case "Tutti contro tutti": return MODALITA.FREE_FOR_ALL;
      case "Capture the Flag": return MODALITA.CAPTURE_THE_FLAG;
      case "King of the Hill": return MODALITA.KING_OF_THE_HILL;
      case "Domination": return MODALITA.DOMINATION;
      case "Destruction": return MODALITA.DESTRUCTION;
      case "Other": return MODALITA.OTHER;
      case "Other1": return MODALITA.OTHER1;
      case "Other2": return MODALITA.OTHER2;
      case "Other3": return MODALITA.OTHER3;
      case "Other4": return MODALITA.OTHER4;
      case "Other5": return MODALITA.OTHER5;
      case "Other6": return MODALITA.OTHER6;
      case "Other7": return MODALITA.OTHER7;
      case "Other8": return MODALITA.OTHER8;
      case "CONTROLLO": return MODALITA.CONTROLLO;
      default: throw new Error("Modalità di gioco non valida");
    }
  },

  switch_regioni: (regione) => {
    switch (regione) {
      case "World": return REGIONI.WORLD;
      case "Europe": return REGIONI.EUROPE;
      case "Asia": return REGIONI.ASIA;
      case "Africa": return REGIONI.AFRICA;
      case "Oceania": return REGIONI.OCEANIA;
      case "America North": return REGIONI.AMERICA_NORTH;
      case "America South": return REGIONI.AMERICA_SOUTH;
      case "Antartica": return REGIONI.ANTARTICA;
      case "Middle East": return REGIONI.MIDDLE_EAST;
      case "Italy": return REGIONI.ITALY;
      case "Old World": return REGIONI.OLD_WORLD;
      case "Pangea": return REGIONI.PANGEA;
      case "Russia": return REGIONI.RUSSIA;
      case "Custom": return REGIONI.CUSTOM;
      case "Other": return REGIONI.OTHER;
      case "Other1": return REGIONI.OTHER1;
      case "Other2": return REGIONI.OTHER2;
      case "Other3": return REGIONI.OTHER3;
      case "Other4": return REGIONI.OTHER4;
      case "Other5": return REGIONI.OTHER5;
      case "Other6": return REGIONI.OTHER6;
      case "Other7": return REGIONI.OTHER7;
      case "Other8": return REGIONI.OTHER8;
      case "Other9": return REGIONI.OTHER9;
      case "Other10": return REGIONI.OTHER10;
      case "Other11": return REGIONI.OTHER11;
      case "Other12": return REGIONI.OTHER12;
      case "Other13": return REGIONI.OTHER13;
      case "Other14": return REGIONI.OTHER14;
      case "Other15": return REGIONI.OTHER15;
      default: throw new Error("Regione non valida");
    }
  },

  regions_rules(next_generation_buffer) {
    // Controllo maschera binaria pura con suffissi 'n'
    if ((next_generation_buffer & ~supportedMask) !== 0n) return false;
    if ((next_generation_buffer & REGIONI.WORLD) !== 0n) return next_generation_buffer === REGIONI.WORLD;
    return validCombos.has(next_generation_buffer);
  },

  procedure_enstablish_stato: (stato) => Eru.switch_stato(stato),
  procedure_enstablish_squad: (squad) => Eru.switch_squad(squad),
  procedure_enstablish_alleanze_consentite: (alleanzeConsentite) => Eru.switch_alleanze_consentite(alleanzeConsentite),
  procedure_enstablish_ranked: (ranked) => Eru.switch_ranked(ranked),
  procedure_enstablish_alleanze_win: (alleanzeWin) => Eru.switch_alleanze_win(alleanzeWin),
  procedure_enstablish_random_spawn: (randomSpawn) => Eru.switch_random_spawn(randomSpawn),
  procedure_enstablish_max_players(maxPlayers, isSquad) { void isSquad; return Eru.switch_max_players(maxPlayers); },
  procedure_enstablish_duration(duration) { return Eru.switch_max_duration(duration); },
  procedure_enstablish_moltiplicatore_temporale(moltiplicatoreTemporale) { return Eru.switch_moltiplicatore_temporale(moltiplicatoreTemporale); },
  procedure_enstablish_modalita(modalita) { return Eru.switch_modalita(modalita); },
  procedure_enstablish_regions: (regioni) => {
    if (regioni.includes("World")) return REGIONI.WORLD;

    let memorize_buffer = REGIONI.CONTROLLO;
    for (let i = 0; i < regioni.length; i++) {
      const xor_buffer = Eru.switch_regioni(regioni[i]);
      const next_generation_buffer = memorize_buffer | xor_buffer;
      if (Eru.regions_rules(next_generation_buffer)) {
        memorize_buffer = next_generation_buffer;
      } else {
        console.log(`Combinazione di regioni non valida: ${regioni[i]} non può essere combinata con le regioni precedenti`);
      }
    }
    return memorize_buffer;
  },

  procedure_create_match: (req) => {
    const isSquad = Eru.procedure_enstablish_squad(req.body.squad);
    const match = {
      stato: Eru.procedure_enstablish_stato(req.body.stato),
      is_squad: isSquad,
      alleanze_consentite: Eru.procedure_enstablish_alleanze_consentite(req.body.alleanzeConsentite),
      ranked: Eru.procedure_enstablish_ranked(req.body.ranked),
      alleanze_win: Eru.procedure_enstablish_alleanze_win(req.body.alleanzeWin),
      random_spawn: Eru.procedure_enstablish_random_spawn(req.body.randomSpawn),
      max_players: Eru.procedure_enstablish_max_players(req.body.maxPlayers, isSquad),
      duration: Eru.procedure_enstablish_duration(req.body.duration),
      moltiplicatore_temporale: Eru.procedure_enstablish_moltiplicatore_temporale(req.body.moltiplicatoreTemporale),
      modalita: Eru.procedure_enstablish_modalita(req.body.modalita),
      regioni: Eru.procedure_enstablish_regions(req.body.regioni),
    };
    const binary_match = Eru.create_binary_match(match);
    
    // --- PATCH I/O: Serializzatore Custom per BigInt ---
    const logReplacer = (key, value) => {
        // Se il valore è un BigInt, lo convertiamo in stringa con suffisso 'n' per chiarezza nel log
        return typeof value === 'bigint' ? value.toString() + 'n' : value;
    };
    console.log(`[SYSTEM LOG] Match creato: \n${JSON.stringify(match, logReplacer, 2)}`);
    // --------------------------------------------------

    return { match, binary_match };
  },

  /* 
   * IL BUS DATI A 56 BIT:
   * Nessun padding posticcio. I 56 bit sono determinati dallo scorrimento
   * a sinistra di ogni valore. Le REGIONI impongono la larghezza di 34 bit.
   * La larghezza totale = 2 (stato) + 1 + 1 + 1 + 1 + 1 + 3 + 4 + 4 + 4 + 34 = 56 bit.
   */
  create_binary_match: (match) => {
    let binaryMatch = 0n;
    
    // Funzione protetta per garantire l'inserimento esatto dei bit.
    // L'operatore AND (&) previene un buffer overflow applicativo.
    const appendBits = (value, width) => {
      const safeValue = BigInt(value) & ((1n << BigInt(width)) - 1n);
      binaryMatch = (binaryMatch << BigInt(width)) | safeValue;
    };

    appendBits(match.stato, 2);                    // Bit 54-55 (MSB)
    appendBits(match.is_squad, 1);                 // Bit 53
    appendBits(match.alleanze_consentite, 1);      // Bit 52
    appendBits(match.ranked, 1);                   // Bit 51
    appendBits(match.alleanze_win, 1);             // Bit 50
    appendBits(match.random_spawn, 1);             // Bit 49
    appendBits(match.max_players, 3);              // Bit 46-48
    appendBits(match.duration, 4);                 // Bit 42-45
    appendBits(match.moltiplicatore_temporale, 4); // Bit 38-41
    appendBits(match.modalita, 4);                 // Bit 34-37
    appendBits(match.regioni, 34);                 // Bit 0-33 (LSB. I bit 0, 1 e 2 sono padding implicito a zero)

    // Formattazione per driver DB: restituisce stringa di 56 caratteri esatti.
    // Il padStart serve SOLO come serializzazione ASCII se lo STATO (MSB) è 0b00.
    return binaryMatch.toString(2).padStart(56, "0");
  },

  check_start_match: (matchData, count) => {
    let res;
    // Conversione sicura per operare sui registri. Il DB fornisce stringa.
    const match = typeof matchData === "string" ? BigInt("0b" + matchData) : BigInt(matchData);
    
    // Estrazione allineata al frame di 56 bit.
    let stato = (match >> 54n) & 0b11n; 
    let isSquad = (match >> 53n) & 0b1n; 
    
    // Shift calcolato per saltare: Regioni (34) + Mod (4) + Molt (4) + Dur (4) = 46.
    let maxPlayersBits = Number((match >> 46n) & 0b111n); 
    let maxPlayersCount = 0;

    if (isSquad === 1n) {
      const squadMap = [2, 4, 6, 8, 10, 20, 50, 100];
      maxPlayersCount = squadMap[maxPlayersBits];
    } else {
      const soloMap = [10, 20, 30, 50, 100, 250, 500];
      if (maxPlayersBits === 7) {
        maxPlayersCount = 500;
      } else {
        maxPlayersCount = soloMap[maxPlayersBits];
      }
    }

    if (count >= maxPlayersCount / 3 && stato === 1n) {
      // Spegne i bit 54-55 (Maschera Inversa) e accende il bit 55
      let newMatchBigInt = (match & ~(0b11n << 54n)) | (0b10n << 54n);
      res = {
        status : 200, 
        message: "Partita avviata con successo", 
        struttura_partita: newMatchBigInt.toString(2).padStart(56, "0")
      };
    } else {
      res = {
        status : 400, 
        message: "Condizioni di avvio non soddisfatte", 
        // Ricompone per il layer I/O
        struttura_partita: match.toString(2).padStart(56, "0")
      };
    }
    return res;
  },
};

module.exports = Eru;