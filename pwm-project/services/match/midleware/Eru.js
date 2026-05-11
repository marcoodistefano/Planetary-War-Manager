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
  "1v1": 0b000,
  "2v2": 0b001,
  "3v3": 0b010,
  "4v4": 0b011,
  "5v5": 0b100,
  "10v10": 0b101,
  "25v25": 0b110,
  "50v50": 0b111,
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
  "1x": 0b0000,
  "2x": 0b0001,
  "3x": 0b0010,
  "4x": 0b0011,
  "5x": 0b0100,
  "10x": 0b0101,
  "20x": 0b0110,
  "30x": 0b0111,
  "40x": 0b0111,
  "50x": 0b1000,
  "60x": 0b1001,
  "100x": 0b1010,
  "200x": 0b1011,
  "500x": 0b1100,
  "1000x": 0b1101,
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
  //32 bit
  WORLD: 0b1000000000000000000000000000000000,
  EUROPE: 0b0100000000000000000000000000000000,
  ASIA: 0b0010000000000000000000000000000000,
  AFRICA: 0b0001000000000000000000000000000000,
  OCEANIA: 0b0000100000000000000000000000000000,
  AMERICA_NORTH: 0b0000010000000000000000000000000000,
  AMERICA_SOUTH: 0b0000001000000000000000000000000000,
  ANTARTICA: 0b0000000100000000000000000000000000,
  MIDDLE_EAST: 0b0000000010000000000000000000000000,
  ITALY: 0b0000000001000000000000000000000000,
  OLD_WORLD: 0b0000000000100000000000000000000000,
  PANGEA: 0b0000000000010000000000000000000000,
  ASIA: 0b0000000000001000000000000000000000,
  RUSSIA: 0b0000000000000100000000000000000000,
  CUSTOM: 0b0000000000000010000000000000000000,
  //NOT YET IMPLEMENTED
  OTHER:  0b0000000000000001000000000000000000,
  OTHER1: 0b0000000000000000100000000000000000,
  OTHER2: 0b0000000000000000010000000000000000,
  OTHER3: 0b0000000000000000001000000000000000,
  OTHER4: 0b0000000000000000000100000000000000,
  OTHER5: 0b0000000000000000000010000000000000,
  OTHER6: 0b0000000000000000000001000000000000,
  OTHER7: 0b0000000000000000000000100000000000,
  OTHER8: 0b0000000000000000000000010000000000,
  OTHER9: 0b0000000000000000000000001000000000,
  OTHER10: 0b000000000000000000000000100000000,
  OTHER11: 0b0000000000000000000000000100000000,
  OTHER12: 0b0000000000000000000000000010000000,
  OTHER13: 0b0000000000000000000000000001000000,
  OTHER14: 0b0000000000000000000000000000100000,
  OTHER15: 0b0000000000000000000000000000010000,
  OTHER16: 0b0000000000000000000000000000001000,
  OTHER17: 0b0000000000000000000000000000000100,
  OTHER18: 0b0000000000000000000000000000000010,
  OTHER19: 0b0000000000000000000000000000000001,
};

const Eru ={
    switch_max_players: (maxPlayers) => {
        switch (maxPlayers) {
            case 1:
                return 0b0001;
            case 2:
                return 0b0010;
            case 3:
                return 0b0011;
            case 4:
                return 0b0100;
            case 5:
                return 0b0101;
            case 10:
                return 0b0110;
            case 20:
                return 0b0111;
            case 30:
                return 0b1000;
            case 40:
                return 0b1001;
            case 50:
                return 0b1010;
            case 60:
                return 0b1011;
            case 100:
                return 0b1100;
            case 200:
                return 0b1101;
            case 500:
                return 0b1110;
            case 1000:
                return 0b1111;
            default:
                throw new Error("Numero di giocatori non valido");
        }
    }
};

module.exports = Eru;