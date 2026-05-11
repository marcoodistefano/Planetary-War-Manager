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
}
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
  x40: 0b0111,
  x50: 0b1000,
  x60: 0b1001,
  x100: 0b1010,
  x200: 0b1011,
  x500: 0b1100,
  x1000: 0b1101,
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
  OTHER8: 0b1111, //non implementata, da definire
};
const REGIONI = {
  //29 bit
  WORLD: 0b1000000000000000000000000000000,
  EUROPE: 0b0100000000000000000000000000000,
  ASIA: 0b0010000000000000000000000000000,
  AFRICA: 0b0001000000000000000000000000000,
  OCEANIA: 0b0000100000000000000000000000000,
  AMERICA_NORTH: 0b000001000000000000000000000000,
  AMERICA_SOUTH: 0b000000100000000000000000000000,
  ANTARTICA: 0b0000000100000000000000000000000,
  MIDDLE_EAST: 0b0000000010000000000000000000000,
  ITALY: 0b0000000001000000000000000000000,
  OLD_WORLD: 0b0000000000100000000000000000000,
  PANGEA: 0b0000000000010000000000000000000,
  ASIA: 0b0000000000001000000000000000000,
  RUSSIA: 0b0000000000000100000000000000000,
  CUSTOM: 0b0000000000000010000000000000000,
  //NOT YET IMPLEMENTED
  OTHER:  0b0000000000000001000000000000000,
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

const Eru ={
    switch_max_players: (maxPlayers) => {
        switch (maxPlayers) {
            case "1v1":
                return MAX_PLAYER.v1;
            case "2v2":
                return MAX_PLAYER.v2;
            case "3v3":
                return MAX_PLAYER.v3;
            case "4v4":
                return MAX_PLAYER.v4;
            case "5v5":
                return MAX_PLAYER.v5;
            case "10v10":
                return MAX_PLAYER.v10;
            case "25v25":
                return MAX_PLAYER.v25;
            case "50v50":
                return MAX_PLAYER.v50;
            case "ten":
                return MAX_PLAYER.ten;
            case "twenty":
                return MAX_PLAYER.twenty;
            case "thirty":
                return MAX_PLAYER.thirty;
            case "fifty":
                return MAX_PLAYER.fifty;
            case "hundred":
                return MAX_PLAYER.hundred;
            case "twohundred_fifty":
                return MAX_PLAYER.twohundred_fifty;
            case "fivehundred":
                return MAX_PLAYER.fivehundred;
            case "twohundred_fifty":
                return MAX_PLAYER.twohundred_fifty;
            default:
                throw new Error("Numero di giocatori non valido");
        }
    },
    switch_max_duration: (maxDuration) => {
        switch (maxDuration) {
            case "1 ora":
                return MAX_DURATION.RUSH;
            case "6 ore":
                return MAX_DURATION.CRAZY;
            case "12 ore":
                return MAX_DURATION.INSANE;
            case "1 giorno":
                return MAX_DURATION.FAST;
            case "3 giorni":
                return MAX_DURATION.SHORT;
            case "5 giorni":
                return MAX_DURATION.MEDIUM;
            case "7 giorni":
                return MAX_DURATION.DEFAULT;
            case "10 giorni":
                return MAX_DURATION.MEDIUM_LONG;
            case "14 giorni":
                return MAX_DURATION.LONG;
            case "32 giorni":
                return MAX_DURATION.CHILL;
            case "60 giorni":
                return MAX_DURATION.VERY_LONG;
            case "90 giorni":
                return MAX_DURATION.HARD;
            case "120 giorni":
                return MAX_DURATION.MAX;
            case "nessun limite di tempo":
                return MAX_DURATION.UNLIMITED;
            default:
                throw new Error("Durata massima non valida");
        }
    },

    switch_moltiplicatore_temporale : (moltiplicatoreTemporale) => {
        switch (moltiplicatoreTemporale) {
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
            case "produzione istantanea":
                return MOLTIPLICATORE_TEMPORALE.UNLIMITED;
            default:
                throw new Error("Moltiplicatore temporale non valido");
        }
    },

    switch_modalita: (modalita) => {
        switch (modalita) {
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

    procedure_enstablish_regions: (regioni) => {},

};

  
module.exports = Eru;