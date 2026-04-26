-- ==========================================
-- CREAZIONE DATABASE E TABELLE (DDL)
-- ==========================================

DROP DATABASE IF EXISTS pwm_tactical;
CREATE DATABASE pwm_tactical;
USE pwm_tactical;

-- 1. UTENTI
CREATE TABLE utenti (
    id_user INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(32) NOT NULL UNIQUE,
    email VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(256) NOT NULL,
    reg VARCHAR(32) COMMENT 'Regione macro-area (es. Europa, Asia)',
    elo_rating INT DEFAULT 1000 COMMENT 'Punteggio per leaderboard',
    avatar_id TINYINT DEFAULT 1 COMMENT 'ID dell avatar scelto (da 1 a 20)',
    last_username_change TIMESTAMP NULL DEFAULT NULL COMMENT 'Data dell ultimo cambio username',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    recupera_passwd VARCHAR(255) NULL COMMENT 'Token temporaneo',
    2FA_enabled BOOLEAN DEFAULT FALSE,
    IS_banned BOOLEAN DEFAULT FALSE,
    IS_perma_banned BOOLEAN DEFAULT FALSE
);

-- 2. ACCESSI
CREATE TABLE accessi (
    id_access INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    ip_address VARCHAR(45) COMMENT 'IP per log, NAT aware',
    login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cookie_token VARCHAR(255) COMMENT 'Token di sessione',
    FOREIGN KEY (user_id) REFERENCES utenti(id_user) ON DELETE CASCADE
);

-- 3. BAN
CREATE TABLE ban (
    id_ban INT AUTO_INCREMENT PRIMARY KEY,
    id_user INT NOT NULL,
    Time_stamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    Time_until TIMESTAMP NOT NULL,
    motivo VARCHAR(20) NOT NULL,
    FOREIGN KEY (id_user) REFERENCES utenti(id_user) ON DELETE CASCADE
);

-- 4. PARTITE
CREATE TABLE partite (
    id_partita INT AUTO_INCREMENT PRIMARY KEY,
    nome_partita VARCHAR(100) NOT NULL,
    id_host INT NOT NULL,
    configurazione_compressa VARCHAR(64) NOT NULL COMMENT 'Stato[2]|MaxPly[3]|Durata[4]|Molt[4]|Tipo[4]|Mod[4]|Regioni[16]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    nome_json VARCHAR(255) COMMENT 'Hash identificativo per JSON mappa',
    FOREIGN KEY (id_host) REFERENCES utenti(id_user)
);

-- 5. ALLEANZE
CREATE TABLE alleanze (
    id_alleanza INT AUTO_INCREMENT PRIMARY KEY,
    nome_alleanza VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    path_logo VARCHAR(255) DEFAULT 'default_logo.png',
    id_leader INT NOT NULL,
    id_partita INT NOT NULL,
    FOREIGN KEY (id_leader) REFERENCES utenti(id_user),
    FOREIGN KEY (id_partita) REFERENCES partite(id_partita) ON DELETE CASCADE
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
    perc_distruzione FLOAT DEFAULT 0.0,
    id_alleanza INT NULL,
    stato_struttura TEXT COMMENT 'Base64 delle strutture',
    stato_risorse TEXT COMMENT 'JSON o Base64 risorse attuali',
    stato_territori TEXT COMMENT 'Bit array territori posseduti',
    stato_truppe TEXT COMMENT 'Stato armate attive',
    PRIMARY KEY (user_id, partita_id),
    FOREIGN KEY (user_id) REFERENCES utenti(id_user) ON DELETE CASCADE,
    FOREIGN KEY (partita_id) REFERENCES partite(id_partita) ON DELETE CASCADE,
    FOREIGN KEY (id_alleanza) REFERENCES alleanze(id_alleanza) ON DELETE SET NULL
);

-- 7. MOSSE
CREATE TABLE mosse (
    id_mossa INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    partita_id INT NOT NULL,
    queue_order INT NOT NULL COMMENT 'Ordine di esecuzione nella coda',
    type_action VARCHAR(50) NOT NULL,
    TTL INT DEFAULT 0 COMMENT '0 se immediata',
    priorita VARCHAR(2) DEFAULT '00' COMMENT 'Bit di priorità',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id, partita_id) REFERENCES partecipanti_partite(user_id, partita_id) ON DELETE CASCADE
);

-- 8. MESSAGGI
CREATE TABLE messaggi (
    id_mex BIGINT AUTO_INCREMENT PRIMARY KEY,
    Time_stamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    content VARCHAR(200) NOT NULL
);

-- 9. CHAT
CREATE TABLE chat (
    id_user_send INT NOT NULL,
    id_partita INT NOT NULL,
    id_mex BIGINT NOT NULL,
    id_user_reciver INT NULL COMMENT 'NULL se broadcast',
    tipo_chat VARCHAR(10) COMMENT 'unicast, multicast, broadcast',
    PRIMARY KEY (id_user_send, id_partita, id_mex),
    FOREIGN KEY (id_user_send, id_partita) REFERENCES partecipanti_partite(user_id, partita_id) ON DELETE CASCADE,
    FOREIGN KEY (id_user_reciver, id_partita) REFERENCES partecipanti_partite(user_id, partita_id) ON DELETE CASCADE,
    FOREIGN KEY (id_mex) REFERENCES messaggi(id_mex) ON DELETE CASCADE
);

-- 10. Tabella Truppe Ottimizzata (Sostituisce il campo TEXT in partecipanti_partite)
CREATE TABLE IF NOT EXISTS truppe (
    id_istanza_truppa VARCHAR(36) PRIMARY KEY COMMENT 'UUID univoco per listanza della truppa nella partita',
    partita_id INT NOT NULL,
    user_id INT NOT NULL,
    id_truppa VARCHAR(64) NOT NULL COMMENT 'Riferimento al modello della truppa in game_rules.cdb (es. fanteria_t1)',
    x DOUBLE NOT NULL, -- Longitudine attuale o Target
    y DOUBLE NOT NULL, -- Latitudine attuale o Target
    alt FLOAT DEFAULT 0,
    rot FLOAT DEFAULT 0,
    hp INT NOT NULL COMMENT 'HP attuali, il max dipendera dal modello su game_rules.cdb',
    stato TINYINT DEFAULT 1 COMMENT '1: Idle, 2: In movimento, 3: In combattimento',
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    attitudine TINYINT DEFAULT 1 COMMENT '1: Aggressiva, 2: Difensiva, 3: Evasiva';
    INDEX idx_partita_user (partita_id, user_id),
    FOREIGN KEY (partita_id) REFERENCES partite(id_partita) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES utenti(id_user) ON DELETE CASCADE
);

-- ==========================================
-- POPOLAMENTO DATI DI TEST (DML)
-- ==========================================

-- INSERIMENTO UTENTI
INSERT INTO utenti (username, email, password_hash, reg, elo_rating, 2FA_enabled, IS_banned) VALUES
('Generale_Inverno', 'gen@mail.com', 'hash_sha256_dummy_1', 'Europa', 1450, TRUE, FALSE),
('DesertFox', 'fox@mail.com', 'hash_sha256_dummy_2', 'Africa', 1320, FALSE, FALSE),
('PacificFleet', 'pac@mail.com', 'hash_sha256_dummy_3', 'Asia', 1580, TRUE, FALSE),
('NoobMaster', 'noob@mail.com', 'hash_sha256_dummy_4', 'Nord America', 900, FALSE, TRUE);

-- INSERIMENTO ACCESSI
INSERT INTO accessi (user_id, ip_address, cookie_token) VALUES
(1, '192.168.1.100', 'cookie_token_gen_123'),
(2, '10.0.0.5', 'cookie_token_fox_456'),
(3, '172.16.0.8', 'cookie_token_pac_789');

-- INSERIMENTO BAN
INSERT INTO ban (id_user, Time_until, motivo) VALUES
(4, DATE_ADD(NOW(), INTERVAL 30 DAY), 'Uso di Bot/Macro');

-- INSERIMENTO PARTITE
INSERT INTO partite (nome_partita, id_host, configurazione_compressa, nome_json) VALUES
('Operazione Valchiria', 1, '01|100|0111|0111|0100|0001|1000000000000000', 'hash_map_valchiria_8f9a2'),
('Duello nel Mediterraneo', 2, '00|111|0111|1010|0000|0010|0000000000000010', 'hash_map_mediterraneo_3b1c');

-- INSERIMENTO ALLEANZE
INSERT INTO alleanze (nome_alleanza, path_logo, id_leader, id_partita) VALUES
('Patto d Acciaio', 'logo_acciaio.png', 1, 1);

-- INSERIMENTO PARTECIPANTI
INSERT INTO partecipanti_partite (user_id, partita_id, punteggio, territori_conquistati, id_alleanza, stato_struttura, stato_risorse, stato_territori) VALUES
(1, 1, 5400, 12, 1, 'eyJDYXNlcm1hIjoyLCAiUG9ydG8iOjF9', '{"legno":1500, "piombo":200, "uranio":0}', '111100000000'),
(2, 1, 4100, 8, 1, 'eyJGYWJicmljYSI6MSwgIkFlcm9wb3J0byI6Mn0=', '{"legno":800, "petrolio":1200, "uranio":0}', '000011110000'),
(3, 1, 7200, 15, NULL, 'eyJQb3J0byI6MywgIkhhbmdhciI6Mn0=', '{"legno":5000, "petrolio":5000, "uranio":10}', '000000001111'),
(2, 2, 0, 0, NULL, NULL, NULL, NULL);

-- INSERIMENTO MOSSE
INSERT INTO mosse (user_id, partita_id, queue_order, type_action, TTL, priorita) VALUES
(1, 1, 1, 'costruisci_porto_t2', 3600, '00'),
(1, 1, 2, 'sposta_armata_nord', 0, '11'),
(3, 1, 1, 'lancio_missile_crociera', 0, '11');

-- INSERIMENTO MESSAGGI
INSERT INTO messaggi (content) VALUES
('Flotta nemica avvistata nel settore G4!'),
('Ricevuto, invio bombardieri per supporto.');

-- INSERIMENTO CHAT
INSERT INTO chat (id_user_send, id_partita, id_mex, id_user_reciver, tipo_chat) VALUES
(1, 1, 1, 2, 'unicast'),
(2, 1, 2, 1, 'unicast');

