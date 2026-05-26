-- Migration: add max_membri to alleanze (default 4)
ALTER TABLE alleanze
  ADD COLUMN IF NOT EXISTS max_membri integer NOT NULL DEFAULT 4;

-- Optional: populate existing rows explicitly (redundant due to DEFAULT)
UPDATE alleanze SET max_membri = 4 WHERE max_membri IS NULL;
