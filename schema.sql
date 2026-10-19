-- Import this into the MySQL database created for ThoughtSpace.
-- All user text is stored as data; API queries use PDO parameters.

CREATE TABLE IF NOT EXISTS thoughtspace_notes (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(90) NOT NULL DEFAULT '',
  recipient VARCHAR(80) NOT NULL DEFAULT '',
  content VARCHAR(500) NOT NULL,
  category VARCHAR(32) NOT NULL DEFAULT '',
  anonymous TINYINT(1) NOT NULL DEFAULT 0,
  author VARCHAR(40) NOT NULL DEFAULT '',
  created_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY idx_thoughtspace_notes_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS thoughtspace_likes (
  note_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  client_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (note_id, client_id),
  CONSTRAINT fk_thoughtspace_likes_note FOREIGN KEY (note_id)
    REFERENCES thoughtspace_notes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS thoughtspace_replies (
  id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  note_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content VARCHAR(500) NOT NULL,
  author VARCHAR(40) NOT NULL DEFAULT '',
  anonymous TINYINT(1) NOT NULL DEFAULT 0,
  created_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (note_id, id),
  KEY idx_thoughtspace_replies_note_created (note_id, created_at),
  CONSTRAINT fk_thoughtspace_replies_note FOREIGN KEY (note_id)
    REFERENCES thoughtspace_notes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS thoughtspace_wall_state (
  id TINYINT UNSIGNED NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO thoughtspace_wall_state (id, revision) VALUES (1, 0)
  ON DUPLICATE KEY UPDATE id = VALUES(id);
