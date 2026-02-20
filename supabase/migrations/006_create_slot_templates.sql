CREATE TABLE IF NOT EXISTS public.slot_templates (
  id serial PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'dev',
  name text NOT NULL,
  dow text[] NOT NULL DEFAULT '{mon,tue,wed,thu,fri,sat,sun}',
  from_time time NOT NULL,
  to_time time NOT NULL,
  is_active boolean DEFAULT true,
  meta jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Seed default slots (current hardcoded values)
INSERT INTO public.slot_templates (tenant_id, name, dow, from_time, to_time) VALUES
  ('dev', 'Утро', '{mon,tue,wed,thu,fri,sat,sun}', '10:00', '13:00'),
  ('dev', 'Вечер', '{mon,tue,wed,thu,fri,sat,sun}', '18:00', '21:00')
ON CONFLICT DO NOTHING;
