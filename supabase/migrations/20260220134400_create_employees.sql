CREATE TABLE IF NOT EXISTS public.employees (
  id text PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'staff',
  rate_per_hour numeric NOT NULL DEFAULT 0,
  min_hours_per_week numeric DEFAULT 0,
  max_hours_per_week numeric DEFAULT 40,
  is_active boolean DEFAULT true,
  meta jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Seed current employees from userDirectory.js
INSERT INTO public.employees (id, name, role, rate_per_hour, min_hours_per_week) VALUES
  ('u1', 'Иса', 'junior', 280, 22),
  ('u2', 'Дарина', 'junior', 280, 20),
  ('u3', 'Ксюша', 'junior', 280, 0),
  ('u4', 'Карина', 'senior', 280, 0)
ON CONFLICT (id) DO NOTHING;
