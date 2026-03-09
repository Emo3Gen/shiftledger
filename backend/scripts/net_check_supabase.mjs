#!/usr/bin/env node
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolve backend/.env.<env>
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename); // .../backend/scripts
const backendDir = path.resolve(__dirname, ".."); // .../backend
const envName = process.env.APP_ENV || "dev";
dotenv.config({ path: path.join(backendDir, `.env.${envName}`) });

const supabaseUrl = process.env.SUPABASE_URL;

if (!supabaseUrl) {
  console.error(JSON.stringify({ ok: false, host: null, error: "SUPABASE_URL not set" }));
  process.exit(2);
}

// Extract host from URL (e.g., https://xxx.supabase.co -> xxx.supabase.co)
let host;
try {
  const url = new URL(supabaseUrl);
  host = url.hostname;
} catch (err) {
  console.error(JSON.stringify({ ok: false, host: null, error: `Invalid SUPABASE_URL: ${err.message}` }));
  process.exit(2);
}

// Perform HEAD request with 10s timeout
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 10000);

try {
  const response = await fetch(`https://${host}/`, {
    method: "HEAD",
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (response.ok || response.status < 500) {
    console.log(JSON.stringify({ ok: true, host, error: null }));
    process.exit(0);
  } else {
    console.log(JSON.stringify({ ok: false, host, error: `HTTP ${response.status}` }));
    process.exit(2);
  }
} catch (err) {
  clearTimeout(timeoutId);

  if (err.name === "AbortError") {
    console.log(JSON.stringify({ ok: false, host, error: "timeout after 10s" }));
  } else if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" || err.code === "ETIMEDOUT") {
    console.log(JSON.stringify({ ok: false, host, error: err.message }));
  } else {
    console.log(JSON.stringify({ ok: false, host, error: err.message }));
  }
  process.exit(2);
}
