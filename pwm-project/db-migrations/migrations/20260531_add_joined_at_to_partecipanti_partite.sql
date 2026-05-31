-- Migration: add joined_at to partecipanti_partite
-- Adds a timestamp for join ordering; idempotent check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'partecipanti_partite' AND column_name = 'joined_at'
  ) THEN
    ALTER TABLE partecipanti_partite ADD COLUMN joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  END IF;
END;
$$;
