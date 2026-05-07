-- ==========================================
-- PWM TACTICAL - POSTGRESQL SCHEMA (UPDATED)
-- ==========================================

-- Estensione per la generazione di UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Creazione TIPI ENUM (vanno creati PRIMA delle tabelle)
DO $$ BEGIN
    CREATE TYPE status_amico AS ENUM ('pending', 'accepted', 'rejected', 'blocked');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 1. UTENTI
CREATE TABLE IF NOT EXISTS utenti (
    id_user UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(32) NOT NULL UNIQUE,
    email VARCHAR(64) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    reg VARCHAR(32),
    elo_rating INT DEFAULT 1000,
    avatar_id SMALLINT DEFAULT 1,
    last_username_change TIMESTAMP NULL DEFAULT NULL,
    last_password_change TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    recupera_passwd VARCHAR(8) DEFAULT NULL,
    two_fa_method BIT(3) DEFAULT B'000', -- 3 bit per 3 metodi (app, email, sms)
    two_fa_secret VARCHAR(8) DEFAULT NULL,
    two_fa_enabled BOOLEAN DEFAULT FALSE,
    is_banned BOOLEAN DEFAULT FALSE,
    is_perma_banned BOOLEAN DEFAULT FALSE,
    codice_amico VARCHAR(10) UNIQUE
);

-- 1.1 AMICI (Corretta con l'ENUM)
CREATE TABLE IF NOT EXISTS amici (
    id_user UUID NOT NULL,
    id_amico UUID NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP NULL,
    status status_amico DEFAULT 'pending',
    link VARCHAR(10),
    link_duration INT,
    PRIMARY KEY (id_user, id_amico),
    CONSTRAINT fk_user_amici FOREIGN KEY (id_user) REFERENCES utenti(id_user) ON DELETE CASCADE,
    CONSTRAINT fk_target_amici FOREIGN KEY (id_amico) REFERENCES utenti(id_user) ON DELETE CASCADE
);
--1.2 BAN
CREATE TABLE IF NOT EXISTS ban (
    id_ban UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_user UUID NOT NULL,
    time_stamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    time_until TIMESTAMP NOT NULL,
    motivo VARCHAR(20) NOT NULL,
    CONSTRAINT fk_user_ban FOREIGN KEY (id_user) REFERENCES utenti(id_user) ON DELETE CASCADE
);
-- 2. ACCESSI
CREATE TABLE IF NOT EXISTS accessi (
    id_access UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    ip_address VARCHAR(45),
    login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cookie_token VARCHAR(255),
    expire_time TIMESTAMP,
    CONSTRAINT fk_user_accessi FOREIGN KEY (user_id) REFERENCES utenti(id_user) ON DELETE CASCADE
);

-- 3. PARTITE
CREATE TABLE IF NOT EXISTS partite (
    id_partita UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_partita_visualizzato VARCHAR(10) UNIQUE,
    id_partita_hash VARCHAR(255),
    nome_partita VARCHAR(100) NOT NULL,
    has_elo BOOLEAN DEFAULT TRUE,
    id_host UUID NOT NULL,
    -- duration_max INT DEFAULT 10080,
    -- num_player_max INT,
    -- tipo_partita VARCHAR(50),
    -- modalita VARCHAR(50),
    -- moltiplicatore VARCHAR(10),
    -- regioni_giocabili VARCHAR(16),
    -- stato VARCHAR(20),
    struttura_partita BIT(56) DEFAULT B'00000000000000000000000000000000000000000000000000000000', --HO AGGIUNTO 16 BIT IN PIU, DA CAPIRE IL REALE UTILIZZO, OLTRE CONFIGURAZIONI DI CONTROLLO. 
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    nome_json VARCHAR(255),
    CONSTRAINT fk_host FOREIGN KEY (id_host) REFERENCES utenti(id_user)
);

'''
//SERVONO REALMENTE SOLO 40 BIT 
//NB PARTITE: il server può gestire i campi da duration_max a stato, in un’unica stringa, compressa e gestita sui bit e memorizzata in B64. 
// per esempio, se la stringa dovesse memorizzare in questo ordine(tra parentesi i bit occupati):
// stato_partita [2], N_player_max[9 bit -> 512 player], duration_max[5 bit -> 32 giorni (se memorizzato in giorni)], moltiplicatore[4 bit->sono massimo 16 combinazioni, 0000 è default (1x), poi 2x, 3x, 5x, 10x, 20x, 30x, 40x…], tipo_partita [4], modalità [4 bit? 16 modalità…oppure 5?], regioni_giocabili [16 bit]
// 
// ->Stato partita {00->in attesa; 01->in corso; 10->terminata; 11->eliminata (si intende che si eliminano le mosse e il documento (si fa dopo X giorni dalla fine della partita))
// ->N_player_max -> conteggio classico… 10, 20, 30, 50, 100, 250, 500 -> si potrebbero usare, allora, solo 3 bit… {000 001 010 011 100 101 110 111} dove il valore 111 è assunto SOLO per modalità 1v1 e 2v2 (NvN < 10 giocatori totali)
// ->duration_max -> default è 7, quindi 0111, max è 1111 che indica 32 giorni; 0000 è controllo, NON UTILIZZATO
// ->moltiplicatore -> {1x 0000; 2x 0001; 3x 0010; 4x 0011; 5x 0100; 10x 0101; 20x 0110; 30x 0111; 40x 1000; 50x 1001; 60x 1010; 100x 1011; 200x 1100; 500x 1101; 1000x 1110; [ILLIMITATA (produzione istantanea di tutto eccetto che delle risorse) oppure 5000x 1111}
// -> tipo partita -> {1v1 0000; 2v2 0001; 3v3 0010; 5v5 0011; tutti_contro_tutti 0100…altro da definire}
// -> modalità ->SI CAMBIA SOLO UN BIT! {tempo 0000 (def.); distruzione 0001; conquista 0010; altro}
// -> regioni giocabili -> SI CAMBIA SOLO UN BIT! {0000000000000000} [DA MSB A LSB}
// MSB (bit 1^): tutto il mondobit 2: europabit 3: Asiabit 4: africa
// bit 5: oceaniabit 6: america NORDbit 7: america SUD
// DAL BIT 8 FINO AL 16 SONO ALTRE MODALITA, ALCUNI ESEMPI:
// bit 8: vecchio mondo (europa-medio oriente-nord africa)
// bit 9: medio orientebit 10: italia…
// Definito questo, procedo con un esempio: giocatore X ha appena creato una partita con le seguenti caratteristiche: 1v1, 7giorni, moltiplicatore x30, modalità conquista, solo italia. 
// il server avrà, allora, la seguente stringa di bit:
// 00|111|0111|0111|0000|0010|0000000001000000 '''

-- 4. PARTECIPANTI_PARTITE
CREATE TABLE IF NOT EXISTS partecipanti_partite (
    user_id UUID NOT NULL,
    partita_id UUID NOT NULL,
    nuovo_ELO INT,
    punteggio INT DEFAULT 0,
    territori_conquistati INT DEFAULT 0,
    territori_persi INT DEFAULT 0,
    capitali_distrutte INT DEFAULT 0,
    time_death TIMESTAMP NULL DEFAULT NULL,
    rank INT DEFAULT NULL,
    strutture_lvl_max INT DEFAULT 0,
    truppe_eliminate INT DEFAULT 0,
    truppe_perse INT DEFAULT 0,
    perc_distruzione REAL DEFAULT 0.0,
    id_alleanza UUID NULL,
    utenti_alleati JSONB DEFAULT '{}'::jsonb, 
    utenti_in_guerra JSONB DEFAULT '{}'::jsonb,
    stato_risorse JSONB DEFAULT '{}'::jsonb,
    stato_territori JSONB DEFAULT '{}'::jsonb,
    stato_ricerche JSONB DEFAULT '{}'::jsonb,
    PRIMARY KEY (user_id, partita_id),
    CONSTRAINT fk_user_partecipante FOREIGN KEY (user_id) REFERENCES utenti(id_user) ON DELETE CASCADE,
    CONSTRAINT fk_partita_partecipante FOREIGN KEY (partita_id) REFERENCES partite(id_partita) ON DELETE CASCADE
);
-- 5. MOSSE 
CREATE TABLE IF NOT EXISTS mosse (
    id_mossa UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    partita_id UUID NOT NULL,
    automatic_move BOOLEAN DEFAULT FALSE, --indica se è una mossa automatica (es. conquista di un territorio dopo la distruzione dell'armata che proteggeva lo stesso) o una mossa manuale (es. attacco, spostamento)
    type_action VARCHAR(16) NOT NULL, -- 'atk', 'mov', 'ric', 'str', 'altro'
    id_truppa UUID default NULL,
    id_armata UUID default NULL,
    id_territorio_conquista varchar(10) default NULL, --si specifica solo per mosse 'conq' cioè di conquista 
    queue_order INT, --da capire
    ttl TIMESTAMP DEFAULT now(),
    priorita VARCHAR(2) DEFAULT '00', -- Bit 11 per non eliminabili
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_mossa_owner FOREIGN KEY (user_id, partita_id) REFERENCES partecipanti_partite(user_id, partita_id) ON DELETE CASCADE
    CONSTRAINT fk_spostamento_truppa FOREIGN KEY (id_truppa) REFERENCES truppe(id_istanza_truppa) ON DELETE CASCADE, 
    CONSTRAINT fk_spostamento_armata FOREIGN KEY (id_armata) REFERENCES armata(id_istanza_armata) ON DELETE CASCADE
);
--DA CAPIRE COME GESTIRE LA PERSISTENZA DELLA PRODUZIONE STRUTTURE, RICERCHE E TRUPPE.
-- DA CAPIRE COME GESTIRE LE MOSSE AUTOMATICHE.
--5.1 STORICO 
--Si deve trasporre da id_mossa UUID a SERIAL, per evitare problemi di performance e gestione, visto che lo storico è una tabella molto grande e non serve un UUID per ogni mossa storicizzata.
--La tabella memorizza SOLO le partite concluse, mosse con priorità 11. Tutte le mosse, comunque, vengono eliminate da "Mosse"
CREATE TABLE IF NOT EXISTS storico (
    id_mossa SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    partita_id UUID NOT NULL,
    type_action VARCHAR(16) NOT NULL, -- 'atk', 'mov', 'ric', 'str', 'altro'
    CONSTRAINT fk_mossa_owner FOREIGN KEY (user_id, partita_id) REFERENCES partecipanti_partite(user_id, partita_id) ON DELETE CASCADE
);
-- 6. SPOSTAMENTI
-- indica la coda di uno spostamento: l'utente può scegliere un percorso non stabilito dagli archi (in un secondo momento).
-- Quando la tabella mosse indica "mov", allora si crea una riga in spostamenti, con i dati di destinazione e tempo di arrivo.
-- Se l'utente crea una 'coda di spostamenti', cioè una mossa di tipo "mov" che racchiude un percorso tra più nodi, allora 
-- si crea una riga per ogni spostamento, con numero_coda che indica l'ordine di esecuzione.
CREATE TABLE IF NOT EXISTS spostamenti (
    id_spostamento UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_mossa UUID NOT NULL,
    numero_coda INT,
    x_dest REAL,
    y_dest REAL,
    time_to_arrive TIMESTAMP,
    CONSTRAINT fk_spostamento_mossa FOREIGN KEY (id_mossa) REFERENCES mosse(id_mossa) ON DELETE CASCADE, 
);

--6.1 ATTACCHI
CREATE TABLE IF NOT EXISTS attacco (
    id_attacco UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_mossa UUID NOT NULL,
    id_target_truppa UUID default NULL,
    id_target_armata UUID default NULL,
    time_stamp TIMESTAMP default now(),
    CONSTRAINT fk_attacco_mossa FOREIGN KEY (id_mossa) REFERENCES mosse(id_mossa) ON DELETE CASCADE,
    CONSTRAINT fk_attacco_truppa FOREIGN KEY (id_target_truppa) REFERENCES truppe(id_istanza_truppa) ON DELETE SET NULL,
    CONSTRAINT fk_attacco_armata FOREIGN KEY (id_target_armata) REFERENCES armata(id_istanza_armata) ON DELETE SET NULL
);
-- 7. ALLEANZE
CREATE TABLE IF NOT EXISTS alleanze (
    id_alleanza UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome_alleanza VARCHAR(32) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    nome_logo VARCHAR(16),
    id_leader UUID NOT NULL,
    id_partita UUID NOT NULL,
    CONSTRAINT fk_leader FOREIGN KEY (id_leader) REFERENCES utenti(id_user),
    CONSTRAINT fk_partita_alleanza FOREIGN KEY (id_partita) REFERENCES partite(id_partita) ON DELETE CASCADE
);
-- 8. MESSAGGI
CREATE TABLE IF NOT EXISTS messaggio (
    id_mex UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_user_send UUID NOT NULL,
    id_partita UUID NOT NULL,
    content TEXT NOT NULL,
    time_stamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_messaggio_autore FOREIGN KEY (id_user_send, id_partita) 
        REFERENCES partecipanti_partite(user_id, partita_id) ON DELETE CASCADE
);

-- 9. CHAT (Corretta: rimossa doppia PK e tipi errati)
CREATE TABLE IF NOT EXISTS chat (
    id_chat_entry BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    id_mex UUID NOT NULL UNIQUE, -- Riferimento 1:1 al messaggio fisico
    id_user_receiver UUID NULL,  -- Opzionale (per chat private)
    tipo_chat VARCHAR(20),       -- 'globale', 'alleanza', 'privata'
    CONSTRAINT fk_chat_mex FOREIGN KEY (id_mex) REFERENCES messaggi(id_mex) ON DELETE CASCADE,
    CONSTRAINT fk_chat_receiver FOREIGN KEY (id_user_receiver) REFERENCES utenti(id_user) ON DELETE SET NULL
);

-- 10. TRUPPA
CREATE TABLE IF NOT EXISTS truppe (
    id_istanza_truppa UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partita_id UUID NOT NULL,
    user_id UUID NOT NULL,
    id_modello VARCHAR(16),
    id_armata UUID,
    x REAL,
    y REAL,
    alt REAL DEFAULT 0,
    rot REAL DEFAULT 0,
    hp INT,
    stato BIT(3) DEFAULT B'000', -- 00: idle, 01: in movimento, 10: in combattimento, 11: morto
    attitudine BIT(3) DEFAULT B'000', -- 000: difensiva, 001: offensiva, 010: esplorativa, 011: evasiva, 100: supporto
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_truppa_owner FOREIGN KEY (user_id, partita_id) REFERENCES partecipanti_partite(user_id, partita_id) ON DELETE CASCADE,
    CONSTRAINT fk_truppa_armata FOREIGN KEY (id_armata) REFERENCES armata(id_istanza_armata) ON DELETE SET NULL
);

-- 11. ARMATA
CREATE TABLE IF NOT EXISTS armata (
    id_istanza_armata UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partita_id UUID NOT NULL,
    user_id UUID NOT NULL,
    id_modello VARCHAR(16),
    x REAL, 
    y REAL,
    alt REAL DEFAULT 0,
    rot REAL DEFAULT 0,
    hp_tot INT,
    stato BIT(3) DEFAULT B'000', -- 00: idle, 01: in movimento, 10: in combattimento, 11: CONTROLLO
    attitudine BIT(3) DEFAULT B'000', -- 000: difensiva, 001: offensiva, 010: esplorativa, 011: evasiva, 100: supporto
    max_range_atck INT,
    dmg_tot INT,
    speed REAL,
    tipo_armata INT,
    are_they_in_the_same_position BOOLEAN DEFAULT TRUE,
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_armata_owner FOREIGN KEY (user_id, partita_id) REFERENCES partecipanti_partite(user_id, partita_id) ON DELETE CASCADE
);

-- ==========================================
-- INDEXES E PERMESSI
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_truppe_geo ON truppe(x, y);
CREATE INDEX IF NOT EXISTS idx_armata_geo ON armata(x, y);
CREATE INDEX IF NOT EXISTS idx_messaggi_partita ON messaggi(id_partita, time_stamp);
CREATE INDEX IF NOT EXISTS idx_risorse_jsonb ON partecipanti_partite USING GIN (stato_risorse);

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO PUBLIC;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;

-- Inserimento Utenti (Password fittizie)
INSERT INTO utenti (username, email, password_hash, reg, elo_rating, codice_amico) VALUES 
('ShadowGeneral', 'shadow@pwm.com', 'hash_123', 'EU-WEST', 1250, 'AMICO-0001'),
('IronFist_99', 'iron@pwm.com', 'hash_456', 'EU-EAST', 1100, 'AMICO-0002'),
('GhostTactician', 'ghost@pwm.com', 'hash_789', 'NA-NORTH', 950, 'AMICO-0003'),
('ViperStrike', 'viper@pwm.com', 'hash_000', 'ASIA-SOUTH', 1400, 'AMICO-0004');

-- Simulazione Accessi
INSERT INTO accessi (user_id, ip_address, cookie_token, expire_time)
SELECT id_user, '192.168.1.' || (rank() OVER (ORDER BY id_user)), 'token_' || username, NOW() + INTERVAL '7 days'
FROM utenti;

-- Creazione di una Partita
INSERT INTO partite (id_partita_visualizzato, nome_partita, id_host, tipo_partita, modalita, regioni_giocabili, stato)
VALUES (
    'GME-77', 
    'Assalto all Atollo', 
    (SELECT id_user FROM utenti WHERE username = 'ShadowGeneral'), 
    'Competitiva', 
    'Deathmatch', 
    'Pacific-Ocean', 
    'in_corso'
);

-- Creazione Alleanza nella partita appena creata
INSERT INTO alleanze (nome_alleanza, id_leader, id_partita, path_logo)
VALUES (
    'Lupi del Deserto', 
    (SELECT id_user FROM utenti WHERE username = 'ShadowGeneral'), 
    (SELECT id_partita FROM partite WHERE id_partita_visualizzato = 'GME-77'),
    '/logos/lupi_01.png'
);

-- Inserimento Partecipanti
INSERT INTO partecipanti_partite (user_id, partita_id, punteggio, id_alleanza, stato_risorse, stato_territori)
SELECT 
    id_user, 
    (SELECT id_partita FROM partite WHERE id_partita_visualizzato = 'GME-77'),
    1500,
    (SELECT id_alleanza FROM alleanze WHERE nome_alleanza = 'Lupi del Deserto'),
    '{"ferro": 500, "petrolio": 200, "oro": 50}',
    'sector_A1,sector_A2'
FROM utenti WHERE username IN ('ShadowGeneral', 'IronFist_99');

-- Aggiungiamo un nemico senza alleanza
INSERT INTO partecipanti_partite (user_id, partita_id, punteggio, stato_risorse)
VALUES (
    (SELECT id_user FROM utenti WHERE username = 'ViperStrike'),
    (SELECT id_partita FROM partite WHERE id_partita_visualizzato = 'GME-77'),
    2000,
    '{"ferro": 800, "petrolio": 400, "oro": 150}'
);

-- Creazione di un'Armata per ShadowGeneral
INSERT INTO armata (partita_id, user_id, id_modello, x, y, hp, dmg_tot, speed, tipo_armata)
VALUES (
    (SELECT id_partita FROM partite WHERE id_partita_visualizzato = 'GME-77'),
    (SELECT id_user FROM utenti WHERE username = 'ShadowGeneral'),
    'Tank_Tiger_V1',
    45.552, 12.331, -- Coordinate
    1000, 150, 5, 1
);

-- Messaggi e Chat
WITH msg AS (
    INSERT INTO messaggi (content) 
    VALUES ('Spostate i tank sul fianco est, Viper sta arrivando!') 
    RETURNING id_mex
)
INSERT INTO chat (id_user_send, id_partita, id_mex, id_user_reciver, tipo_chat)
VALUES (
    (SELECT id_user FROM utenti WHERE username = 'ShadowGeneral'),
    (SELECT id_partita FROM partite WHERE id_partita_visualizzato = 'GME-77'),
    (SELECT id_mex FROM msg),
    (SELECT id_user FROM utenti WHERE username = 'IronFist_99'),
    'alleanza'
);