#!/usr/bin/env node
/**
 * Smoke test for /debug/week_state endpoint
 * Tests that hasProblem is always defined in response
 */

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:3000";
const CHAT_ID = process.argv[2] || "test_chat_1";
const WEEK_START = process.argv[3] || "2026-02-09";

async function testWeekState() {
  const url = `${BACKEND_URL}/debug/week_state?chat_id=${encodeURIComponent(CHAT_ID)}&week_start=${encodeURIComponent(WEEK_START)}`;
  console.log(`[TEST] GET ${url}`);

  try {
    const res = await fetch(url);
    const text = await res.text();

    if (!res.ok) {
      console.error(`[FAIL] HTTP ${res.status}: ${text.slice(0, 200)}`);
      process.exit(1);
    }

    const json = JSON.parse(text);

    // Check that hasProblem is defined
    if (typeof json.hasProblem === "undefined") {
      console.error("[FAIL] hasProblem is missing in response");
      console.error("[RESPONSE]", JSON.stringify(json, null, 2));
      process.exit(1);
    }

    if (typeof json.hasProblem !== "boolean") {
      console.error(`[FAIL] hasProblem is not a boolean: ${typeof json.hasProblem}`);
      console.error("[RESPONSE]", JSON.stringify(json, null, 2));
      process.exit(1);
    }

    // Check that week_state.hasProblem is also defined
    if (json.week_state && typeof json.week_state.hasProblem === "undefined") {
      console.error("[FAIL] week_state.hasProblem is missing");
      process.exit(1);
    }

    console.log(`[PASS] hasProblem = ${json.hasProblem}`);
    console.log(`[INFO] week_state.state = ${json.week_state?.state || "N/A"}`);
    console.log(`[INFO] schedule.gaps.length = ${json.schedule?.gaps?.length || 0}`);
    console.log(`[INFO] schedule.slots.length = ${json.schedule?.slots?.length || 0}`);

    process.exit(0);
  } catch (e) {
    console.error("[ERROR]", e.message);
    process.exit(1);
  }
}

testWeekState();
