-- SL-040: Add superseded_at column to facts table
-- When a user sends a new availability message, old facts for the same week are soft-deleted
ALTER TABLE facts ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_facts_superseded ON facts(superseded_at) WHERE superseded_at IS NULL;
