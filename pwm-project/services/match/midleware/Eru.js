const STATO = {
  //2 bit
  IN_ATTESA: 0b00,
  IN_CORSO: 0b01,
  TERMINATA: 0b10,
  ELIMINATA: 0b11,
};
const SQUAD = {
  //1 bit
  FREE_FOR_ALL: 0b0, //tutti contro tutti
  SQUAD: 0b1, //partita a squadre; il numero di giocatori è determinato dai valori di sopra e moltiplicato per 2 (es. se max_players è 3v3 allora in realtà è 6v6)
};
const ALLEANZE_CONSENTITE = {
  //1 bit
  NO_ALLIANCES: 0b0, //non sono consentite alleanze tra giocatori
  ALLIANCES_ALLOWED: 0b1, //sono consentite alleanze tra giocatori; in questo caso i giocatori possono formare alleanze tra di loro durante la partita, condividendo risorse, strategie e obiettivi. Le alleanze possono essere temporanee o durature, a seconda delle dinamiche della partita e delle decisioni dei giocatori.
};
const RANKED = {
  //1 bit
  UNRANKED: 0b0, //partita non classificata; i risultati della partita non influenzano il ranking dei giocatori e non vengono registrati nelle classifiche ufficiali.
  RANKED: 0b1, //partita classificata; i risultati della partita influenzano il ranking dei giocatori e vengono registrati nelle classifiche ufficiali. Le partite classificate sono generalmente più competitive e richiedono un impegno maggiore da parte dei giocatori, poiché le loro prestazioni avranno un impatto diretto sulla loro posizione nella classifica.
};
const ALLEANZE_WIN = {
  //1 bit
  NO_ALLIANCES_WIN: 0b0, //le alleanze non portano alla vittoria; in questo caso, anche se i giocatori formano alleanze durante la partita, la vittoria viene assegnata al giocatore o alla squadra che raggiunge per primo l'obiettivo finale della partita (es. conquista di una certa area, eliminazione completa di un avversario, ecc.), indipendentemente dalle alleanze formate.
  ALLIANCES_CAN_WIN: 0b1, //le alleanze possono portare alla vittoria; in questo caso, se i giocatori formano alleanze durante la partita e raggiungono insieme l'obiettivo finale della partita (es. conquista di una certa area, eliminazione completa di un avversario, ecc.), la vittoria viene assegnata a tutti i membri dell'alleanza che hanno contribuito al raggiungimento dell'obiettivo, indipendentemente dalle prestazioni individuali dei singoli giocatori all'interno dell'alleanza.
};
const MAX_PLAYERS = {
  //3 bit
  ten: 0b000,
  twenty: 0b001,
  thirty: 0b010,
  fifty: 0b011,
  hundred: 0b100,
  undred: 0b100,
  twohundred_fifty: 0b101,
  fivehundred: 0b110,
  //il valore 111 è riservato per le partite a squadre. Se il campo "Is_squad" è pari a 1 allora il
  //max_players sarà determinato dai valori qui sotto. Se "Is_squad" è 0 ma questo campo ha assunto il
  //valore 111 allora i valori di base sono moltiplicati per 2 e sono considerati solo i valori di sopra.
  v1: 0b000,
  v2: 0b001,
  v3: 0b010,
  v4: 0b011,
  v5: 0b100,
  v10: 0b101,
  v25: 0b110,
  v50: 0b111,
};
const DURATION_MAX = {
  //4 bit
  CONTROLLO: 0b0000,
  RUSH: 0b0001, //1 ora; PRODUZIONE ISTANTANEA DI TUTTE LE RICERCHE, COSTRUIZIONI, UNITÀ; L'UTENTE SPAWNA CON MOLTISSIME RISORSE INIZIALI (NON TROPPE DA POTER MAXARE TUTTO SUBITO!)
  CRAZY: 0b0010, //6 ore
  INSANE: 0b0011, //12 ore
  FAST: 0b0100, //1 giorno
  SHORT: 0b0101, //3 giorni
  MEDIUM: 0b0110, //5 giorni
  DEFAULT: 0b0111, //7 giorni
  MEDIUM_LONG: 0b1000, //10 giorni
  LONG: 0b1001, //14 giorni
  CHILL: 0b1010, //32 giorni
  VERY_LONG: 0b1011, //60 giorni
  HARD: 0b1100, //90 giorni
  MAX: 0b1110, //120 giorni
  UNLIMITED: 0b1111, //nessun limite di tempo; SOLO PER CONQUISTA DI MAPPA O DISTRUZIONE COMPLETA DEL NEMICO; IN QUESTO CASO LA PARTITA TERMINA QUANDO UN GIOCATORE RAGGIUNGE UN OBIETTIVO SPECIFICO (ES. CONQUISTA DI UNA CERTA AREA, ELIMINAZIONE COMPLETA DI UN AVVERSARIO, ECC.). SI APPLICA ANCHE PER LE SQUADRE.
};

const MOLTIPLICATORE_TEMPORALE = {
  //4 bit
  //NON INFLUENZA LA DURATA MASSIMA DELLA PARTITA, MA INFLUISCE SULLA VELOCITÀ DI PRODUZIONE RISORSE/RICERCA ETC DELLA PARTITA
  x1: 0b0000,
  x2: 0b0001,
  x3: 0b0010,
  x4: 0b0011,
  x5: 0b0100,
  x10: 0b0101,
  x20: 0b0110,
  x30: 0b0111,
  x40: 0b1000,
  x50: 0b1001,
  x60: 0b1010,
  x100: 0b1011,
  x200: 0b1100,
  x500: 0b1101,
  x1000: 0b1110,
  UNLIMITED: 0b1111, //PRODUZIONE ISTANTANEA DI TUTTE LE RICERCHE, COSTRUZIONI, UNITÀ;
};

const MODALITA = {
  //4 bit
  //il primo bit a 1 (MSB) indica che è una partita a squadre, altrimenti è tutti contro tutti; se è una partita a squadre allora il numero massimo di giocatori è determinato dai valori di sopra e moltiplicato per 2 (es. se max_players è 3v3 allora in realtà è 6v6); se non è una partita a squadre allora il numero massimo di giocatori è determinato solo dai valori di sopra e il valore 111 (50v50) è riservato per le partite a squadre.
  FREE_FOR_ALL: 0b0000, //Tutti contro tutti, ogni giocatore per sé
  CAPTURE_THE_FLAG: 0b0001, //LOL CTF??? ahahah
  KING_OF_THE_HILL: 0b0010, //dominio
  DOMINATION: 0b0011, //conquista di aree della mappa
  DESTRUCTION: 0b0100, //distruzione completa del nemico
  OTHER: 0b0111, //non implementata, da definire
  OTHER1: 0b1000, //non implementata, da definire
  OTHER2: 0b1001, //non implementata, da definire
  OTHER3: 0b1010, //non implementata, da definire
  OTHER4: 0b1011, //non implementata, da definire
  OTHER5: 0b1100, //non implementata, da definire
  OTHER6: 0b1101, //non implementata, da definire
  OTHER7: 0b1110, //non implementata, da definire
  OTHER8: 0b0101, //non implementata, da definire
  CONTROLLO: 0b1111,
};

const normalizeStringValue = (value) =>
  typeof value === "string" ? value.trim() : value;
const isEnabledValue = (value) =>
  value === true || value === 1 || value === "1" || value === "true";
const isDisabledValue = (value) =>
  value === false || value === 0 || value === "0" || value === "false";

const maxPlayersLookup = new Map([
  ["10", MAX_PLAYERS.ten],
  ["ten", MAX_PLAYERS.ten],
  ["20", MAX_PLAYERS.twenty],
  ["twenty", MAX_PLAYERS.twenty],
  ["30", MAX_PLAYERS.thirty],
  ["thirty", MAX_PLAYERS.thirty],
  ["50", MAX_PLAYERS.fifty],
  ["fifty", MAX_PLAYERS.fifty],
  ["100", MAX_PLAYERS.hundred],
  ["hundred", MAX_PLAYERS.hundred],
  ["undred", MAX_PLAYERS.undred],
  ["250", MAX_PLAYERS.twohundred_fifty],
  ["twohundred_fifty", MAX_PLAYERS.twohundred_fifty],
  ["500", MAX_PLAYERS.fivehundred],
  ["fivehundred", MAX_PLAYERS.fivehundred],
  ["1v1", MAX_PLAYERS.v1],
  ["2v2", MAX_PLAYERS.v2],
  ["3v3", MAX_PLAYERS.v3],
  ["4v4", MAX_PLAYERS.v4],
  ["5v5", MAX_PLAYERS.v5],
  ["10v10", MAX_PLAYERS.v10],
  ["25v25", MAX_PLAYERS.v25],
  ["50v50", MAX_PLAYERS.v50],
]);
const REGIONI = {
  //29 bit
  CONTROLLO: 0b0000000000000000000000000000000,
  WORLD: 0b10000000000000000000000000000,
  EUROPE: 0b01000000000000000000000000000,
  ASIA: 0b00100000000000000000000000000,
  AFRICA: 0b00010000000000000000000000000,
  OCEANIA: 0b00001000000000000000000000000,
  AMERICA_NORTH: 0b00000100000000000000000000000,
  AMERICA_SOUTH: 0b00000010000000000000000000000,
  ANTARTICA: 0b00000001000000000000000000000,
  MIDDLE_EAST: 0b0000000010000000000000000000000,
  ITALY: 0b0000000001000000000000000000000,
  OLD_WORLD: 0b0000000000100000000000000000000,
  PANGEA: 0b0000000000010000000000000000000,
  SIBERIA: 0b0000000000001000000000000000000,
  RUSSIA: 0b0000000000000100000000000000000,
  CUSTOM: 0b0000000000000010000000000000000,
  //NOT YET IMPLEMENTED
  OTHER: 0b0000000000000001000000000000000,
  OTHER1: 0b0000000000000000100000000000000,
  OTHER2: 0b0000000000000000010000000000000,
  OTHER3: 0b0000000000000000001000000000000,
  OTHER4: 0b0000000000000000000100000000000,
  OTHER5: 0b0000000000000000000010000000000,
  OTHER6: 0b0000000000000000000001000000000,
  OTHER7: 0b0000000000000000000000100000000,
  OTHER8: 0b0000000000000000000000010000000,
  OTHER9: 0b0000000000000000000000001000000,
  OTHER10: 0b0000000000000000000000001000000,
  OTHER11: 0b0000000000000000000000000100000,
  OTHER12: 0b0000000000000000000000000010000,
  OTHER13: 0b0000000000000000000000000001000,
  OTHER14: 0b0000000000000000000000000000100,
  OTHER15: 0b0000000000000000000000000000010,
  OTHER16: 0b0000000000000000000000000000001,
};
const validCombos = new Set([
  REGIONI.EUROPE,
  REGIONI.ASIA,
  REGIONI.AFRICA,
  REGIONI.OCEANIA,
  REGIONI.AMERICA_NORTH,
  REGIONI.AMERICA_SOUTH,
  REGIONI.ANTARTICA,
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
  REGIONI.AMERICA_NORTH |
    REGIONI.AMERICA_SOUTH |
    REGIONI.EUROPE |
    REGIONI.AFRICA,
  REGIONI.AMERICA_NORTH |
    REGIONI.AMERICA_SOUTH |
    REGIONI.EUROPE |
    REGIONI.AFRICA |
    REGIONI.ASIA,
  REGIONI.AMERICA_NORTH | REGIONI.AMERICA_SOUTH | REGIONI.ANTARTICA,
]);

const supportedMask =
  REGIONI.WORLD |
  REGIONI.EUROPE |
  REGIONI.ASIA |
  REGIONI.AFRICA |
  REGIONI.OCEANIA |
  REGIONI.AMERICA_NORTH |
  REGIONI.AMERICA_SOUTH |
  REGIONI.ANTARTICA;

const Eru = {
  switch_stato: (stato) => {
    switch (normalizeStringValue(stato)) {
      case "In attesa":
        return STATO.IN_ATTESA;
      case "In corso":
        return STATO.IN_CORSO;
      case "Terminata":
      case "Completata":
        return STATO.TERMINATA;
      case "Eliminata":
      case "Annullata":
        return STATO.ELIMINATA;
      default:
        throw new Error("Stato non valido");
    }
  },
  switch_squad: (squad) => {
    if (isEnabledValue(squad)) {
      return SQUAD.SQUAD;
    }
    if (isDisabledValue(squad)) {
      return SQUAD.FREE_FOR_ALL;
    }

    switch (normalizeStringValue(squad)) {
      case "Tutti contro tutti":
        return SQUAD.FREE_FOR_ALL;
      case "Squad":
        return SQUAD.SQUAD;
      default:
        throw new Error("Valore squad non valido");
    }
  },
  switch_alleanze_consentite: (alleanzeConsentite) => {
    if (isEnabledValue(alleanzeConsentite)) {
      return ALLEANZE_CONSENTITE.ALLIANCES_ALLOWED;
    }
    if (isDisabledValue(alleanzeConsentite)) {
      return ALLEANZE_CONSENTITE.NO_ALLIANCES;
    }

    switch (normalizeStringValue(alleanzeConsentite)) {
      case "No alleanze":
        return ALLEANZE_CONSENTITE.NO_ALLIANCES;
      case "Alleanze consentite":
        return ALLEANZE_CONSENTITE.ALLIANCES_ALLOWED;
      default:
        throw new Error("Valore alleanze consentite non valido");
    }
  },
  switch_ranked: (ranked) => {
    if (isEnabledValue(ranked)) {
      return RANKED.RANKED;
    }
    if (isDisabledValue(ranked)) {
      return RANKED.UNRANKED;
    }

    switch (normalizeStringValue(ranked)) {
      case "Unranked":
        return RANKED.UNRANKED;
      case "Ranked":
        return RANKED.RANKED;
      default:
        throw new Error("Valore ranked non valido");
    }
  },
  switch_alleanze_win: (alleanzeWin) => {
    if (isEnabledValue(alleanzeWin)) {
      return ALLEANZE_WIN.ALLIANCES_CAN_WIN;
    }
    if (isDisabledValue(alleanzeWin)) {
      return ALLEANZE_WIN.NO_ALLIANCES_WIN;
    }

    switch (normalizeStringValue(alleanzeWin)) {
      case "Le alleanze non portano alla vittoria":
        return ALLEANZE_WIN.NO_ALLIANCES_WIN;
      case "Le alleanze possono portare alla vittoria":
        return ALLEANZE_WIN.ALLIANCES_CAN_WIN;
      default:
        throw new Error("Valore alleanze win non valido");
    }
  },
  switch_max_players: (maxPlayers) => {
    const maxPlayersValue = maxPlayersLookup.get(
      normalizeStringValue(maxPlayers),
    );
    if (maxPlayersValue !== undefined) {
      return maxPlayersValue;
    }
    throw new Error("Numero di giocatori non valido");
  },
  switch_max_duration: (maxDuration) => {
    switch (normalizeStringValue(maxDuration)) {
      case "1 ora":
        return DURATION_MAX.RUSH;
      case "6 ore":
        return DURATION_MAX.CRAZY;
      case "12 ore":
        return DURATION_MAX.INSANE;
      case "1 giorno":
        return DURATION_MAX.FAST;
      case "3 giorni":
        return DURATION_MAX.SHORT;
      case "5 giorni":
        return DURATION_MAX.MEDIUM;
      case "7 giorni":
        return DURATION_MAX.DEFAULT;
      case "10 giorni":
        return DURATION_MAX.MEDIUM_LONG;
      case "14 giorni":
        return DURATION_MAX.LONG;
      case "32 giorni":
        return DURATION_MAX.CHILL;
      case "60 giorni":
        return DURATION_MAX.VERY_LONG;
      case "90 giorni":
        return DURATION_MAX.HARD;
      case "120 giorni":
        return DURATION_MAX.MAX;
      case "Nessun limite":
      case "nessun limite di tempo":
        return DURATION_MAX.UNLIMITED;
      default:
        throw new Error("Durata massima non valida");
    }
  },

  switch_moltiplicatore_temporale: (moltiplicatoreTemporale) => {
    switch (normalizeStringValue(moltiplicatoreTemporale)) {
      case "x1":
        return MOLTIPLICATORE_TEMPORALE.x1;
      case "x2":
        return MOLTIPLICATORE_TEMPORALE.x2;
      case "x3":
        return MOLTIPLICATORE_TEMPORALE.x3;
      case "x4":
        return MOLTIPLICATORE_TEMPORALE.x4;
      case "x5":
        return MOLTIPLICATORE_TEMPORALE.x5;
      case "x10":
        return MOLTIPLICATORE_TEMPORALE.x10;
      case "x20":
        return MOLTIPLICATORE_TEMPORALE.x20;
      case "x30":
        return MOLTIPLICATORE_TEMPORALE.x30;
      case "x40":
        return MOLTIPLICATORE_TEMPORALE.x40;
      case "x50":
        return MOLTIPLICATORE_TEMPORALE.x50;
      case "x60":
        return MOLTIPLICATORE_TEMPORALE.x60;
      case "x100":
        return MOLTIPLICATORE_TEMPORALE.x100;
      case "x200":
        return MOLTIPLICATORE_TEMPORALE.x200;
      case "x500":
        return MOLTIPLICATORE_TEMPORALE.x500;
      case "x1000":
        return MOLTIPLICATORE_TEMPORALE.x1000;
      case "Produzione Istantanea":
      case "produzione istantanea":
        return MOLTIPLICATORE_TEMPORALE.UNLIMITED;
      default:
        throw new Error("Moltiplicatore temporale non valido");
    }
  },

  switch_modalita: (modalita) => {
    switch (normalizeStringValue(modalita)) {
      case "Tutti contro tutti":
        return MODALITA.FREE_FOR_ALL;
      case "Capture the Flag":
        return MODALITA.CAPTURE_THE_FLAG;
      case "King of the Hill":
        return MODALITA.KING_OF_THE_HILL;
      case "Domination":
        return MODALITA.DOMINATION;
      case "Destruction":
        return MODALITA.DESTRUCTION;
      case "Other":
        return MODALITA.OTHER;
      case "Other1":
        return MODALITA.OTHER1;
      case "Other2":
        return MODALITA.OTHER2;
      case "Other3":
        return MODALITA.OTHER3;
      case "Other4":
        return MODALITA.OTHER4;
      case "Other5":
        return MODALITA.OTHER5;
      case "Other6":
        return MODALITA.OTHER6;
      case "Other7":
        return MODALITA.OTHER7;
      case "Other8":
        return MODALITA.OTHER8;
      default:
        throw new Error("Modalità di gioco non valida");
    }
  },
  switch_regioni: (regione) => {
    switch (regione) {
      case "World":
        return REGIONI.WORLD;
      case "Europe":
        return REGIONI.EUROPE;
      case "Asia":
        return REGIONI.ASIA;
      case "Africa":
        return REGIONI.AFRICA;
      case "Oceania":
        return REGIONI.OCEANIA;
      case "America North":
        return REGIONI.AMERICA_NORTH;
      case "America South":
        return REGIONI.AMERICA_SOUTH;
      case "Antartica":
        return REGIONI.ANTARTICA;
      case "Middle East":
        return REGIONI.MIDDLE_EAST;
      case "Italy":
        return REGIONI.ITALY;
      case "Old World":
        return REGIONI.OLD_WORLD;
      case "Pangea":
        return REGIONI.PANGEA;
      case "Russia":
        return REGIONI.RUSSIA;
      case "Custom":
        return REGIONI.CUSTOM;
      case "Other":
        return REGIONI.OTHER;
      case "Other1":
        return REGIONI.OTHER1;
      case "Other2":
        return REGIONI.OTHER2;
      case "Other3":
        return REGIONI.OTHER3;
      case "Other4":
        return REGIONI.OTHER4;
      case "Other5":
        return REGIONI.OTHER5;
      case "Other6":
        return REGIONI.OTHER6;
      case "Other7":
        return REGIONI.OTHER7;
      case "Other8":
        return REGIONI.OTHER8;
      case "Other9":
        return REGIONI.OTHER9;
      case "Other10":
        return REGIONI.OTHER10;
      case "Other11":
        return REGIONI.OTHER11;
      case "Other12":
        return REGIONI.OTHER12;
      case "Other13":
        return REGIONI.OTHER13;
      case "Other14":
        return REGIONI.OTHER14;
      case "Other15":
        return REGIONI.OTHER15;
      case "Other16":
        return REGIONI.OTHER16;
      default:
        throw new Error("Regione non valida");
    }
  },

  regions_rules(next_generation_buffer) {
    if ((next_generation_buffer & ~supportedMask) !== 0) {
      return false;
    }

    if ((next_generation_buffer & REGIONI.WORLD) !== 0) {
      return next_generation_buffer === REGIONI.WORLD;
    }
    if (validCombos.has(next_generation_buffer)) {
      return validCombos.has(next_generation_buffer);
    }
    return false;
  },

  procedure_enstablish_stato: (stato) => {
    return Eru.switch_stato(stato);
  },
  procedure_enstablish_squad: (squad) => {
    return Eru.switch_squad(squad);
  },
  procedure_enstablish_alleanze_consentite: (alleanzeConsentite) => {
    return Eru.switch_alleanze_consentite(alleanzeConsentite);
  },
  procedure_enstablish_ranked: (ranked) => {
    return Eru.switch_ranked(ranked);
  },
  procedure_enstablish_alleanze_win: (alleanzeWin) => {
    return Eru.switch_alleanze_win(alleanzeWin);
  },
  procedure_enstablish_max_players(maxPlayers, isSquad) {
    void isSquad;
    return Eru.switch_max_players(maxPlayers);
  },
  procedure_enstablish_duration(duration) {
    return Eru.switch_max_duration(duration);
  },
  procedure_enstablish_moltiplicatore_temporale(moltiplicatoreTemporale) {
    return Eru.switch_moltiplicatore_temporale(moltiplicatoreTemporale);
  },
  procedure_enstablish_modalita(modalita) {
    return Eru.switch_modalita(modalita);
  },
  procedure_enstablish_regions: (regioni) => {
    if (regioni.includes("World")) {
      return REGIONI.WORLD;
    }

    let memorize_buffer = REGIONI.CONTROLLO;
    for (let i = 0; i < regioni.length; i++) {
      const xor_buffer = Eru.switch_regioni(regioni[i]);
      const next_generation_buffer = memorize_buffer | xor_buffer;
      if (Eru.regions_rules(next_generation_buffer)) {
        memorize_buffer = next_generation_buffer;
      } else {
        console.log(
          `Combinazione di regioni non valida: ${regioni[i]} non può essere combinata con le regioni precedenti`,
        );
      }
    }
    return memorize_buffer;
  },
  procedure_create_match: (req) => {
    const isSquad = Eru.procedure_enstablish_squad(req.body.squad);
    const match = {
      stato: Eru.procedure_enstablish_stato(req.body.stato),
      is_squad: isSquad,
      alleanze_consentite: Eru.procedure_enstablish_alleanze_consentite(
        req.body.alleanzeConsentite,
      ),
      ranked: Eru.procedure_enstablish_ranked(req.body.ranked),
      alleanze_win: Eru.procedure_enstablish_alleanze_win(req.body.alleanzeWin),
      max_players: Eru.procedure_enstablish_max_players(
        req.body.maxPlayers,
        isSquad,
      ),
      duration: Eru.procedure_enstablish_duration(req.body.duration),
      moltiplicatore_temporale:
        Eru.procedure_enstablish_moltiplicatore_temporale(
          req.body.moltiplicatoreTemporale,
        ),
      modalita: Eru.procedure_enstablish_modalita(req.body.modalita),
      regioni: Eru.procedure_enstablish_regions(req.body.regioni),
    };
    const binary_match = Eru.create_binary_match(match);
    console.log(`Match creato: ${JSON.stringify(match)}`);
    return { match, binary_match };
  },

  /*FORMATO DEL MATCH IN BINARIO (56 BIT):
    - 2 bit per lo stato della partita (00 = in attesa, 01 = in corso, 10 = terminata, 11 = eliminata)
    - 1 bit per indicare se è una partita a squadre o tutti contro tutti (0 = tutti contro tutti, 1 = partita a squadre)
    - 1 bit per indicare se sono consentite alleanze tra giocatori (0 = no alleanze, 1 = alleanze consentite)
    - 1 bit per indicare se la partita è classificata o non classificata (0 = unranked, 1 = ranked)
    - 1 bit per indicare se le alleanze portano alla vittoria o no (0 = le alleanze non portano alla vittoria, 1 = le alleanze possono portare alla vittoria)
    - 3 bit per il numero massimo di giocatori (valori da 0 a 7, con 7 riservato per le partite a squadre; se "Is_squad" è 1 allora il numero massimo di giocatori è determinato dai valori di sopra e moltiplicato per 2, altrimenti è determinato solo dai valori di sopra)
    - 4 bit per la durata massima della partita (valori da 0 a 15, con ogni valore che rappresenta una durata specifica come descritto sopra)
    - 4 bit per il moltiplicatore temporale della partita (valori da 0 a 15, con ogni valore che rappresenta un moltiplicatore specifico come descritto sopra)
    - 4 bit per la modalità di gioco (valori da 0 a 15, con ogni valore che rappresenta una modalità specifica come descritto sopra)
    - 29 bit per le regioni geografiche (ogni bit rappresenta una regione specifica, con la possibilità di combinare più regioni tra loro; il valore 1 in un bit indica che la regione corrispondente è inclusa nella partita, mentre il valore 0 indica che non è inclusa; ad esempio, se i primi tre bit sono 1 e gli altri sono 0, significa che la partita include le regioni Europa, Asia e Africa, ma non include le altre regioni)
    LA STRUTTURA RISULTA: STATO (2 BIT) | IS_SQUAD (1 BIT) | ALLEANZE_CONSENTITE (1 BIT) | RANKED (1 BIT) | ALLEANZE_WIN (1 BIT) | MAX_PLAYERS (3 BIT) | 
                            DURATION_MAX (4 BIT) | MOLTIPLICATORE_TEMPORALE (4 BIT) | MODALITA (4 BIT) | REGIONI (29 BIT)
    */
  create_binary_match: (match) => {
    let binaryMatch = 0n;
    const appendBits = (value, width) => {
      binaryMatch = (binaryMatch << BigInt(width)) | BigInt(value);
    };

    appendBits(match.stato, 2);
    appendBits(match.is_squad, 1);
    appendBits(match.alleanze_consentite, 1);
    appendBits(match.ranked, 1);
    appendBits(match.alleanze_win, 1);
    appendBits(match.max_players, 3);
    appendBits(match.duration, 4);
    appendBits(match.moltiplicatore_temporale, 4);
    appendBits(match.modalita, 4);
    appendBits(match.regioni, 29);

    return binaryMatch.toString(2).padStart(50, "0").padEnd(56, "0");
  },
  check_start_match: (match, count) => {
    // Estrazione dei bit
    let res;
    let stato = (match >> 54n) & 0b11n;
    let maxPlayersBits = Number((match >> 48n) & 0b111n);
    let isSquad = (match >> 53n) & 0b1n;
    let maxPlayersCount = 0;
    // 1. Determinare il numero massimo di giocatori
    if (isSquad === 1n) {
      // Mappatura per le partite a squadre (v1, v2, v3, v4, v5, v10, v25, v50)
      const squadMap = [2, 4, 6, 8, 10, 20, 50, 100];
      maxPlayersCount = squadMap[maxPlayersBits];
    } else {
      // Mappatura per le partite normali (10, 20, 30, 50, 100, 250, 500)
      const soloMap = [10, 20, 30, 50, 100, 250, 500];
      if (maxPlayersBits === 7) {
        // 0b111
        maxPlayersCount = 500;
      } else {
        maxPlayersCount = soloMap[maxPlayersBits];
      }
    }
    // 2. Controllo della condizione: count >= 1/3 di maxPlayers e stato attuale == 01
    if (count >= maxPlayersCount / 3 && stato === 1n) {
      // Azzera i bit 54-55 e imposta il nuovo valore (10) lasciando intatto tutto il resto
      match = (match & ~(0b11n << 54n)) | (0b10n << 54n);
      res = {status : 200, message: "Partita avviata con successo", struttura_partita: match};
    }else {
      res = {status : 400, message: "Condizioni di avvio non soddisfatte", struttura_partita: match};
    }
    // Restituisce il BigInt aggiornato (o invariato se le condizioni non sono soddisfatte)
    return res;
  },
};

module.exports = Eru;
