/**
 * SL-025: Restore facts from TG chat history export.
 *
 * Usage:
 *   cd ~/shiftledger
 *   node backend/scripts/restore-from-tg-history.mjs [--dry-run]
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env (or .env).
 */
import { parseEventToFacts } from "../factsParserV0.js";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { config } from "dotenv";

config({ path: new URL("../../.env", import.meta.url).pathname });

const DRY_RUN = process.argv.includes("--dry-run");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabase = null;
if (!DRY_RUN) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (required for non-dry-run)");
    process.exit(1);
  }
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
}

const CHAT_ID = "-1002789466545";

const NAME_MAP = {
  "даринка": "u2", "дарина": "u2",
  "иса": "u1",
  "ксения": "u3", "ксюша": "u3",
  "карина": "u4",
  "алёна": null, "алена": null, // director, autoSchedule: false — skip
  "катя": "u6",
  "рита": "u7",
  "соня": "u8",
  "семён": null,
  "евгений харюков": null,
  "shiftledger dev": null,
};

// ── Step 1: Parse TG history file ────────────────────────────────────────────

function parseTgHistory(text) {
  const messages = [];
  const lines = text.split("\n");
  let current = null;

  for (const line of lines) {
    const match = line.match(/^\[(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})\] ([^:]+): ?(.*)/);
    if (match) {
      if (current) messages.push(current);
      const [, dd, mm, yyyy, hh, min, name, text] = match;
      current = {
        date: new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00Z`).toISOString(),
        name: name.trim().toLowerCase(),
        text: text.trim(),
      };
    } else if (current && line.trim()) {
      current.text += "\n" + line.trim();
    }
  }
  if (current) messages.push(current);
  return messages;
}

// ── Step 2: Process messages through parser and upsert ───────────────────────

const historyPath = new URL("./tg_history.txt", import.meta.url).pathname;
const text = readFileSync(historyPath, "utf8");
const messages = parseTgHistory(text);

console.log(`Parsed ${messages.length} messages from TG history`);
if (DRY_RUN) console.log("  (dry-run mode — no DB writes)\n");

let processed = 0, factsCreated = 0, skipped = 0, errors = 0;
const weekStats = new Map(); // week_start → count

for (const msg of messages) {
  const userId = NAME_MAP[msg.name];
  if (userId === undefined) {
    console.warn(`⚠ Unknown name: "${msg.name}" — skipping`);
    skipped++;
    continue;
  }
  if (userId === null) { skipped++; continue; }
  if (!msg.text) { skipped++; continue; }

  let facts;
  try {
    facts = parseEventToFacts({
      text: msg.text,
      received_at: msg.date,
      chat_id: CHAT_ID,
      user_id: userId,
      meta: { source: "tg_history_import" },
    });
  } catch (e) {
    console.error(`✗ Parse error for ${msg.date} ${userId}: ${e.message}`);
    errors++;
    processed++;
    continue;
  }

  if (facts.length === 0) { processed++; continue; }

  const traceId = `tg-history-${msg.date}-${userId}`;
  const rows = facts.map((f, i) => {
    const hashInput = JSON.stringify({
      trace: traceId,
      idx: i,
      fact_type: f.fact_type,
      fact_payload: f.fact_payload || {},
    });
    return {
      event_id: null,
      trace_id: traceId,
      chat_id: CHAT_ID,
      user_id: userId,
      fact_type: f.fact_type,
      fact_payload: f.fact_payload || {},
      confidence: f.confidence || null,
      status: "parsed",
      parser_version: "v0-history-import",
      fact_hash: createHash("sha256").update(hashInput).digest("hex"),
      created_at: msg.date,
    };
  });

  // Track week stats
  for (const r of rows) {
    const ws = r.fact_payload?.week_start;
    if (ws) weekStats.set(ws, (weekStats.get(ws) || 0) + 1);
  }

  if (DRY_RUN) {
    console.log(`  ${msg.date.slice(0, 10)} ${userId}: ${rows.length} facts — "${msg.text.slice(0, 50).replace(/\n/g, " ")}"`);
    factsCreated += rows.length;
    processed++;
    continue;
  }

  const { data: upserted, error } = await supabase
    .from("facts")
    .upsert(rows, { onConflict: "fact_hash" })
    .select("id");

  if (error) {
    console.error(`✗ Error for ${msg.date} ${userId}: ${error.message}`);
    errors++;
  } else {
    factsCreated += upserted?.length || 0;
    if (upserted?.length > 0) {
      console.log(`✅ ${msg.date.slice(0, 10)} ${userId}: ${upserted.length} facts — "${msg.text.slice(0, 50).replace(/\n/g, " ")}"`);
    }
  }

  processed++;
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(60));
console.log(`Messages: ${processed} processed, ${skipped} skipped, ${errors} errors`);
console.log(`Facts: ${factsCreated} created/upserted`);
console.log("\nFacts per week_start:");
for (const [ws, count] of [...weekStats.entries()].sort()) {
  console.log(`  ${ws}: ${count} facts`);
}
if (DRY_RUN) console.log("\n⚠ DRY RUN — no data written to DB");
