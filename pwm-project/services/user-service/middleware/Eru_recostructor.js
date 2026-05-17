// ============================================================================
// MODULO ERU: SHIFT REGISTER E MULTIPLEXER A 56-BIT
// ----------------------------------------------------------------------------
// Costanti di sistema allocate a 64-Bit BigInt per prevenire overflow.
// Il suffisso 'n' garantisce l'uso dei registri ALU a 64-bit di V8.
// ============================================================================

const STATO = {
  IN_ATTESA: 0b00n,
  IN_CORSO:  0b01n,
  TERMINATA: 0b10n,
  ELIMINATA: 0b11n,
};

const SQUAD = {
  FREE_FOR_ALL: 0b0n,
  SQUAD:        0b1n,
};

const ALLEANZE_CONSENTITE = {
  NO_ALLIANCES:      0b0n,
  ALLIANCES_ALLOWED: 0b1n,
};

const RANKED = {
  UNRANKED: 0b0n,
  RANKED:   0b1n,
};

const ALLEANZE_WIN = {
  NO_ALLIANCES_WIN:  0b0n,
  ALLIANCES_CAN_WIN: 0b1n,
};

const RANDOM_SPAWN = {
  NO_RANDOM_SPAWN: 0b0n,
  RANDOM_SPAWN:    0b1n,
};

const MAX_PLAYERS = {
  ten:              0b000n,
  twenty:           0b001n,
  thirty:           0b010n,
  fifty:            0b011n,
  hundred:          0b100n,
  twohundred_fifty: 0b101n,
  fivehundred:      0b110n,
  v1:               0b000n,
  v2:               0b001n,
  v3:               0b010n,
  v4:               0b011n,
  v5:               0b100n,
  v10:              0b101n,
  v25:              0b110n,
  v50:              0b111n,
};

const DURATION_MAX = {
  CONTROLLO:   0b0000n,
  RUSH:        0b0001n,
  CRAZY:       0b0010n,
  INSANE:      0b0011n,
  FAST:        0b0100n,
  SHORT:       0b0101n,
  MEDIUM:      0b0110n,
  DEFAULT:     0b0111n,
  MEDIUM_LONG: 0b1000n,
  LONG:        0b1001n,
  CHILL:       0b1010n,
  VERY_LONG:   0b1011n,
  HARD:        0b1100n,
  MAX:         0b1110n,
  UNLIMITED:   0b1111n,
};

const MOLTIPLICATORE_TEMPORALE = {
  x1:        0b0000n,
  x2:        0b0001n,
  x3:        0b0010n,
  x4:        0b0011n,
  x5:        0b0100n,
  x10:       0b0101n,
  x20:       0b0110n,
  x30:       0b0111n,
  x40:       0b1000n,
  x50:       0b1001n,
  x60:       0b1010n,
  x100:      0b1011n,
  x200:      0b1100n,
  x500:      0b1101n,
  x1000:     0b1110n,
  UNLIMITED: 0b1111n,
};

const MODALITA = {
  FREE_FOR_ALL:     0b0000n,
  CAPTURE_THE_FLAG: 0b0001n,
  KING_OF_THE_HILL: 0b0010n,
  DOMINATION:       0b0011n,
  DESTRUCTION:      0b0100n,
  OTHER8:           0b0101n,
  OTHER:            0b0111n,
  OTHER1:           0b1000n,
  OTHER2:           0b1001n,
  OTHER3:           0b1010n,
  OTHER4:           0b1011n,
  OTHER5:           0b1100n,
  OTHER6:           0b1101n,
  OTHER7:           0b1110n,
  CONTROLLO:        0b1111n,
};

// =======================================================================
// INGEGNERIA DEL BUS DATI (REGIONI A 34 BIT)
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

// Mappa inversa per la decodifica istantanea delle regioni (O(1) lookup base)
const REVERSE_REGIONI_MAP = new Map(
  Object.entries(REGIONI)
    .filter(([key, value]) => value !== 0n)
    .map(([key, value]) => [value, key === "AMERICA_NORTH" ? "America North" 
                                  : key === "AMERICA_SOUTH" ? "America South"
                                  : key === "MIDDLE_EAST" ? "Middle East"
                                  : key === "OLD_WORLD" ? "Old World"
                                  : key.charAt(0) + key.slice(1).toLowerCase()])
);

// ============================================================================
// HELPER HARDWARE
// ============================================================================
const normalizeStringValue = (value) => typeof value === "string" ? value.trim() : value;
const isEnabledValue = (value) => value === true || value === 1 || value === "1" || value === "true";
const isDisabledValue = (value) => value === false || value === 0 || value === "0" || value === "false";

const maxPlayersLookup = new Map([
  ["10", MAX_PLAYERS.ten], ["ten", MAX_PLAYERS.ten], ["20", MAX_PLAYERS.twenty], ["twenty", MAX_PLAYERS.twenty],
  ["30", MAX_PLAYERS.thirty], ["thirty", MAX_PLAYERS.thirty], ["50", MAX_PLAYERS.fifty], ["fifty", MAX_PLAYERS.fifty],
  ["100", MAX_PLAYERS.hundred], ["hundred", MAX_PLAYERS.hundred], ["undred", MAX_PLAYERS.hundred], // Corretto typo undred
  ["250", MAX_PLAYERS.twohundred_fifty], ["twohundred_fifty", MAX_PLAYERS.twohundred_fifty],
  ["500", MAX_PLAYERS.fivehundred], ["fivehundred", MAX_PLAYERS.fivehundred],
  ["1v1", MAX_PLAYERS.v1], ["2v2", MAX_PLAYERS.v2], ["3v3", MAX_PLAYERS.v3], ["4v4", MAX_PLAYERS.v4],
  ["5v5", MAX_PLAYERS.v5], ["10v10", MAX_PLAYERS.v10], ["25v25", MAX_PLAYERS.v25], ["50v50", MAX_PLAYERS.v50],
]);


// ============================================================================
// IL CORE ERU (Encoder / Decoder / Multiplexer)
// ============================================================================
const Eru = {
  // --------------------------------------------------------------------------
  // L1 ENCODER: Da Stringa/Payload Utente a Voltaggio Binario (BigInt)
  // --------------------------------------------------------------------------
  encode_stato: (stato) => {
    switch (normalizeStringValue(stato)) {
      case "In attesa": return STATO.IN_ATTESA;
      case "In corso": return STATO.IN_CORSO;
      case "Terminata": case "Completata": return STATO.TERMINATA;
      case "Eliminata": case "Annullata": return STATO.ELIMINATA;
      default: return STATO.IN_ATTESA;
    }
  },
  encode_squad: (squad) => {
    if (isEnabledValue(squad) || normalizeStringValue(squad) === "Squad") return SQUAD.SQUAD;
    return SQUAD.FREE_FOR_ALL;
  },
  encode_alleanze_consentite: (ac) => {
    if (isEnabledValue(ac) || normalizeStringValue(ac) === "Alleanze consentite") return ALLEANZE_CONSENTITE.ALLIANCES_ALLOWED;
    return ALLEANZE_CONSENTITE.NO_ALLIANCES;
  },
  encode_ranked: (ranked) => {
    if (isEnabledValue(ranked) || normalizeStringValue(ranked) === "Ranked") return RANKED.RANKED;
    return RANKED.UNRANKED;
  },
  encode_alleanze_win: (aw) => {
    if (isEnabledValue(aw) || normalizeStringValue(aw) === "Le alleanze possono portare alla vittoria") return ALLEANZE_WIN.ALLIANCES_CAN_WIN;
    return ALLEANZE_WIN.NO_ALLIANCES_WIN;
  },
  encode_random_spawn: (rs) => {
    if (isDisabledValue(rs)) return RANDOM_SPAWN.NO_RANDOM_SPAWN;
    if (rs === undefined || rs === null) return RANDOM_SPAWN.RANDOM_SPAWN;
    switch (normalizeStringValue(rs)) {
      case "RANDOM_SPAWN": case "random_spawn": case "random spawn": return RANDOM_SPAWN.RANDOM_SPAWN;
      default: return RANDOM_SPAWN.NO_RANDOM_SPAWN;
    }
  },
  encode_max_players: (maxPlayers) => {
    const val = maxPlayersLookup.get(normalizeStringValue(maxPlayers));
    if (val !== undefined) return val;
    throw new Error("Numero di giocatori non valido");
  },
  encode_duration: (maxDuration) => {
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
  encode_moltiplicatore_temporale: (molt) => {
    switch (normalizeStringValue(molt)) {
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
  encode_modalita: (modalita) => {
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
  encode_singola_regione: (regione) => {
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
  regions_rules: (next_generation_buffer) => {
    if ((next_generation_buffer & ~supportedMask) !== 0n) return false;
    if ((next_generation_buffer & REGIONI.WORLD) !== 0n) return next_generation_buffer === REGIONI.WORLD;
    return validCombos.has(next_generation_buffer);
  },
  encode_regioni_array: (regioni) => {
    if (regioni.includes("World")) return REGIONI.WORLD;

    let memorize_buffer = REGIONI.CONTROLLO;
    for (let i = 0; i < regioni.length; i++) {
      const xor_buffer = Eru.encode_singola_regione(regioni[i]);
      const next_generation_buffer = memorize_buffer | xor_buffer;
      if (Eru.regions_rules(next_generation_buffer)) {
        memorize_buffer = next_generation_buffer;
      } else {
        console.log(`Combinazione di regioni non valida: ${regioni[i]} non può essere combinata con le regioni precedenti`);
      }
    }
    return memorize_buffer;
  },

  // --------------------------------------------------------------------------
  // L2 DECODER: Da Voltaggio Binario (BigInt) a Stringa Utente (DEMUX)
  // --------------------------------------------------------------------------
  decode_stato: (bits) => {
    switch (bits) {
      case STATO.IN_ATTESA: return "In attesa";
      case STATO.IN_CORSO:  return "In corso";
      case STATO.TERMINATA: return "Terminata";
      case STATO.ELIMINATA: return "Eliminata";
      default: return "Sconosciuto";
    }
  },
  decode_squad: (bits) => bits === SQUAD.SQUAD ? "Squad" : "Tutti contro tutti",
  decode_alleanze_consentite: (bits) => bits === ALLEANZE_CONSENTITE.ALLIANCES_ALLOWED ? "Alleanze consentite" : "No alleanze",
  decode_ranked: (bits) => bits === RANKED.RANKED ? "Ranked" : "Unranked",
  decode_alleanze_win: (bits) => bits === ALLEANZE_WIN.ALLIANCES_CAN_WIN ? "Le alleanze possono portare alla vittoria" : "Le alleanze non portano alla vittoria",
  decode_random_spawn: (bits) => bits === RANDOM_SPAWN.RANDOM_SPAWN ? "Random spawn" : "No random spawn",
  
  decode_max_players: (bits, isSquadBit) => {
    if (isSquadBit === SQUAD.SQUAD) {
      const map = { 0n:"1v1", 1n:"2v2", 2n:"3v3", 3n:"4v4", 4n:"5v5", 5n:"10v10", 6n:"25v25", 7n:"50v50" };
      return map[bits] || "Sconosciuto";
    } else {
      const map = { 0n:"10", 1n:"20", 2n:"30", 3n:"50", 4n:"100", 5n:"250", 6n:"500" };
      return map[bits] || "500";
    }
  },
  decode_duration: (bits) => {
    for (const [key, value] of Object.entries(DURATION_MAX)) {
      if (value === bits) {
        if (key === "UNLIMITED") return "Nessun limite";
        if (key === "RUSH") return "1 ora";
        if (key === "CRAZY") return "6 ore";
        if (key === "INSANE") return "12 ore";
        if (key === "FAST") return "1 giorno";
        if (key === "SHORT") return "3 giorni";
        if (key === "MEDIUM") return "5 giorni";
        if (key === "DEFAULT") return "7 giorni";
        if (key === "MEDIUM_LONG") return "10 giorni";
        if (key === "LONG") return "14 giorni";
        if (key === "CHILL") return "32 giorni";
        if (key === "VERY_LONG") return "60 giorni";
        if (key === "HARD") return "90 giorni";
        if (key === "MAX") return "120 giorni";
        return key; 
      }
    }
    return "Nessun limite";
  },
  decode_moltiplicatore_temporale: (bits) => {
    if (bits === MOLTIPLICATORE_TEMPORALE.UNLIMITED) return "Produzione Istantanea";
    for (const [key, value] of Object.entries(MOLTIPLICATORE_TEMPORALE)) {
      if (value === bits) return key; 
    }
    return "Sconosciuto";
  },
  decode_modalita: (bits) => {
    for (const [key, value] of Object.entries(MODALITA)) {
      if (value === bits) {
        return key.replace(/_/g, " ").replace(/\w\S*/g, w => (w.replace(/^\w/, c => c.toUpperCase())));
      }
    }
    return "Sconosciuto";
  },
  decode_regioni: (bits) => {
    if (bits === REGIONI.WORLD) return ["World"];
    let regioni_attive = [];
    for (const [mask, name] of REVERSE_REGIONI_MAP.entries()) {
      if ((bits & mask) === mask) {
        regioni_attive.push(name);
      }
    }
    return regioni_attive;
  },

  // --------------------------------------------------------------------------
  // CORE 1: MULTIPLEXER (JSON -> 56 BIT BINARY)
  // --------------------------------------------------------------------------
  procedure_create_field: (req) => {
    const isSquad = Eru.encode_squad(req.body.squad);
    const match = {
      stato: Eru.encode_stato(req.body.stato),
      is_squad: isSquad,
      alleanze_consentite: Eru.encode_alleanze_consentite(req.body.alleanzeConsentite),
      ranked: Eru.encode_ranked(req.body.ranked),
      alleanze_win: Eru.encode_alleanze_win(req.body.alleanzeWin),
      random_spawn: Eru.encode_random_spawn(req.body.randomSpawn),
      max_players: Eru.encode_max_players(req.body.maxPlayers), 
      duration: Eru.encode_duration(req.body.duration),
      moltiplicatore_temporale: Eru.encode_moltiplicatore_temporale(req.body.moltiplicatoreTemporale),
      modalita: Eru.encode_modalita(req.body.modalita),
      regioni: Eru.encode_regioni_array(req.body.regioni),
    };
    
    const binary_match = Eru.create_binary_match(match);
    
    // Serializzatore Custom per BigInt nei log
    const logReplacer = (key, value) => {
        return typeof value === 'bigint' ? value.toString() + 'n' : value;
    };
    console.log(`[SYSTEM LOG] Match creato: \n${JSON.stringify(match, logReplacer, 2)}`);

    return { match, binary_match };
  },

  create_binary_match: (match) => {
    let binaryMatch = 0n;
    const appendBits = (value, width) => {
      const safeValue = BigInt(value) & ((1n << BigInt(width)) - 1n);
      binaryMatch = (binaryMatch << BigInt(width)) | safeValue;
    };

    appendBits(match.stato, 2);                    // Bit 54-55
    appendBits(match.is_squad, 1);                 // Bit 53
    appendBits(match.alleanze_consentite, 1);      // Bit 52
    appendBits(match.ranked, 1);                   // Bit 51
    appendBits(match.alleanze_win, 1);             // Bit 50
    appendBits(match.random_spawn, 1);             // Bit 49
    appendBits(match.max_players, 3);              // Bit 46-48
    appendBits(match.duration, 4);                 // Bit 42-45
    appendBits(match.moltiplicatore_temporale, 4); // Bit 38-41
    appendBits(match.modalita, 4);                 // Bit 34-37
    appendBits(match.regioni, 34);                 // Bit 0-33

    return binaryMatch.toString(2).padStart(56, "0");
  },

  // --------------------------------------------------------------------------
  // CORE 2: DEMULTIPLEXER (56 BIT BINARY -> JSON)
  // --------------------------------------------------------------------------
  procedure_recreate_field: (binaryString) => {
    // 1. Cast sicuro a 64-bit
    const matchReg = typeof binaryString === "string" ? BigInt("0b" + binaryString) : BigInt(binaryString);

    // 2. Estrazione logica con maschere Bitwise (AND / Ghigliottina binaria)
    const stato_bits       = (matchReg >> 54n) & 0b11n;              
    const is_squad_bits    = (matchReg >> 53n) & 0b1n;               
    const all_cons_bits    = (matchReg >> 52n) & 0b1n;               
    const ranked_bits      = (matchReg >> 51n) & 0b1n;               
    const all_win_bits     = (matchReg >> 50n) & 0b1n;               
    const rand_spawn_bits  = (matchReg >> 49n) & 0b1n;               
    const max_players_bits = (matchReg >> 46n) & 0b111n;             
    const duration_bits    = (matchReg >> 42n) & 0b1111n;            
    const moltiplic_bits   = (matchReg >> 38n) & 0b1111n;            
    const modalita_bits    = (matchReg >> 34n) & 0b1111n;            
    const regioni_bits     = (matchReg >> 0n)  & ((1n << 34n) - 1n); 

    // 3. Decodifica e ricompilazione
    const reconstructed_match = {
      stato: Eru.decode_stato(stato_bits),
      squad: Eru.decode_squad(is_squad_bits),
      alleanzeConsentite: Eru.decode_alleanze_consentite(all_cons_bits),
      ranked: Eru.decode_ranked(ranked_bits),
      alleanzeWin: Eru.decode_alleanze_win(all_win_bits),
      randomSpawn: Eru.decode_random_spawn(rand_spawn_bits),
      maxPlayers: Eru.decode_max_players(max_players_bits, is_squad_bits), 
      duration: Eru.decode_duration(duration_bits),
      moltiplicatoreTemporale: Eru.decode_moltiplicatore_temporale(moltiplic_bits),
      modalita: Eru.decode_modalita(modalita_bits),
      regioni: Eru.decode_regioni(regioni_bits),
    };

    return reconstructed_match;
  },
};

module.exports = Eru;