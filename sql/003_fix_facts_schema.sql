-- Fix facts schema to match server.js expectations
-- server.js writes trace_id, chat_id, user_id, status, parser_version, fact_hash
-- but 002_create_facts.sql only has event_id, fact_type, fact_payload, confidence, created_at

ALTER TABLE public.facts ADD COLUMN IF NOT EXISTS trace_id text;
ALTER TABLE public.facts ADD COLUMN IF NOT EXISTS chat_id text;
ALTER TABLE public.facts ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE public.facts ADD COLUMN IF NOT EXISTS status text DEFAULT 'parsed';
ALTER TABLE public.facts ADD COLUMN IF NOT EXISTS parser_version text DEFAULT 'v0';
ALTER TABLE public.facts ADD COLUMN IF NOT EXISTS fact_hash text;
ALTER TABLE public.facts ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Unique constraint on fact_hash (required for upsert onConflict: "fact_hash")
CREATE UNIQUE INDEX IF NOT EXISTS facts_fact_hash_unique ON public.facts(fact_hash);

-- Performance indexes for common queries
CREATE INDEX IF NOT EXISTS facts_chat_id_idx ON public.facts(chat_id);
CREATE INDEX IF NOT EXISTS facts_user_id_idx ON public.facts(user_id);
CREATE INDEX IF NOT EXISTS facts_event_id_idx ON public.facts(event_id);
CREATE INDEX IF NOT EXISTS facts_status_idx ON public.facts(status);
