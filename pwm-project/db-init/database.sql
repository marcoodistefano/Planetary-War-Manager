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
    recupera_passwd_token_link VARCHAR(8) DEFAULT NULL,
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

--1.3 OBBIETTIVI
CREATE TABLE IF NOT EXISTS obbiettivi (
    id_obbiettivo UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome_obbiettivo VARCHAR(32) NOT NULL,
    descrizione TEXT,
    requisito TEXT, --es. {"conquista": 10, "distruzione": 5}
    ricompensa TEXT, --es. {"ferro": 100, "petrolio": 50, "oro": 10}
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

--1.4 OBBIETTIVI_UTENTE
CREATE TABLE IF NOT EXISTS obbiettivi_utente (
    id_obbiettivo_utente UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_user UUID NOT NULL,
    id_obbiettivo UUID NOT NULL,
    stato VARCHAR(20) DEFAULT 'incompleto', -- 'incompleto', 'completo', 'ricompensa_riscattata'
    progress REAL DEFAULT 0.00, --es. {"conquista": 3, "distruzione": 1}
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_obbiettivo FOREIGN KEY (id_user) REFERENCES utenti(id_user) ON DELETE CASCADE,
    CONSTRAINT fk_obbiettivo FOREIGN KEY (id_obbiettivo) REFERENCES obbiettivi(id_obbiettivo) ON DELETE CASCADE
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

-- 2.1 TOKEN RECUPERO PASSWORD
CREATE TABLE IF NOT EXISTS password_recovery_tokens (
    token VARCHAR(64) PRIMARY KEY,
    id_user UUID NOT NULL,
    expire_time TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_password_recovery_username FOREIGN KEY (id_user) REFERENCES utenti(id_user) ON DELETE CASCADE
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
    CONSTRAINT fk_host FOREIGN KEY (id_host) REFERENCES utenti(id_user)
);

/*
//SERVONO REALMENTE SOLO 40 BIT 
//NB PARTITE: il server può gestire i campi da duration_max a stato, in un’unica stringa, compressa e gestita sui bit e memorizzata in B64. 
// per esempio, se la stringa dovesse memorizzare in questo ordine(tra parentesi i bit occupati):
// stato_partita [2], N_player_max[9 bit -> 512 player], duration_max[5 bit -> 32 giorni (se memorizzato in giorni)], moltiplicatore[4 bit->sono massimo 16 combinazioni, 0000 è default (1x), poi 2x, 3x, 5x, 10x, 20x, 30x, 40x…], tipo_partita [4], modalità [4 bit? 16 modalità…oppure 5?], regioni_giocabili [16 bit]
// 
// ->Stato partita {00->in attesa; 01->in corso; 10->terminata; 11->eliminata (si intende che si eliminano le mosse e il documento (si fa dopo X giorni dalla fine della partita))
// ->N_player_max -> conteggio classico… 10, 20, 30, 50, 100, 250, 500 -> si potrebbero usare, allora, solo 3 bit… {000 001 010 011 100 101 110 111} dove il valore 111 è assunto SOLO per modalità 1v1 e 2v2 (NvN < 10 giocatori totali)
// ->duration_max -> default è 7, quindi 0111, max è 1111 che indica 32 giorni; 0000 è controllo, NON UTILIZZATO
// ->moltiplicatore -> {1x 0000; 2x 0001; 3x 0010; 4x 0011; 5x 0100; 10x 0101; 20x 0110; 30x 0111; 40x 1000; 50x 1001; 60x 1010; 100x 1011; 200x 1100; 500x 1101; 1000x 1110; [ILLIMITATA (produzione istantanea di tutto eccetto che delle risorse) oppure 5000x 1111}
// -> Is_squad -> 1 bit -> 0 o 1, per indicare se è una partita a squadre o free for all (tutti contro tutti)
// -> modalità [NO; NON SI CAMBIA SOLO 1 bit!]->SI CAMBIA SOLO UN BIT! {tempo 0000 (def.); distruzione 0001; conquista 0010; altro}
// -> regioni giocabili -> SI CAMBIA SOLO UN BIT! {0000000000000000} [DA MSB A LSB}
// MSB (bit 1^): tutto il mondobit 2: europabit 3: Asiabit 4: africa
// bit 5: oceaniabit 6: america NORDbit 7: america SUD
// DAL BIT 8 FINO AL 16 SONO ALTRE MODALITA, ALCUNI ESEMPI:
// bit 8: vecchio mondo (europa-medio oriente-nord africa)
// bit 9: medio orientebit 10: italia…
// Definito questo, procedo con un esempio: giocatore X ha appena creato una partita con le seguenti caratteristiche: 1v1, 7giorni, moltiplicatore x30, modalità conquista, solo italia. 
// il server avrà, allora, la seguente stringa di bit:
// 00|111|0111|0111|0000|0010|0000000001000000 */

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
    stato_strutture JSONB DEFAULT '{}'::jsonb,
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
    CONSTRAINT fk_spostamento_mossa FOREIGN KEY (id_mossa) REFERENCES mosse(id_mossa) ON DELETE CASCADE
);

--6.1 ATTACCHI
CREATE TABLE IF NOT EXISTS attacco (
    id_attacco UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_mossa UUID NOT NULL,
    id_target_truppa UUID default NULL,
    id_target_armata UUID default NULL,
    time_stamp TIMESTAMP default now(),
    CONSTRAINT fk_attacco_mossa FOREIGN KEY (id_mossa) REFERENCES mosse(id_mossa) ON DELETE CASCADE
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
CREATE TABLE IF NOT EXISTS messaggi (
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
    CONSTRAINT fk_truppa_owner FOREIGN KEY (user_id, partita_id) REFERENCES partecipanti_partite(user_id, partita_id) ON DELETE CASCADE
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
-- FOREIGN KEYS (Deferred - required order)
-- ==========================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_truppa_armata'
          AND conrelid = 'truppe'::regclass
    ) THEN
        ALTER TABLE truppe
            ADD CONSTRAINT fk_truppa_armata
            FOREIGN KEY (id_armata)
            REFERENCES armata(id_istanza_armata)
            ON DELETE SET NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_spostamento_truppa'
          AND conrelid = 'mosse'::regclass
    ) THEN
        ALTER TABLE mosse
            ADD CONSTRAINT fk_spostamento_truppa
            FOREIGN KEY (id_truppa)
            REFERENCES truppe(id_istanza_truppa)
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_spostamento_armata'
          AND conrelid = 'mosse'::regclass
    ) THEN
        ALTER TABLE mosse
            ADD CONSTRAINT fk_spostamento_armata
            FOREIGN KEY (id_armata)
            REFERENCES armata(id_istanza_armata)
            ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_attacco_truppa'
          AND conrelid = 'attacco'::regclass
    ) THEN
        ALTER TABLE attacco
            ADD CONSTRAINT fk_attacco_truppa
            FOREIGN KEY (id_target_truppa)
            REFERENCES truppe(id_istanza_truppa)
            ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_attacco_armata'
          AND conrelid = 'attacco'::regclass
    ) THEN
        ALTER TABLE attacco
            ADD CONSTRAINT fk_attacco_armata
            FOREIGN KEY (id_target_armata)
            REFERENCES armata(id_istanza_armata)
            ON DELETE SET NULL;
    END IF;
END $$;

-- ==========================================
-- INDEXES E PERMESSI
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_truppe_geo ON truppe(x, y);
CREATE INDEX IF NOT EXISTS idx_armata_geo ON armata(x, y);
CREATE INDEX IF NOT EXISTS idx_messaggi_partita ON messaggi(id_partita, time_stamp);
CREATE INDEX IF NOT EXISTS idx_risorse_jsonb ON partecipanti_partite USING GIN (stato_risorse);

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO PUBLIC;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;

/*
SEED DATA (disabilitato): il blocco di INSERT sotto era incoerente con lo schema
(colonne non più presenti / nomi diversi) e bloccava l'import della schema.
Se serve demo data, meglio creare un file seed separato e allineato allo schema.
*/