-- Enable Row Level Security on all public tables
-- Fixes 5 Supabase Security Advisor warnings (RLS Disabled)

-- ── Enable RLS ──────────────────────────────────────────────────────────────

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;

-- ── Service role policy (full access for backend) ───────────────────────────
-- Backend uses service_role key → unrestricted access.
-- anon/authenticated users get NO access by default (deny-all).

CREATE POLICY "service_role_all" ON public.events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all" ON public.facts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all" ON public.slot_templates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all" ON public.employees
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all" ON public.tenant_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
