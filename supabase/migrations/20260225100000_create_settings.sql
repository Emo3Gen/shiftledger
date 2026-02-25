-- Migration 007: Create tenant_settings table
-- Key-value configuration per tenant with JSONB values

CREATE TABLE IF NOT EXISTS tenant_settings (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'dev',
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT 'null'::jsonb,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_settings_tenant ON tenant_settings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_settings_key ON tenant_settings(key);

-- Default settings for dev tenant
INSERT INTO tenant_settings (tenant_id, key, value, description) VALUES
  -- Shift times
  ('dev', 'shifts.morning.from', '"10:00"', 'Morning shift start time'),
  ('dev', 'shifts.morning.to', '"13:00"', 'Morning shift end time'),
  ('dev', 'shifts.morning.name', '"Утро"', 'Morning shift display name'),
  ('dev', 'shifts.evening.from', '"18:00"', 'Evening shift start time'),
  ('dev', 'shifts.evening.to', '"21:00"', 'Evening shift end time'),
  ('dev', 'shifts.evening.name', '"Вечер"', 'Evening shift display name'),
  -- Pay rates
  ('dev', 'pay.default_rate', '280', 'Default hourly rate (₽)'),
  ('dev', 'pay.cleaning_rate', '500', 'Cleaning pay per session (₽)'),
  ('dev', 'pay.extra_class_base', '500', 'Extra class base rate (₽)'),
  ('dev', 'pay.extra_class_threshold', '8', 'Kids count threshold for extra pay'),
  ('dev', 'pay.extra_class_per_kid', '100', 'Extra pay per kid above threshold (₽)'),
  ('dev', 'pay.problem_deduction_hours', '1', 'Hours deducted per problem shift'),
  ('dev', 'pay.rounding_step', '100', 'Round total pay up to nearest N (₽)'),
  -- Schedule params
  ('dev', 'schedule.days', '["mon","tue","wed","thu","fri","sat","sun"]', 'Active schedule days'),
  ('dev', 'schedule.min_candidates_per_slot', '1', 'Min candidates before flagging gap'),
  ('dev', 'schedule.auto_assign_cleaning', 'true', 'Auto-assign cleaning to evening shift user'),
  ('dev', 'schedule.senior_reserve_enabled', 'true', 'Use senior employees as last resort'),
  ('dev', 'schedule.week_hours_template', '{"mon":{"morning":5,"evening":6},"tue":{"morning":5,"evening":6},"wed":{"morning":4.5,"evening":6},"thu":{"morning":5,"evening":5.5},"fri":{"morning":5.5,"evening":6.5},"sat":{"morning":6,"evening":6.5},"sun":{"morning":5,"evening":6}}', 'Hours per day×slot for timesheet')
ON CONFLICT (tenant_id, key) DO NOTHING;
