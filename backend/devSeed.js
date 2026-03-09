/**
 * Dev Seed — auto-loads Scenario B (full week with replacements, cleaning, extra classes)
 * into a fixed chat_id so DirectorPanel always has data on startup.
 *
 * Uses structured commands (not NL) to ensure week_start is set correctly
 * and facts are properly filtered by the timesheet endpoint.
 */

import logger from "./logger.js";

const SEED_CHAT_ID = "dev_seed_chat";
const SEED_TENANT_ID = "emu";

// Compute current Monday dynamically so seed data always matches "Сегодня"
function getCurrentMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff).toISOString().slice(0, 10);
}
const SEED_WEEK = getCurrentMonday();

/**
 * Run dev seed by calling ingestInternal directly (no HTTP round-trip).
 * @param {Function} ingestInternal - The ingest function from server.js
 * @param {Function} buildScheduleFn - Calls /debug/build-schedule logic (persists SHIFT_ASSIGNMENT facts)
 * @param {Object} [options] - { force: boolean } - force re-seed even if data exists
 */
export async function runDevSeed(ingestInternal, buildScheduleFn, options = {}) {
  if (process.env.NODE_ENV === "production") return;

  const { supabase } = await import("./supabaseClient.js");

  // Check if seed data already exists
  try {
    const { data } = await supabase
      .from("facts")
      .select("id")
      .eq("chat_id", SEED_CHAT_ID)
      .limit(1);
    if (data && data.length > 0) {
      if (!options.force) {
        logger.info("Dev seed: data already exists for %s, skipping", SEED_CHAT_ID);
        return;
      }
      // Force mode: clean old data first
      logger.info("Dev seed: force mode — deleting old data for %s", SEED_CHAT_ID);
      await supabase.from("facts").delete().eq("chat_id", SEED_CHAT_ID);
      await supabase.from("events").delete().eq("chat_id", SEED_CHAT_ID);
    }
  } catch {
    // If DB check fails, proceed with seeding anyway
  }

  logger.info("Dev seed: loading Scenario B for week %s into chat %s", SEED_WEEK, SEED_CHAT_ID);

  const send = async (userId, text, role = "staff") => {
    try {
      await ingestInternal({
        source: "emu",
        chat_id: SEED_CHAT_ID,
        user_id: userId,
        text,
        meta: { role },
        tenant_id: SEED_TENANT_ID,
        traceId: undefined,
      });
    } catch (e) {
      logger.warn({ err: e, text }, "Dev seed: ingest error");
    }
  };

  const W = SEED_WEEK; // shorthand

  try {
    // Step 1: Open week
    await send("admin1", `OPEN_WEEK ${W}`, "admin");

    // Step 2: Availability — 4 employees (structured AVAIL commands with explicit week_start)
    // Иса (u1) — morning shifts
    await send("u1", `AVAIL ${W} mon 10-13`);
    await send("u1", `AVAIL ${W} tue 10-13`);
    await send("u1", `AVAIL ${W} thu 10-13`);
    await send("u1", `AVAIL ${W} fri 10-13`);
    await send("u1", `AVAIL ${W} sat 10-13`);

    // Дарина (u2) — evening + extra
    await send("u2", `AVAIL ${W} mon 18-21`);
    await send("u2", `AVAIL ${W} tue 18-21`);
    await send("u2", `AVAIL ${W} wed 10-13`);
    await send("u2", `AVAIL ${W} thu 10-13`);
    await send("u2", `AVAIL ${W} sat 10-13`);
    await send("u2", `AVAIL ${W} sun 18-21`);

    // Ксюша (u3) — evening (for replacements)
    await send("u3", `AVAIL ${W} wed 18-21`);
    await send("u3", `AVAIL ${W} thu 18-21`);
    await send("u3", `AVAIL ${W} fri 18-21`);
    await send("u3", `AVAIL ${W} sun 10-13`);

    // Карина (u4) — evening
    await send("u4", `AVAIL ${W} sat 18-21`);
    await send("u4", `AVAIL ${W} fri 18-21`);

    // Step 3: Build schedule (persists SHIFT_ASSIGNMENT facts)
    await buildScheduleFn(SEED_CHAT_ID, W);

    // Step 4: Propose (transition to ACTIVE)
    await send("admin1", `PROPOSE ${W}`, "admin");

    // Step 5: Cleaning (structured commands with explicit week_start)
    await send("u2", `CLEANING ${W} tue`);
    await send("u4", `CLEANING ${W} wed`);
    await send("u1", `CLEANING ${W} thu`);

    // Step 6: Extra classes (structured commands with explicit week_start + kids count)
    await send("u1", `EXTRA_CLASS ${W} mon 12`);
    await send("u2", `EXTRA_CLASS ${W} wed 5`);
    await send("u4", `EXTRA_CLASS ${W} fri 10`);

    logger.info("Dev seed: loaded Scenario B for week %s", W);
  } catch (e) {
    logger.error({ err: e }, "Dev seed: failed");
  }
}

export { SEED_CHAT_ID, SEED_WEEK };
