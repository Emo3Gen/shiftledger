import { createClient } from "@supabase/supabase-js";

// Railway injects env vars into process.env before the process starts.
// No eager check needed — if vars are missing, Supabase will fail on first request.
export const supabase = createClient(
  process.env.SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  { auth: { persistSession: false } },
);
