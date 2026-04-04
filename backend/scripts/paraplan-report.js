/**
 * Paraplan Report Script
 *
 * Initializes Paraplan integration, fetches hours/groups/teachers data,
 * and dumps the full JSON to stdout.
 *
 * Usage:
 *   node --env-file=.env --env-file=.env.dev backend/scripts/paraplan-report.js
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });
config({ path: resolve(__dirname, "../../.env.dev") });

import * as paraplan from "../services/paraplan/index.js";
import * as settingsService from "../settingsService.js";

async function main() {
  console.log("=== Paraplan Report ===\n");

  // Load saved config from settingsService
  const savedConfig = await settingsService.get("dev", "paraplan_groups");
  console.log("[config] paraplan_groups from settings:", JSON.stringify(savedConfig, null, 2));
  console.log("");

  // Init paraplan with the saved config
  console.log("[init] Initializing Paraplan...");
  await paraplan.init(savedConfig?.groups || savedConfig);
  console.log("[init] Done. Status:", JSON.stringify(paraplan.getStatus(), null, 2));
  console.log("");

  // Dump hours
  const hours = paraplan.getHours();
  console.log("=== HOURS (full dump) ===");
  console.log(JSON.stringify(hours, null, 2));
  console.log("");

  // Dump teachers
  const teachers = paraplan.getTeachers();
  console.log("=== TEACHERS ===");
  console.log(JSON.stringify(teachers, null, 2));
  console.log("");

  // Dump groups summary
  const groups = paraplan.getGroups();
  console.log("=== GROUPS ===");
  console.log(JSON.stringify(groups, null, 2));
  console.log("");

  // Summary table
  console.log("=== SUMMARY ===");
  console.log(`Total groups: ${groups.length}`);
  console.log(`Teacher prefixes: ${Object.keys(teachers).length}`);
  console.log(`Days with hours: ${Object.keys(hours || {}).length}`);

  if (hours) {
    console.log("\nHours per day:");
    for (const [dow, slots] of Object.entries(hours)) {
      const m = slots.morning ? `morning=${slots.morning.hours}h (${slots.morning.paid_start}-${slots.morning.paid_end}, ${slots.morning.groups.length} groups)` : "morning=--";
      const e = slots.evening ? `evening=${slots.evening.hours}h (${slots.evening.paid_start}-${slots.evening.paid_end}, ${slots.evening.groups.length} groups)` : "evening=--";
      console.log(`  ${dow}: ${m} | ${e}`);
    }
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
