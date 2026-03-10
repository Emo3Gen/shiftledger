/**
 * Bot mode manager — shared across server, paymentsService, telegram/bot.
 *
 * Modes:
 *   manual — bot silent in group, admin publishes manually from panel
 *   auto   — bot publishes schedule & payments on schedule automatically
 *   debug  — intercepts group sends → redirects to ADMIN_CHAT_ID with [DEBUG] prefix
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { resolve } from "path";
import logger from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PERSIST_PATH = resolve(__dirname, "data", "bot-mode.json");
const VALID_MODES = ["manual", "auto", "debug"];

let currentMode = process.env.BOT_MODE || "manual";

// Load persisted mode on startup
try {
  const data = JSON.parse(readFileSync(PERSIST_PATH, "utf-8"));
  if (VALID_MODES.includes(data.mode)) {
    currentMode = data.mode;
  }
} catch {
  // File doesn't exist yet — use env/default
}

if (!VALID_MODES.includes(currentMode)) currentMode = "manual";
logger.info({ mode: currentMode }, "Bot mode initialized");

export function getBotMode() {
  return currentMode;
}

export function setBotMode(mode) {
  if (!VALID_MODES.includes(mode)) {
    throw new Error(`Invalid bot mode: ${mode}. Valid: ${VALID_MODES.join(", ")}`);
  }
  currentMode = mode;
  // Persist to file
  try {
    mkdirSync(dirname(PERSIST_PATH), { recursive: true });
    writeFileSync(PERSIST_PATH, JSON.stringify({ mode, updated: new Date().toISOString() }), "utf-8");
  } catch (e) {
    logger.warn({ err: e }, "Failed to persist bot mode to file");
  }
  logger.info({ mode }, "Bot mode changed");
  return mode;
}

export const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "";
