-- ==========================================
-- PWM TACTICAL - POSTGRESQL SCHEMA
-- ==========================================

-- Pulizia dello schema (Opzionale)
-- DROP SCHEMA public CASCADE;
-- CREATE SCHEMA public;

-- 1. UTENTI
CREATE TABLE utenti (
    id_user SERIAL PRIMARY KEY,
    username VARCHAR(32) NOT NULL UNIQUE,
    email VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(256) NOT NULL,
    reg VARCHAR(32),
    elo_rating INT DEFAULT 1000,
    avatar_id SMALLINT DEFAULT 1,
    last_username_change TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    recupera_passwd VARCHAR(255) NULL,
    two_fa_method VARCHAR(50), -- Rinominato da 2FA_method (Postgres preferisce non iniziare con numeri)
    two_fa_secret VARCHAR(255),
    two_fa_enabled BOOLEAN DEFAULT FALSE,
    is_banned BOOLEAN DEFAULT FALSE,
    is_perma_banned BOOLEAN DEFAULT FALSE
);

COMMENT ON COLUMN utenti.reg IS 'Regione di appartenenza, indica la macro area di connessione.';
COMMENT ON COLUMN utenti.elo_rating IS 'Per la leaderboard globale -> valore modificato per ogni partita svolta e conclusa';
COMMENT ON COLUMN utenti.avatar_id IS 'ID dell''avatar scelto, da 1 a 20';
COMMENT ON COLUMN utenti.recupera_passwd IS 'Token generato dinamicamente al recupero passwd, valido 10 min';

-- 2. ACCESSI
CREATE TABLE accessi (
    id_access SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    ip_address VARCHAR(45),
    login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cookie_token VARCHAR(255),
    CONSTRAINT fk_user_accessi FOREIGN KEY (user_id) REFERENCES utenti(id_user) ON DELETE CASCADE
);

-- 3. PARTITE
CREATE TABLE partite (
    id_partita SERIAL PRIMARY KEY,
    nome_partita VARCHAR(100) NOT NULL,
    has_elo BOOLEAN DEFAULT TRUE,
    id_host INT NOT NULL,
    configurazione_compressa VARCHAR(64) NOT NULL,
    duration_max INT DEFAULT 10080, -- 7 giorni in minuti
    num_player_max INT,
    tipo_partita VARCHAR(50),
    modalita VARCHAR(50),
    moltiplicatore VARCHAR(10),
    regioni_giocabili VARCHAR(16),
    stato VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    nome_json VARCHAR(255),
    CONSTRAINT fk_host FOREIGN KEY (id_host) REFERENCES utenti(id_user)
);

COMMENT ON COLUMN partite.configurazione_compressa IS 'Stato[2]|MaxPly[3]|Durata[4]|Molt[4]|Tipo[4]|Mod[4]|Regioni[16]';

-- 4. BAN
CREATE TABLE ban (
    id_ban SERIAL PRIMARY KEY,
    id_user INT NOT NULL,
    time_stamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    time_until TIMESTAMP NOT NULL,
    motivo VARCHAR(20) NOT NULL,
    CONSTRAINT fk_user_ban FOREIGN KEY (id_user) REFERENCES utenti(id_user) ON DELETE CASCADE
);

-- 5. ALLEANZE
CREATE TABLE alleanze (
    id_alleanza SERIAL PRIMARY KEY,
    nome_alleanza VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    path_logo VARCHAR(255) DEFAULT 'default_logo.png',
    id_leader INT NOT NULL,
    id_partita INT NOT NULL,
    CONSTRAINT fk_leader FOREIGN KEY (id_leader) REFERENCES utenti(id_user),
    CONSTRAINT fk_partita_alleanza FOREIGN KEY (id_partita) REFERENCES partite(id_partita) ON DELETE CASCADE
);

-- 6. PARTECIPANTI_PARTITE
CREATE TABLE partecipanti_partite (
    user_id INT NOT NULL,
    partita_id INT NOT NULL,
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
    id_alleanza INT NULL,
    stato_struttura TEXT,
    stato_risorse TEXT,
    stato_territori TEXT,
    stato_truppe TEXT,
    PRIMARY KEY (user_id, partita_id),
    CONSTRAINT fk_user_partecipante FOREIGN KEY (user_id) REFERENCES utenti(id_user) ON DELETE CASCADE,
    CONSTRAINT fk_partita_partecipante FOREIGN KEY (partita_id) REFERENCES partite(id_partita) ON DELETE CASCADE,
    CONSTRAINT fk_alleanza_partecipante FOREIGN KEY (id_alleanza) REFERENCES alleanze(id_alleanza) ON DELETE SET NULL
);

COMMENT ON COLUMN partecipanti_partite.stato_risorse IS 'Snapshot asincrono sincronizzato da Redis a DB ogni 15-30 min';

-- 7. MOSSE
CREATE TABLE mosse (
    id_mossa SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    partita_id INT NOT NULL,
    type_action VARCHAR(50) NOT NULL,
    queue_order INT NOT NULL,
    ttl INT DEFAULT 0,
    priorita VARCHAR(2) DEFAULT '00',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_partecipante_mossa FOREIGN KEY (user_id, partita_id) REFERENCES partecipanti_partite(user_id, partita_id) ON DELETE CASCADE
);

-- 8. MESSAGGI
CREATE TABLE messaggi (
    id_mex BIGINT PRIMARY KEY, -- Rimosso SERIAL per gestire il numero random a 64 bit come richiesto
    time_stamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    content VARCHAR(200) NOT NULL
);

-- 9. CHAT
CREATE TABLE chat (
    id_user_send INT NOT NULL,
    id_partita INT NOT NULL,
    id_mex BIGINT NOT NULL,
    id_user_reciver INT NULL,
    tipo_chat BIT(2),
    PRIMARY KEY (id_user_send, id_partita, id_mex),
    CONSTRAINT fk_send_chat FOREIGN KEY (id_user_send, id_partita) REFERENCES partecipanti_partite(user_id, partita_id) ON DELETE CASCADE,
    CONSTRAINT fk_reciver_chat FOREIGN KEY (id_user_reciver, id_partita) REFERENCES partecipanti_partite(user_id, partita_id) ON DELETE CASCADE,
    CONSTRAINT fk_mex_chat FOREIGN KEY (id_mex) REFERENCES messaggi(id_mex) ON DELETE CASCADE
);

-- 10. TRUPPE
CREATE TABLE truppe (
    id_istanza_truppa VARCHAR(36) PRIMARY KEY,
    partita_id INT NOT NULL,
    user_id INT NOT NULL,
    id_modello VARCHAR(64) NOT NULL,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    alt REAL DEFAULT 0,
    rot REAL DEFAULT 0,
    hp INT NOT NULL,
    stato SMALLINT DEFAULT 1,
    attitudine INT DEFAULT 1,
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_partita_truppa FOREIGN KEY (partita_id) REFERENCES partite(id_partita) ON DELETE CASCADE,
    CONSTRAINT fk_user_truppa FOREIGN KEY (user_id) REFERENCES utenti(id_user) ON DELETE CASCADE
);

CREATE INDEX idx_player_units_truppe ON truppe(partita_id, user_id);
CREATE INDEX idx_geo_static_truppe ON truppe(x, y);

-- 11. ARMATA
CREATE TABLE armata (
    id_istanza_armata VARCHAR(36) PRIMARY KEY,
    partita_id INT NOT NULL,
    user_id INT NOT NULL,
    id_modello VARCHAR(64) NOT NULL,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    alt REAL DEFAULT 0,
    rot REAL DEFAULT 0,
    hp INT NOT NULL,
    stato SMALLINT DEFAULT 1,
    attitudine INT DEFAULT 1,
    max_range_atck INT,
    dmg_tot INT,
    speed INT,
    tipo_armata INT,
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_partita_armata FOREIGN KEY (partita_id) REFERENCES partite(id_partita) ON DELETE CASCADE,
    CONSTRAINT fk_user_armata FOREIGN KEY (user_id) REFERENCES utenti(id_user) ON DELETE CASCADE
);

CREATE INDEX idx_player_units_armata ON armata(partita_id, user_id);
CREATE INDEX idx_geo_static_armata ON armata(x, y);

-- ==========================================
-- DATI DI TEST (DML)
-- ==========================================

INSERT INTO utenti (username, email, password_hash, reg, elo_rating, two_fa_enabled) VALUES
('Generale_Inverno', 'gen@mail.com', 'hash_sha256_dummy_1', 'Europa', 1450, TRUE),
('DesertFox', 'fox@mail.com', 'hash_sha256_dummy_2', 'Africa', 1320, FALSE),
('PacificFleet', 'pac@mail.com', 'hash_sha256_dummy_3', 'Asia', 1580, TRUE),
('NoobMaster', 'noob@mail.com', 'hash_sha256_dummy_4', 'Nord America', 900, FALSE);

UPDATE utenti SET is_banned = TRUE WHERE username = 'NoobMaster';

INSERT INTO ban (id_user, time_until, motivo) VALUES
(4, NOW() + INTERVAL '30 days', 'Uso di Bot/Macro');

INSERT INTO partite (nome_partita, id_host, configurazione_compressa, nome_json) VALUES
('Operazione Valchiria', 1, '01|100|0111|0111|0100|0001|1000000000000000', 'hash_map_valchiria_8f9a2'),
('Duello nel Mediterraneo', 2, '00|111|0111|1010|0000|0010|0000000000000010', 'hash_map_mediterraneo_3b1c');

INSERT INTO alleanze (nome_alleanza, path_logo, id_leader, id_partita) VALUES
('Patto d Acciaio', 'logo_acciaio.png', 1, 1);

INSERT INTO partecipanti_partite (user_id, partita_id, punteggio, territori_conquistati, id_alleanza, stato_struttura, stato_risorse, stato_territori) VALUES
(1, 1, 5400, 12, 1, 'eyJDYXNlcm1hIjoyLCAiUG9ydG8iOjF9', '{"legno":1500, "piombo":200, "uranio":0}', '111100000000'),
(2, 1, 4100, 8, 1, 'eyJGYWJicmljYSI6MSwgIkFlcm9wb3J0byI6Mn0=', '{"legno":800, "petrolio":1200, "uranio":0}', '000011110000'),
(3, 1, 7200, 15, NULL, 'eyJQb3J0byI6MywgIkhhbmdhciI6Mn0=', '{"legno":5000, "petrolio":5000, "uranio":10}', '000000001111');

INSERT INTO messaggi (id_mex, content) VALUES
(714123891237, 'Flotta nemica avvistata nel settore G4!'),
(714123891238, 'Ricevuto, invio bombardieri per supporto.');

INSERT INTO chat (id_user_send, id_partita, id_mex, id_user_reciver, tipo_chat) VALUES
(1, 1, 714123891237, 2, B'01'),
(2, 1, 714123891238, 1, B'01');