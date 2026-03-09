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

const chatId = process.argv[2];
const limit = Number(process.argv[3] || 5);

if (!chatId) {
  console.error("Usage: node backend/scripts/check_last_event_facts.mjs <chat_id> [limit]");
  process.exit(1);
}

// Import after dotenv, so SUPABASE_* are available
const { supabase } = await import(path.join(backendDir, "supabaseClient.js"));

function trim80(s) {
  const t = String(s ?? "");
  return t.length > 80 ? t.slice(0, 77) + "..." : t;
}

function oneLineJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return '"<unserializable>"';
  }
}

function isNetworkError(err) {
  if (!err) return false;
  const msg = String(err.message || "").toLowerCase();
  const code = String(err.code || "");
  // Check Supabase error structure (may have details.message)
  const detailsMsg = err.details ? String(err.details.message || "").toLowerCase() : "";
  return (
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("etimedout") ||
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    detailsMsg.includes("timeout") ||
    detailsMsg.includes("econnrefused") ||
    detailsMsg.includes("enotfound") ||
    detailsMsg.includes("etimedout") ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    err.name === "AbortError"
  );
}

function extractHost() {
  const url = process.env.SUPABASE_URL || "";
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

async function withRetry(queryFn, maxRetries = 3) {
  const delays = [500, 1500, 3500];
  let lastError;
  let wasNetworkError = false;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await queryFn();
      // Check if result has an error that looks like a network issue
      if (result && result.error && isNetworkError(result.error)) {
        wasNetworkError = true;
        lastError = result.error;
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
          continue;
        }
        // Exhausted retries - throw a network error
        const err = new Error(result.error.message || "Network error");
        err.originalError = result.error;
        err.isNetworkError = true;
        throw err;
      }
      return result;
    } catch (err) {
      if (isNetworkError(err)) {
        wasNetworkError = true;
        lastError = err;
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
          continue;
        }
        // Exhausted retries - mark as network error
        err.isNetworkError = true;
        throw err;
      }
      throw err;
    }
  }

  // Should not reach here, but handle edge case
  if (wasNetworkError && lastError) {
    const err = new Error(lastError.message || "Network error after retries");
    err.originalError = lastError;
    err.isNetworkError = true;
    throw err;
  }
  throw lastError || new Error("Unknown error after retries");
}

console.log(`Last events for chat_id=${chatId} (limit=${limit}) env=${envName}`);

let events, evErr;
try {
  const result = await withRetry(() =>
    supabase
      .from("events")
      .select("id, trace_id, user_id, received_at, text, status")
      .eq("chat_id", chatId)
      .order("id", { ascending: false })
      .limit(limit),
  );
  events = result.data;
  evErr = result.error;
} catch (err) {
  if (err.isNetworkError || isNetworkError(err)) {
    const host = extractHost();
    console.error(`NETWORK: cannot reach Supabase ${host}:443 (timeout)`);
    process.exit(2);
  }
  console.error("events query error:");
  console.error(JSON.stringify({ code: err.code, message: err.message, details: err.details, hint: err.hint }, null, 2));
  process.exit(1);
}

if (evErr) {
  console.error("events query error:");
  console.error(JSON.stringify({ code: evErr.code, message: evErr.message, details: evErr.details, hint: evErr.hint }, null, 2));
  process.exit(1);
}

if (!events || events.length === 0) {
  console.log("(no events)");
  process.exit(0);
}

for (const ev of events) {
  console.log(
    `${ev.id} | ${ev.trace_id} | ${ev.user_id} | ${ev.received_at} | ${trim80(ev.text)} | status=${ev.status ?? ""}`
  );

  let facts, fErr;
  try {
    const result = await withRetry(() =>
      supabase
        .from("facts")
        .select("id, event_id, fact_type, fact_payload, confidence, status, parser_version, created_at")
        .eq("event_id", ev.id)
        .order("id", { ascending: true }),
    );
    facts = result.data;
    fErr = result.error;
  } catch (err) {
    if (err.isNetworkError || isNetworkError(err)) {
      const host = extractHost();
      console.error(`NETWORK: cannot reach Supabase ${host}:443 (timeout)`);
      process.exit(2);
    }
    console.log(`facts(event_id=${ev.id}): ERROR`);
    console.log(oneLineJson({ code: err.code, message: err.message, details: err.details, hint: err.hint }));
    continue;
  }

  if (fErr) {
    console.log(`facts(event_id=${ev.id}): ERROR`);
    console.log(oneLineJson({ code: fErr.code, message: fErr.message, details: fErr.details, hint: fErr.hint }));
    continue;
  }

  console.log(`facts(event_id=${ev.id}): count=${facts?.length ?? 0}`);
  for (const f of facts || []) {
    console.log(
      `  - ${f.fact_type} conf=${f.confidence} status=${f.status} parser=${f.parser_version} at=${f.created_at} payload=${oneLineJson(f.fact_payload)}`
    );
  }
}
