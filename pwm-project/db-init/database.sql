-- ==========================================
-- PWM TACTICAL - POSTGRESQL SCHEMA (UPDATED)
-- ==========================================

-- Estensione per la generazione di UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. UTENTI
CREATE TABLE IF NOT EXISTS utenti (
    id_user UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(32) NOT NULL UNIQUE,
    email VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(256) NOT NULL,
    reg VARCHAR(32),
    elo_rating INT DEFAULT 1000,
    avatar_id SMALLINT DEFAULT 1,
    last_username_change TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    recupera_passwd VARCHAR(255) NULL,
    two_fa_method VARCHAR(50), 
    two_fa_secret VARCHAR(255),
    two_fa_enabled BOOLEAN DEFAULT FALSE,
    is_banned BOOLEAN DEFAULT FALSE,
    is_perma_banned BOOLEAN DEFAULT FALSE,
    codice_amico VARCHAR(10) UNIQUE
);

COMMENT ON COLUMN utenti.reg IS 'Regione di appartenenza macro area';
COMMENT ON COLUMN utenti.codice_amico IS 'Codice univoco AMICO-XXXX basato su ID utente';

-- 1.1 AMICI
CREATE TABLE IF NOT EXISTS amici (
    id_user UUID NOT NULL,
    id_amico UUID NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP NULL,
    status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, rejected, blocked
    link VARCHAR(10),
    link_duration INT,
    PRIMARY KEY (id_user, id_amico),
    CONSTRAINT fk_user_amici FOREIGN KEY (id_user) REFERENCES utenti(id_user) ON DELETE CASCADE,
    CONSTRAINT fk_target_amici FOREIGN KEY (id_amico) REFERENCES utenti(id_user) ON DELETE CASCADE
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
    duration_max INT DEFAULT 10080,
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

COMMENT ON TABLE partite IS 'Configurazione compressa: Stato[2]|MaxPly[3]|Durata[4]|Molt[4]|Tipo[4]|Mod[4]|Regioni[16]';

-- 4. PARTECIPANTI_PARTITE
CREATE TABLE IF NOT EXISTS partecipanti_partite (
    user_id UUID NOT NULL,
    partita_id UUID NOT NULL,
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
    utenti_alleati TEXT, -- Matrice B64
    utenti_in_guerra TEXT, -- Matrice B64
    stato_risorse TEXT,
    stato_territori TEXT,
    PRIMARY KEY (user_id, partita_id),
    CONSTRAINT fk_user_partecipante FOREIGN KEY (user_id) REFERENCES utenti(id_user) ON DELETE CASCADE,
    CONSTRAINT fk_partita_partecipante FOREIGN KEY (partita_id) REFERENCES partite(id_partita) ON DELETE CASCADE
);

-- 5. STRUTTURE_PARTECIPANTI
CREATE TABLE IF NOT EXISTS strutture_partecipanti_partite (
    id_riga UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_struttura INT NOT NULL,
    hp INT NOT NULL,
    id_utente UUID NOT NULL,
    id_partita UUID NOT NULL,
    pos_x DOUBLE PRECISION,
    pos_y DOUBLE PRECISION,
    CONSTRAINT fk_struttura_owner FOREIGN KEY (id_utente, id_partita) REFERENCES partecipanti_partite(user_id, partita_id) ON DELETE CASCADE
);

-- 6. MOSSE E SPOSTAMENTI
CREATE TABLE IF NOT EXISTS mosse (
    id_mossa UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    partita_id UUID NOT NULL,
    type_action VARCHAR(50),
    queue_order INT,
    ttl INT DEFAULT 0,
    priorita VARCHAR(2) DEFAULT '00', -- Bit 11 per non eliminabili
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_mossa_owner FOREIGN KEY (user_id, partita_id) REFERENCES partecipanti_partite(user_id, partita_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS spostamenti (
    id_spostamento UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_mossa UUID,
    numero_coda INT,
    x_dest DOUBLE PRECISION,
    y_dest DOUBLE PRECISION,
    time_to_arrive TIMESTAMP,
    CONSTRAINT fk_spostamento_mossa FOREIGN KEY (id_mossa) REFERENCES mosse(id_mossa) ON DELETE CASCADE
);

-- 7. ALLEANZE
CREATE TABLE IF NOT EXISTS alleanze (
    id_alleanza UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome_alleanza VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    path_logo VARCHAR(255),
    id_leader UUID NOT NULL,
    id_partita UUID NOT NULL,
    CONSTRAINT fk_leader FOREIGN KEY (id_leader) REFERENCES utenti(id_user),
    CONSTRAINT fk_partita_alleanza FOREIGN KEY (id_partita) REFERENCES partite(id_partita) ON DELETE CASCADE
);

ALTER TABLE partecipanti_partite ADD CONSTRAINT fk_alleanza FOREIGN KEY (id_alleanza) REFERENCES alleanze(id_alleanza) ON DELETE SET NULL;

-- 8. MESSAGGI
CREATE TABLE IF NOT EXISTS messaggi (
    id_mex UUID PRIMARY KEY DEFAULT uuid_generate_v4(), -- Corretto in UUID
    time_stamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    content VARCHAR(200) NOT NULL
);

-- 9. CHAT
CREATE TABLE IF NOT EXISTS chat (
    id_user_send UUID NOT NULL,
    id_partita UUID NOT NULL,
    id_mex UUID NOT NULL, -- Corretto in UUID per match con messaggi
    id_user_reciver UUID NULL,
    tipo_chat VARCHAR(20), 
    PRIMARY KEY (id_user_send, id_partita, id_mex),
    CONSTRAINT fk_chat_mex FOREIGN KEY (id_mex) REFERENCES messaggi(id_mex) ON DELETE CASCADE,
    CONSTRAINT fk_chat_sender FOREIGN KEY (id_user_send, id_partita) REFERENCES partecipanti_partite(user_id, partita_id) ON DELETE CASCADE
);

-- 10. ARMATA E TRUPPE
CREATE TABLE IF NOT EXISTS armata (
    id_istanza_armata UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partita_id UUID NOT NULL,
    user_id UUID NOT NULL,
    id_modello VARCHAR(64),
    x DOUBLE PRECISION,
    y DOUBLE PRECISION,
    alt REAL DEFAULT 0,
    rot REAL DEFAULT 0,
    hp INT,
    stato INT DEFAULT 1,
    attitudine INT DEFAULT 1,
    max_range_atck INT,
    dmg_tot INT,
    speed INT,
    tipo_armata INT,
    are_they_in_the_same_position BOOLEAN DEFAULT TRUE,
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_armata_owner FOREIGN KEY (user_id, partita_id) REFERENCES partecipanti_partite(user_id, partita_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS truppe (
    id_istanza_truppa UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partita_id UUID NOT NULL,
    user_id UUID NOT NULL,
    id_modello VARCHAR(64),
    id_armata UUID,
    x DOUBLE PRECISION,
    y DOUBLE PRECISION,
    alt REAL DEFAULT 0,
    rot REAL DEFAULT 0,
    hp INT,
    stato INT DEFAULT 1,
    attitudine INT DEFAULT 1,
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_truppa_owner FOREIGN KEY (user_id, partita_id) REFERENCES partecipanti_partite(user_id, partita_id) ON DELETE CASCADE,
    CONSTRAINT fk_truppa_armata FOREIGN KEY (id_armata) REFERENCES armata(id_istanza_armata) ON DELETE SET NULL
);

-- 10. BAN
CREATE TABLE IF NOT EXISTS ban (
    id_ban UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_user UUID NOT NULL,
    time_stamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    time_until TIMESTAMP NOT NULL,
    motivo VARCHAR(20) NOT NULL,
    CONSTRAINT fk_user_ban FOREIGN KEY (id_user) REFERENCES utenti(id_user) ON DELETE CASCADE
);

-- ==========================================
-- INDEXES E PERMESSI
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_truppe_geo ON truppe(x, y);
CREATE INDEX IF NOT EXISTS idx_armata_geo ON armata(x, y);

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