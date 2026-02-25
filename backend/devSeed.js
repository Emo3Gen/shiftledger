/**
 * Dev Seed — auto-loads Scenario B (full week with replacements, cleaning, extra classes)
 * into a fixed chat_id so DirectorPanel always has data on startup.
 *
 * Only runs in dev mode (NODE_ENV !== 'production').
 */

import logger from "./logger.js";

const SEED_CHAT_ID = "dev_seed_chat";
const SEED_TENANT_ID = "emu";
const SEED_WEEK = "2026-02-09";

/**
 * Run dev seed by calling ingestInternal directly (no HTTP round-trip).
 * @param {Function} ingestInternal - The ingest function from server.js
 * @param {Function} buildScheduleFn - Calls /debug/build-schedule logic
 */
export async function runDevSeed(ingestInternal, buildScheduleFn) {
  if (process.env.NODE_ENV === "production") return;

  // Check if seed data already exists
  try {
    const { supabase } = await import("./supabaseClient.js");
    const { data } = await supabase
      .from("facts")
      .select("id")
      .eq("chat_id", SEED_CHAT_ID)
      .limit(1);
    if (data && data.length > 0) {
      logger.info("Dev seed: data already exists for %s, skipping", SEED_CHAT_ID);
      return;
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

  try {
    // Step 1: Open week
    await send("admin1", `OPEN_WEEK ${SEED_WEEK}`, "admin");

    // Step 2: Availability — 4 employees
    // Иса (u1) — morning shifts
    await send("u1", `AVAIL ${SEED_WEEK} mon 10-13`);
    await send("u1", `AVAIL ${SEED_WEEK} tue 10-13`);
    await send("u1", `AVAIL ${SEED_WEEK} thu 10-13`);
    await send("u1", `AVAIL ${SEED_WEEK} fri 10-13`);
    await send("u1", `AVAIL ${SEED_WEEK} sat 10-13`);

    // Дарина (u2) — evening + extra
    await send("u2", `AVAIL ${SEED_WEEK} mon 18-21`);
    await send("u2", `AVAIL ${SEED_WEEK} tue 18-21`);
    await send("u2", `AVAIL ${SEED_WEEK} wed 10-13`);
    await send("u2", `AVAIL ${SEED_WEEK} thu 10-13`);
    await send("u2", `AVAIL ${SEED_WEEK} sat 10-13`);
    await send("u2", `AVAIL ${SEED_WEEK} sun 18-21`);

    // Ксюша (u3) — evening (for replacements)
    await send("u3", `AVAIL ${SEED_WEEK} wed 18-21`);
    await send("u3", `AVAIL ${SEED_WEEK} thu 18-21`);
    await send("u3", `AVAIL ${SEED_WEEK} fri 18-21`);
    await send("u3", `AVAIL ${SEED_WEEK} sun 10-13`);

    // Карина (u4) — evening
    await send("u4", `AVAIL ${SEED_WEEK} sat 18-21`);
    await send("u4", `AVAIL ${SEED_WEEK} fri 18-21`);

    // Step 3: Build schedule
    await buildScheduleFn(SEED_CHAT_ID, SEED_WEEK);

    // Step 4: Propose (transition to ACTIVE)
    await send("admin1", `PROPOSE ${SEED_WEEK}`, "admin");

    // Step 5: Replacements
    await send("u1", "девочки, не могу в четверг утро, кто сможет?");
    await send("u3", "я смогу выйти в чт утро");
    await send("u2", "не смогу в понедельник вечер, подмените пожалуйста");
    await send("u4", "могу в пн вечер, подменю");
    await send("u3", "в среду утро не получится, кто может?");
    await send("u1", "я выйду в ср утро");
    await send("u4", "пт вечер не смогу, кто свободен?");
    await send("u2", "я смогу в пт вечер");

    // Step 6: Cleaning
    await send("u2", "убралась во вторник");
    await send("u4", "убралась в среду");
    await send("u1", "убрался в четверг");

    // Step 7: Extra classes
    await send("u1", "доп занятие пн 12 детей");
    await send("u2", "допы ср 5 детей");
    await send("u4", "провела доп пт 10 детей");

    logger.info("Dev seed: loaded Scenario B for week %s (%d messages)", SEED_WEEK, 30);
  } catch (e) {
    logger.error({ err: e }, "Dev seed: failed");
  }
}

export { SEED_CHAT_ID, SEED_WEEK };
