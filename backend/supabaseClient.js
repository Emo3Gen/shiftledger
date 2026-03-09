import { createClient } from "@supabase/supabase-js";
import "./env.js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    "[supabase] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment (backend/.env.dev or backend/.env.prod)",
  );
}

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

