import dotenv from "dotenv";

const envName = process.env.APP_ENV || "dev";
dotenv.config({ path: `.env.${envName}` });
dotenv.config({ path: ".env" }); // also load base .env (for shared vars)

// --- Validate required env vars ---
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TELEGRAM_BOT_TOKEN',
];
const _missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (_missingEnv.length) {
  console.error('FATAL: Missing env vars:', _missingEnv.join(', '));
  process.exit(1);
}

import express from "express";
import { webhookCallback } from "grammy";
import { randomUUID, createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { supabase } from "./supabaseClient.js";
import { parseEventToFacts, setExtraWorkCatalog } from "./factsParserV0.js";
import { buildDraftSchedule as _buildDraftScheduleRaw } from "./scheduleEngineV0.js";
import { buildTimesheet } from "./timesheetV0.js";
import { computeWeekState } from "./weekStateV0.js";
import { UserDirectory } from "./userDirectory.js";
import employeesRouter from "./routes/employees.js";
import slotsRouter from "./routes/slots.js";
import settingsRouter from "./routes/settings.js";
import extraWorkRouter from "./routes/extraWork.js";
import * as employeeService from "./employeeService.js";
import * as slotService from "./slotService.js";
import * as settingsService from "./settingsService.js";
import { requireApiKey } from "./middleware/auth.js";
import { validateBody, validateQuery, validateParams } from "./middleware/validate.js";
import logger from "./logger.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { generalLimiter, ingestLimiter } from "./middleware/rateLimiter.js";
import { createBot } from "./telegram/bot.js";
import { getBotMode, setBotMode, ADMIN_CHAT_ID } from "./botMode.js";
import { runDevSeed } from "./devSeed.js";
import { generateScheduleImage } from "./services/scheduleImage.js";
import * as paraplan from "./services/paraplan/index.js";
import { toWeekHoursTemplate } from "./services/paraplan/hoursCalculator.js";
import swaggerUi from "swagger-ui-express";
import { specs as swaggerSpecs } from "./swagger.js";
import {
  IngestSchema,
  DebugSendSchema,
  ParseEventParamsSchema,
  ScheduleQuerySchema,
  TimesheetPeriodQuerySchema,
  BuildScheduleSchema,
  ConfirmUserParamsSchema,
  ConfirmUserBodySchema,
  FactsQuerySchema,
  EventsQuerySchema,
  DialogsQuerySchema,
  DialogParamsSchema,
  DialogQuerySchema,
} from "./validation/schemas.js";

// In-memory pending clarifications for ambiguous replacements (cleaning vs shift)
// Key: "chatId|userId", Value: { dow, cleaning_help_user_id, shift_unavail_user_id, shift_slot, expires_at, chat_id }
const pendingClarifications = new Map();

// Telegram bot instance reference (set after bot creation, used by /api/schedule/publish)
let telegramBot = null;

// --- Cron state persistence ---
const __dirname_server = dirname(fileURLToPath(import.meta.url));
const CRON_STATE_PATH = resolve(__dirname_server, "data", "cron-state.json");

function loadCronState() {
  try {
    return JSON.parse(readFileSync(CRON_STATE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveCronState(state) {
  try {
    mkdirSync(dirname(CRON_STATE_PATH), { recursive: true });
    writeFileSync(CRON_STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
  } catch (e) {
    logger.warn({ err: e }, "Failed to persist cron state");
  }
}

const app = express();

// Structured request logging (pino)
app.use(requestLogger);

// Global rate limiter
app.use(generalLimiter);

// Парсер JSON ДОЛЖЕН быть подключён до роутов,
// чтобы req.body был заполнен.
app.use(express.json());

// Serve frontend static files (production build) — no auth required
const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "../apps/simulator/dist");
if (existsSync(distDir)) {
  // Cache-bust index.html so browser always gets latest SPA
  app.use((req, res, next) => {
    if (req.path === "/" || req.path === "/index.html") {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    }
    next();
  });
  app.use(express.static(distDir));
  logger.info("Serving static files from %s", distDir);
}

// API key auth — after static files, skips /health, /__ping, /telegram-webhook
app.use(requireApiKey);

// Helper: load slot templates for a tenant, convert to engine format
async function loadSlotTypes(tenantId) {
  try {
    const templates = await slotService.getByTenant(tenantId || "dev");
    if (templates && templates.length > 0) {
      return templates.map((t) => ({
        name: t.name,
        from: t.from_time,
        to: t.to_time,
      }));
    }
  } catch (err) {
    logger.warn({ err }, "loadSlotTypes fallback to defaults");
  }
  return null; // null = use engine defaults
}

// Emogen-sourced hours cache (used when USE_EMOGEN_PARAPLAN = true)
let _emogenHoursCache = null; // { hours: {...}, updatedAt }

async function fetchEmogenHours() {
  if (!EMOGEN_API_URL) return null;
  try {
    const r = await emogenFetch("/api/paraplan/hours");
    if (!r.ok) { logger.warn({ status: r.status }, "[emogen] Failed to fetch hours"); return null; }
    const data = await r.json();
    if (data.hours) {
      _emogenHoursCache = { hours: data.hours, updatedAt: data.updatedAt || new Date().toISOString() };
      logger.info({ days: Object.keys(data.hours).length }, "[emogen] Paraplan hours cached");
    }
    return _emogenHoursCache;
  } catch (e) {
    logger.warn({ err: e.message }, "[emogen] Hours fetch error");
    return null;
  }
}

// Wrapper: buildDraftSchedule with Paraplan hours auto-merged into settings
function buildDraftSchedule(params) {
  // Merge Paraplan hours from direct connection OR Emogen cache
  const hasDirectParaplan = paraplan.isReady();
  const hasEmogenHours = USE_EMOGEN_PARAPLAN && _emogenHoursCache?.hours;
  if ((hasDirectParaplan || hasEmogenHours) && params.settings) {
    const defaultTemplate = params.settings["schedule.week_hours_template"] || {};
    const merged = hasDirectParaplan
      ? paraplan.getWeekHoursTemplate(defaultTemplate)
      : toWeekHoursTemplate(_emogenHoursCache.hours, defaultTemplate);
    params = { ...params, settings: { ...params.settings, "schedule.week_hours_template": merged } };
  }
  // Inject slot skill requirements from paraplan_groups config
  const groupsConfig = params.settings?.["paraplan_groups"];
  if (Array.isArray(groupsConfig) && groupsConfig.length > 0) {
    const SKILL_ORDER = { beginner: 0, experienced: 1, guru: 2 };
    const slotSkill = {}; // "dow|morning" → highest required_skill_level
    for (const g of groupsConfig) {
      if (!g.required_skill_level) continue;
      for (const l of (g.lessons || [])) {
        const dow = l.dow;
        if (!dow) continue;
        const [h] = (l.startTime || "00:00").split(":").map(Number);
        const slot = h < 14 ? "morning" : "evening";
        const key = `${dow}|${slot}`;
        const current = slotSkill[key];
        if (!current || (SKILL_ORDER[g.required_skill_level] || 0) > (SKILL_ORDER[current] || 0)) {
          slotSkill[key] = g.required_skill_level;
        }
      }
    }
    if (Object.keys(slotSkill).length > 0) {
      params = { ...params, settings: { ...params.settings, "schedule.slot_skill_requirements": slotSkill } };
    }
  }
  return _buildDraftScheduleRaw(params);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => `"${k}":${stableStringify(value[k])}`);
  return `{${parts.join(",")}}`;
}

function computeFactHash(eventId, factType, payload) {
  const normalized = {
    event_id: eventId,
    fact_type: factType,
    fact_payload: payload,
  };
  const s = stableStringify(normalized);
  return createHash("sha256").update(s).digest("hex");
}

// Internal ingest helper used by /ingest and /debug/send
async function ingestInternal({ source, chat_id, user_id, text, meta, tenant_id, traceId }) {
  const startedAt = Date.now();
  if (!chat_id || !user_id) {
    throw new Error("chat_id and user_id are required");
  }

  const now = new Date().toISOString();
  // Если tenant_id передан, сохраняем в meta.tenant_id
  const finalMeta = { ...(meta || {}) };
  if (tenant_id) {
    finalMeta.tenant_id = tenant_id;
  }

  const event = {
    trace_id: traceId || randomUUID(),
    source: source ?? "emu",
    chat_id,
    user_id,
    text: text ?? "",
    role: finalMeta?.role ?? null,
    meta: finalMeta,
    status: "received",
    received_at: now,
  };

  logger.info({ trace_id: event.trace_id, chat_id: event.chat_id, user_id: event.user_id }, "ingest started");

  // Persist event
  const persistStart = Date.now();
  const { data: inserted, error } = await supabase
    .from("events")
    .insert({
      trace_id: event.trace_id,
      source: event.source,
      chat_id: event.chat_id,
      user_id: event.user_id,
      text: event.text,
      role: event.role,
      meta: event.meta,
      status: event.status,
      received_at: event.received_at,
    })
    .select("*")
    .single();

  if (error || !inserted) {
    logger.error({ err: error }, "INGEST failed to insert into Supabase");
    throw new Error("failed to persist event");
  }

  const eventId = inserted.id;
  const persist_event_ms = Date.now() - persistStart;

  // Parse + persist facts (best-effort, не ломает ingest при ошибке)
  let facts = [];
  let factsPreview = [];
  let factsWritten = 0;
  let factsPersistError = null;
  let parse_ms = 0;
  let persist_facts_ms = 0;

  try {
    const parseStart = Date.now();
    const parsed = parseEventToFacts({
      text: inserted.text,
      received_at: inserted.received_at,
      chat_id: inserted.chat_id,
      user_id: inserted.user_id,
      meta: inserted.meta,
    });
    parse_ms = Date.now() - parseStart;

    // Сохраняем preview фактов ДО записи в БД
    factsPreview = Array.isArray(parsed) ? parsed : [];

    // Диагностика: логируем результат парсинга
    logger.debug({ event_id: eventId, text: inserted.text, facts_count: factsPreview.length }, "parse preview");
    if (factsPreview.length > 0) {
      logger.debug({ sample: factsPreview.slice(0, 2).map((f) => ({ fact_type: f.fact_type, payload_keys: Object.keys(f.fact_payload || {}) })) }, "parse preview sample");
    }

    if (Array.isArray(parsed) && parsed.length > 0) {
      const rows = parsed.map((f) => {
        const factPayload = f.fact_payload ?? {};
        const factType = f.fact_type;
        const factHash = computeFactHash(eventId, factType, factPayload);

        return {
          event_id: eventId,
          trace_id: inserted.trace_id,
          chat_id: inserted.chat_id,
          user_id: inserted.user_id,
          fact_type: factType,
          fact_payload: factPayload,
          confidence: f.confidence ?? null,
          status: "parsed",
          parser_version: "v0",
          fact_hash: factHash,
        };
      });

      factsWritten = rows.length;

      const persistFactsStart = Date.now();
      const { error: factsErr } = await supabase
        .from("facts")
        .upsert(rows, { onConflict: "fact_hash" });
      persist_facts_ms = Date.now() - persistFactsStart;

      if (factsErr) {
        factsPersistError = String(factsErr.message || factsErr);
        logger.error({ event_id: eventId, err: factsPersistError }, "facts persist error");
      }
    }

    // Загружаем факты для удобства ответа
    const { data: factsData, error: factsLoadErr } = await supabase
      .from("facts")
      .select("*")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });

    if (!factsLoadErr && Array.isArray(factsData)) {
      facts = factsData;
    }

    // --- Replacement coordination: system messages + auto-promotion ---
    const DOW_RU_MAP = { mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" };
    const SLOT_NAME_MAP = { "10:00|13:00": "утро", "18:00|21:00": "вечер" };
    const getSlotLabel = (from, to) => SLOT_NAME_MAP[`${from}|${to}`] || `${from}-${to}`;

    // Helper: insert a system event into the chat
    // Inherits source and tenant_id from the original event so dialog queries find it
    const insertSystemEvent = async (chatId, text) => {
      const sysEvent = {
        trace_id: randomUUID(),
        source: event.source,
        chat_id: chatId,
        user_id: "system",
        text,
        role: "system",
        meta: { ...finalMeta, system_message: true },
        status: "received",
        received_at: new Date().toISOString(),
      };
      const { error: sysErr } = await supabase.from("events").insert(sysEvent);
      if (sysErr) {
        logger.error({ err: sysErr }, "Failed to insert system event");
      }
    };

    // Expiry cleanup for pending clarifications
    for (const [pendKey, pendVal] of pendingClarifications.entries()) {
      if (pendVal.expires_at < Date.now()) {
        pendingClarifications.delete(pendKey);
      }
    }

    // Handle CLARIFICATION_RESPONSE (answer to ambiguity question)
    for (const f of factsPreview) {
      if (f.fact_type !== "CLARIFICATION_RESPONSE") continue;
      const clarType = f.fact_payload?.type;
      const clarUserId = UserDirectory.normalizeUserId(inserted.user_id);
      const pendKey = `${inserted.chat_id}|${clarUserId}`;
      const pending = pendingClarifications.get(pendKey);
      if (!pending) continue;

      pendingClarifications.delete(pendKey);
      const dayLabel = DOW_RU_MAP[pending.dow] || pending.dow;

      if (clarType === "cleaning" && pending.cleaning_help_user_id) {
        const swapPayload = { dow: pending.dow, replacement_user_id: clarUserId, original_user_id: pending.cleaning_help_user_id };
        const swapHash = createHash("sha256").update(
          `clarification_cleaning|${eventId}|${JSON.stringify(swapPayload)}`
        ).digest("hex");
        const { error: swErr } = await supabase.from("facts").upsert([{
          event_id: eventId, trace_id: inserted.trace_id, chat_id: inserted.chat_id, user_id: clarUserId,
          fact_type: "CLEANING_SWAP", fact_payload: swapPayload, confidence: 1.0,
          status: "parsed", parser_version: "v0", fact_hash: swapHash,
        }], { onConflict: "fact_hash" });
        if (swErr) {
          logger.error({ err: swErr }, "Failed to create CLEANING_SWAP from clarification");
        } else {
          const volunteerName = UserDirectory.getDisplayName(clarUserId);
          const originalName = UserDirectory.getDisplayName(pending.cleaning_help_user_id);
          await insertSystemEvent(inserted.chat_id, `✅ ${volunteerName} уберётся за ${originalName} в ${dayLabel}`);
          logger.info({ dow: pending.dow, volunteer: clarUserId, original: pending.cleaning_help_user_id }, "Clarification resolved: cleaning");
        }
      } else if (clarType === "shift" && pending.shift_unavail_user_id && pending.shift_slot) {
        const replPayload = { dow: pending.dow, from: pending.shift_slot.from, to: pending.shift_slot.to, user_id: clarUserId };
        const replHash = createHash("sha256").update(
          `clarification_shift|${eventId}|${JSON.stringify(replPayload)}`
        ).digest("hex");
        const { error: rErr } = await supabase.from("facts").upsert([{
          event_id: eventId, trace_id: inserted.trace_id, chat_id: inserted.chat_id, user_id: clarUserId,
          fact_type: "SHIFT_REPLACEMENT", fact_payload: replPayload, confidence: 1.0,
          status: "parsed", parser_version: "v0", fact_hash: replHash,
        }], { onConflict: "fact_hash" });
        if (rErr) {
          logger.error({ err: rErr }, "Failed to create SHIFT_REPLACEMENT from clarification");
        } else {
          const replacementName = UserDirectory.getDisplayName(clarUserId);
          const originalName = UserDirectory.getDisplayName(pending.shift_unavail_user_id);
          const slotLabel = getSlotLabel(pending.shift_slot.from, pending.shift_slot.to);
          await insertSystemEvent(inserted.chat_id, `✅ ${replacementName} заменяет ${originalName} в ${dayLabel} ${slotLabel}`);
          logger.info({ dow: pending.dow, replacement: clarUserId, original: pending.shift_unavail_user_id }, "Clarification resolved: shift");
        }
      }
    }

    // 2a. After SHIFT_UNAVAILABILITY: generate system message for each unavailable slot with an assignment
    for (const f of factsPreview) {
      if (f.fact_type !== "SHIFT_UNAVAILABILITY") continue;
      const { dow, from, to } = f.fact_payload || {};
      if (!dow || !from || !to) continue;

      const unavailUserId = inserted.user_id;
      const normalizedUnavailUserId = UserDirectory.normalizeUserId(unavailUserId);

      // Check if there's an existing SHIFT_ASSIGNMENT for this slot assigned to this user
      const { data: existingAssignments } = await supabase
        .from("facts")
        .select("*")
        .eq("chat_id", inserted.chat_id)
        .eq("fact_type", "SHIFT_ASSIGNMENT")
        .order("created_at", { ascending: false })
        .limit(200);

      const slotKey = `${dow}|${from}|${to}`;
      const matchingAssignment = (existingAssignments || []).find((a) => {
        const p = a.fact_payload || {};
        return `${p.dow}|${p.from}|${p.to}` === slotKey &&
          UserDirectory.normalizeUserId(p.assigned_user_id) === normalizedUnavailUserId;
      });

      if (matchingAssignment) {
        const displayName = UserDirectory.getDisplayName(normalizedUnavailUserId);
        const dayLabel = DOW_RU_MAP[dow] || dow;
        const slotLabel = getSlotLabel(from, to);
        await insertSystemEvent(
          inserted.chat_id,
          `⚠️ ${displayName} не может ${dayLabel} ${slotLabel}. Кто сможет подменить?`
        );
      }
    }

    // Pre-scan: detect ambiguity for generic SHIFT_AVAILABILITY (both morning+evening = no specific time)
    const BOTH_SLOTS_CHECK = [{ from: "10:00", to: "13:00" }, { from: "18:00", to: "21:00" }];
    const availDaySlots = new Map(); // dow → Set of "from|to"
    for (const f of factsPreview) {
      if (f.fact_type !== "SHIFT_AVAILABILITY" || f.fact_payload?.availability !== "can") continue;
      const { dow: ad, from: af, to: at } = f.fact_payload || {};
      if (!ad) continue;
      if (!availDaySlots.has(ad)) availDaySlots.set(ad, new Set());
      availDaySlots.get(ad).add(`${af}|${at}`);
    }

    const ambiguousDays = new Set();
    const cleanOnlyDays = new Map(); // dow → { cleanHelpUserId }

    // Only run ambiguity check if there are generic availability days
    const hasGenericAvail = [...availDaySlots.entries()].some(([, s]) => s.has("10:00|13:00") && s.has("18:00|21:00"));
    let ambiguityCheckFacts = [];
    if (hasGenericAvail) {
      const { data: acf } = await supabase.from("facts").select("*")
        .eq("chat_id", inserted.chat_id).order("created_at", { ascending: false }).limit(500);
      ambiguityCheckFacts = acf || [];
    }

    for (const [dow, slotsSet] of availDaySlots.entries()) {
      const isGeneric = slotsSet.has("10:00|13:00") && slotsSet.has("18:00|21:00");
      if (!isGeneric) continue;

      const normalizedAvailUser = UserDirectory.normalizeUserId(inserted.user_id);

      // Check for unresolved NEEDS_REPLACEMENT on this day
      let needsReplSlot = null;
      let shiftUnavailUser = null;
      for (const bs of BOTH_SLOTS_CHECK) {
        const sk = `${dow}|${bs.from}|${bs.to}`;
        const aFact = ambiguityCheckFacts.find(af =>
          af.fact_type === "SHIFT_ASSIGNMENT" &&
          `${af.fact_payload?.dow}|${af.fact_payload?.from}|${af.fact_payload?.to}` === sk
        );
        if (!aFact) continue;
        const assignedU = UserDirectory.normalizeUserId(aFact.fact_payload?.assigned_user_id || aFact.user_id);
        if (assignedU === normalizedAvailUser) continue;
        const uFact = ambiguityCheckFacts.find(uf => {
          if (uf.fact_type !== "SHIFT_UNAVAILABILITY") return false;
          if (`${uf.fact_payload?.dow}|${uf.fact_payload?.from}|${uf.fact_payload?.to}` !== sk) return false;
          return UserDirectory.normalizeUserId(uf.user_id) === assignedU;
        });
        if (!uFact) continue;
        if (new Date(uFact.created_at).getTime() <= new Date(aFact.created_at).getTime()) continue;
        const eRepl = ambiguityCheckFacts.find(rf =>
          rf.fact_type === "SHIFT_REPLACEMENT" &&
          `${rf.fact_payload?.dow}|${rf.fact_payload?.from}|${rf.fact_payload?.to}` === sk
        );
        if (eRepl) continue;
        needsReplSlot = bs;
        shiftUnavailUser = assignedU;
        break;
      }

      // Check for unresolved CLEANING_HELP_REQUEST on this day
      let cleanHelpUser = null;
      const hFact = ambiguityCheckFacts.find(hf =>
        hf.fact_type === "CLEANING_HELP_REQUEST" && hf.fact_payload?.dow === dow
      );
      if (hFact) {
        const hUser = UserDirectory.normalizeUserId(hFact.user_id);
        if (hUser !== normalizedAvailUser) {
          const eSwap = ambiguityCheckFacts.find(sf =>
            sf.fact_type === "CLEANING_SWAP" && sf.fact_payload?.dow === dow && sf.fact_payload?.replacement_user_id != null
          );
          if (!eSwap) cleanHelpUser = hUser;
        }
      }

      if (needsReplSlot && cleanHelpUser) {
        // Case 3: AMBIGUITY — both cleaning and shift requests exist
        ambiguousDays.add(dow);
        const volunteerName = UserDirectory.getDisplayName(normalizedAvailUser);
        const cleanOrigName = UserDirectory.getDisplayName(cleanHelpUser);
        const shiftOrigName = UserDirectory.getDisplayName(shiftUnavailUser);
        const dayLabel = DOW_RU_MAP[dow] || dow;
        const slotLabel = getSlotLabel(needsReplSlot.from, needsReplSlot.to);
        const pendKey = `${inserted.chat_id}|${normalizedAvailUser}`;
        pendingClarifications.set(pendKey, {
          dow,
          cleaning_help_user_id: cleanHelpUser,
          shift_unavail_user_id: shiftUnavailUser,
          shift_slot: needsReplSlot,
          expires_at: Date.now() + 30 * 60 * 1000,
          chat_id: inserted.chat_id,
        });
        await insertSystemEvent(inserted.chat_id,
          `❓ ${volunteerName}, уточни — ты имеешь в виду:\n1️⃣ Замена уборки (за ${cleanOrigName} в ${dayLabel})\n2️⃣ Замена дежурства (за ${shiftOrigName} ${dayLabel} ${slotLabel})\nОтветь цифрой или напиши подробнее`
        );
        logger.info({ dow, volunteer: normalizedAvailUser, cleanHelp: cleanHelpUser, shiftUnavail: shiftUnavailUser },
          "Ambiguity detected, clarification requested");
      } else if (cleanHelpUser && !needsReplSlot) {
        // Case 1: Only cleaning request → will auto-promote below
        cleanOnlyDays.set(dow, { cleanHelpUserId: cleanHelpUser });
      }
      // Case 2 (only shift) and Case 4 (neither): handled per-slot in section 2b below
    }

    // Handle Case 1: clean-only days → auto-promote SHIFT_AVAILABILITY to CLEANING_SWAP
    for (const [dow, cInfo] of cleanOnlyDays.entries()) {
      const volunteerId = UserDirectory.normalizeUserId(inserted.user_id);
      const swapPayload = { dow, replacement_user_id: volunteerId, original_user_id: cInfo.cleanHelpUserId };
      const swapHash = createHash("sha256").update(
        `auto_clean_from_avail|${eventId}|${JSON.stringify(swapPayload)}`
      ).digest("hex");
      const { error: swErr } = await supabase.from("facts").upsert([{
        event_id: eventId, trace_id: inserted.trace_id, chat_id: inserted.chat_id, user_id: volunteerId,
        fact_type: "CLEANING_SWAP", fact_payload: swapPayload, confidence: 1.0,
        status: "parsed", parser_version: "v0", fact_hash: swapHash,
      }], { onConflict: "fact_hash" });
      if (!swErr) {
        const vName = UserDirectory.getDisplayName(volunteerId);
        const oName = UserDirectory.getDisplayName(cInfo.cleanHelpUserId);
        const dLabel = DOW_RU_MAP[dow] || dow;
        await insertSystemEvent(inserted.chat_id, `✅ ${vName} уберётся за ${oName} в ${dLabel}`);
        logger.info({ dow, volunteer: volunteerId, original: cInfo.cleanHelpUserId },
          "Case 1: auto-promoted AVAILABILITY to CLEANING_SWAP");
      }
    }

    // 2b. After SHIFT_AVAILABILITY: auto-promote to SHIFT_REPLACEMENT
    // ONLY if the slot has an assigned user who declared unavailability (= true NEEDS_REPLACEMENT)
    for (const f of factsPreview) {
      if (f.fact_type !== "SHIFT_AVAILABILITY") continue;
      if (f.fact_payload?.availability !== "can") continue;
      const { dow, from, to } = f.fact_payload || {};
      if (!dow || !from || !to) continue;

      // Skip ambiguous and clean-only days (handled by pre-scan above)
      if (ambiguousDays.has(dow) || cleanOnlyDays.has(dow)) continue;

      const availUserId = inserted.user_id;
      const normalizedAvailUserId = UserDirectory.normalizeUserId(availUserId);
      const slotKey = `${dow}|${from}|${to}`;

      // Load all chat facts to check assignment + unavailability state
      const { data: allChatFacts } = await supabase
        .from("facts")
        .select("*")
        .eq("chat_id", inserted.chat_id)
        .order("created_at", { ascending: false })
        .limit(500);

      // Step 1: Find the latest SHIFT_ASSIGNMENT for this slot
      const assignmentFact = (allChatFacts || []).find((af) => {
        if (af.fact_type !== "SHIFT_ASSIGNMENT") return false;
        const p = af.fact_payload || {};
        return `${p.dow}|${p.from}|${p.to}` === slotKey;
      });

      if (!assignmentFact) continue; // No assignment on this slot — nothing to replace

      const assignedUserId = UserDirectory.normalizeUserId(
        assignmentFact.fact_payload?.assigned_user_id || assignmentFact.user_id
      );

      // Step 2: The person offering availability must be DIFFERENT from the assigned user
      if (normalizedAvailUserId === assignedUserId) continue;

      // Step 3: The assigned user must have a SHIFT_UNAVAILABILITY for this slot (newer than assignment)
      const unavailFact = (allChatFacts || []).find((uf) => {
        if (uf.fact_type !== "SHIFT_UNAVAILABILITY") return false;
        const p = uf.fact_payload || {};
        if (`${p.dow}|${p.from}|${p.to}` !== slotKey) return false;
        const unavailUser = UserDirectory.normalizeUserId(uf.user_id);
        return unavailUser === assignedUserId; // Must be the ASSIGNED user who's unavailable
      });

      if (!unavailFact) continue; // Assigned user didn't declare unavailability

      // Step 4: Unavailability must be newer than assignment
      const unavailTime = new Date(unavailFact.created_at || 0).getTime();
      const assignTime = new Date(assignmentFact.created_at || 0).getTime();
      if (unavailTime <= assignTime) continue;

      // Step 5: Check if already resolved by a SHIFT_REPLACEMENT
      const existingReplacement = (allChatFacts || []).find((rf) => {
        if (rf.fact_type !== "SHIFT_REPLACEMENT") return false;
        const p = rf.fact_payload || {};
        return `${p.dow}|${p.from}|${p.to}` === slotKey;
      });

      if (existingReplacement) continue; // Already resolved

      // All checks passed — auto-promote to SHIFT_REPLACEMENT
      const replacementPayload = { dow, from, to, user_id: normalizedAvailUserId };
      const replHash = createHash("sha256").update(
        `auto_replacement|${eventId}|${JSON.stringify(replacementPayload)}`
      ).digest("hex");

      const { error: replErr } = await supabase.from("facts").upsert([{
        event_id: eventId,
        trace_id: inserted.trace_id,
        chat_id: inserted.chat_id,
        user_id: normalizedAvailUserId,
        fact_type: "SHIFT_REPLACEMENT",
        fact_payload: replacementPayload,
        confidence: 1.0,
        status: "parsed",
        parser_version: "v0",
        fact_hash: replHash,
      }], { onConflict: "fact_hash" });

      if (replErr) {
        logger.error({ err: replErr }, "Failed to auto-promote AVAILABILITY to REPLACEMENT");
      } else {
        const replacementName = UserDirectory.getDisplayName(normalizedAvailUserId);
        const originalName = UserDirectory.getDisplayName(assignedUserId);
        const dayLabel = DOW_RU_MAP[dow] || dow;
        const slotLabel = getSlotLabel(from, to);
        await insertSystemEvent(
          inserted.chat_id,
          `✅ ${replacementName} заменяет ${originalName} в ${dayLabel} ${slotLabel}`
        );
        logger.info({ slot: slotKey, replacement: normalizedAvailUserId, original: assignedUserId },
          "Auto-promoted AVAILABILITY to REPLACEMENT");
      }
    }

    // 2c. After explicit SHIFT_REPLACEMENT: create confirmation message
    for (const f of factsPreview) {
      if (f.fact_type !== "SHIFT_REPLACEMENT") continue;
      const { dow, from, to } = f.fact_payload || {};
      if (!dow || !from || !to) continue;

      const replUserId = UserDirectory.normalizeUserId(inserted.user_id);
      const slotKey = `${dow}|${from}|${to}`;

      // Find who was unavailable for this slot
      const { data: chatFacts } = await supabase
        .from("facts")
        .select("*")
        .eq("chat_id", inserted.chat_id)
        .eq("fact_type", "SHIFT_UNAVAILABILITY")
        .order("created_at", { ascending: false })
        .limit(200);

      const unavailFact = (chatFacts || []).find((uf) => {
        const p = uf.fact_payload || {};
        return `${p.dow}|${p.from}|${p.to}` === slotKey;
      });

      if (unavailFact) {
        const originalUserId = UserDirectory.normalizeUserId(unavailFact.user_id);
        const replacementName = UserDirectory.getDisplayName(replUserId);
        const originalName = UserDirectory.getDisplayName(originalUserId);
        const dayLabel = DOW_RU_MAP[dow] || dow;
        const slotLabel = getSlotLabel(from, to);
        await insertSystemEvent(
          inserted.chat_id,
          `✅ ${replacementName} заменяет ${originalName} в ${dayLabel} ${slotLabel}`
        );
      }
    }
    // --- End replacement coordination ---

    // --- Extra work request: system message ---
    for (const f of factsPreview) {
      if (f.fact_type !== "EXTRA_WORK_REQUEST") continue;
      const { work_name, price } = f.fact_payload || {};
      if (!work_name) continue;
      const ewUserId = UserDirectory.normalizeUserId(inserted.user_id);
      const ewName = UserDirectory.getDisplayName(ewUserId);
      const priceStr = price ? ` (${price}\u20BD)` : "";
      await insertSystemEvent(
        inserted.chat_id,
        `\uD83D\uDCCB ${ewName} заявил(а): ${work_name}${priceStr}. Ожидает утверждения.`
      );
    }

    // --- Cleaning coordination: system messages + auto-promotion ---

    // 3a. After CLEANING_HELP_REQUEST: system message
    for (const f of factsPreview) {
      if (f.fact_type !== "CLEANING_HELP_REQUEST") continue;
      const { dow } = f.fact_payload || {};
      if (!dow) continue;

      const helpUserId = UserDirectory.normalizeUserId(inserted.user_id);
      const displayName = UserDirectory.getDisplayName(helpUserId);
      const dayLabel = DOW_RU_MAP[dow] || dow;
      await insertSystemEvent(
        inserted.chat_id,
        `⚠️ ${displayName} не может убраться в ${dayLabel}. Кто уберётся?`
      );
    }

    // 3b. After CLEANING_SWAP volunteer (no original_user_id): auto-promote if unresolved CLEANING_HELP_REQUEST
    for (const f of factsPreview) {
      if (f.fact_type !== "CLEANING_SWAP") continue;
      const { dow } = f.fact_payload || {};
      if (!dow) continue;

      // Only process volunteer offers (replacement_user_id is null, set from event.user_id)
      const volunteerId = UserDirectory.normalizeUserId(inserted.user_id);

      // Check if there's an unresolved CLEANING_HELP_REQUEST for this day from a different user
      const { data: allCleanFacts } = await supabase
        .from("facts")
        .select("*")
        .eq("chat_id", inserted.chat_id)
        .order("created_at", { ascending: false })
        .limit(500);

      const helpFact = (allCleanFacts || []).find((hf) => {
        if (hf.fact_type !== "CLEANING_HELP_REQUEST") return false;
        return hf.fact_payload?.dow === dow &&
          UserDirectory.normalizeUserId(hf.user_id) !== volunteerId;
      });

      if (!helpFact) continue;

      // Check if already resolved by another CLEANING_SWAP
      const existingSwap = (allCleanFacts || []).find((sf) => {
        if (sf.fact_type !== "CLEANING_SWAP") return false;
        if (sf.fact_payload?.dow !== dow) return false;
        // Must be a resolved swap (with replacement_user_id set)
        return sf.fact_payload?.replacement_user_id != null;
      });

      if (existingSwap) continue; // Already resolved

      const originalUserId = UserDirectory.normalizeUserId(helpFact.user_id);

      // Update the current CLEANING_SWAP fact to include the original user
      // (The fact already exists in DB, but we also need confirmation message)
      const volunteerName = UserDirectory.getDisplayName(volunteerId);
      const originalName = UserDirectory.getDisplayName(originalUserId);
      const dayLabel = DOW_RU_MAP[dow] || dow;
      await insertSystemEvent(
        inserted.chat_id,
        `✅ ${volunteerName} уберётся за ${originalName} в ${dayLabel}`
      );
      logger.info({ dow, volunteer: volunteerId, original: originalUserId },
        "Cleaning auto-promotion: volunteer matched help request");
    }

    // 3c. After explicit CLEANING_SWAP (with original_user_id): confirmation message
    for (const f of factsPreview) {
      if (f.fact_type !== "CLEANING_SWAP") continue;
      const { dow, original_user_id, replacement_user_id } = f.fact_payload || {};
      if (!dow) continue;
      // Only for explicit swaps where both parties are identified
      if (!original_user_id && !replacement_user_id) continue;

      const volunteerId = replacement_user_id
        ? UserDirectory.normalizeUserId(replacement_user_id)
        : UserDirectory.normalizeUserId(inserted.user_id);
      const originalId = original_user_id
        ? UserDirectory.normalizeUserId(original_user_id)
        : null;

      if (originalId && volunteerId !== originalId) {
        const volunteerName = UserDirectory.getDisplayName(volunteerId);
        const originalName = UserDirectory.getDisplayName(originalId);
        const dayLabel = DOW_RU_MAP[dow] || dow;
        await insertSystemEvent(
          inserted.chat_id,
          `✅ ${volunteerName} уберётся за ${originalName} в ${dayLabel}`
        );
      }
    }
    // 3d. Check cleaning_schedule for CLEANING_DONE/CLEANING_SWAP on unscheduled days → system warning
    const cleaningFactTypes = ["CLEANING_DONE", "CLEANING_SWAP"];
    for (const f of factsPreview) {
      if (!cleaningFactTypes.includes(f.fact_type)) continue;
      const { dow } = f.fact_payload || {};
      if (!dow) continue;

      try {
        const tenantId = inserted.meta?.tenant_id || process.env.DEFAULT_TENANT_ID || "dev";
        const allSettings = await settingsService.getAll(tenantId);
        const cleaningSchedule = allSettings?.["cleaning_schedule"] || {};
        const daySchedule = cleaningSchedule[dow];
        const isScheduled = daySchedule?.evening !== false;

        if (!isScheduled) {
          const dayLabel = DOW_RU_MAP[dow] || dow;
          await insertSystemEvent(
            inserted.chat_id,
            `\u26A0\uFE0F Уборка в ${dayLabel} не запланирована. Записано как нештатная.`
          );
        }
      } catch (schedErr) {
        logger.debug({ err: schedErr }, "cleaning_schedule check error");
      }
    }
    // --- End cleaning coordination ---

  } catch (factsUnexpectedErr) {
    factsPersistError = String(factsUnexpectedErr.message || factsUnexpectedErr);
    logger.error({ err: factsUnexpectedErr }, "INGEST unexpected error while parsing/inserting facts");
  }

  const total_ms = Date.now() - startedAt;

  return {
    event: inserted,
    event_id: eventId,
    facts,
    facts_preview: factsPreview,
    facts_written: factsWritten,
    persisted_facts_count: facts.length,
    facts_persist_error: factsPersistError || undefined,
    timings: {
      persist_event_ms,
      parse_ms,
      persist_facts_ms,
      total_ms,
    },
  };
}

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     tags: [System]
 *     security: []
 *     responses:
 *       200:
 *         description: Server is healthy
 */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    env: envName,
    time: new Date().toISOString(),
    paraplan: {
      mode: USE_EMOGEN_PARAPLAN ? "emogen" : "direct",
      ready: USE_EMOGEN_PARAPLAN ? !!EMOGEN_API_URL : paraplan.isReady(),
    },
  });
});

// Telegram webhook endpoint (used in production instead of polling)
// Registered dynamically after bot is created — see bot startup below.

/**
 * @openapi
 * /ingest:
 *   post:
 *     summary: Ingest a chat message event
 *     tags: [Ingest]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [chat_id, user_id, text]
 *             properties:
 *               source: { type: string, example: emu }
 *               tenant_id: { type: string, example: dev }
 *               chat_id: { type: string, example: chat_123 }
 *               user_id: { type: string, example: u1 }
 *               text: { type: string, example: "AVAIL mon 10-13" }
 *               meta: { type: object }
 *     responses:
 *       200:
 *         description: Event ingested successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
app.post("/ingest", ingestLimiter, validateBody(IngestSchema), async (req, res) => {
  const contentType = req.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return res.status(400).json({ ok: false, error: "content-type must be application/json" });
  }

  try {
    const body = req.body || {};
    const traceId = req.get("x-trace-id") || randomUUID();

    const result = await ingestInternal({
      source: body.source ?? "emu",
      chat_id: body.chat_id,
      user_id: body.user_id,
      text: body.text,
      meta: body.meta,
      tenant_id: body.tenant_id,
      traceId,
    });

    return res.status(200).json({
      ok: true,
      trace_id: result.event.trace_id,
      received_at: result.event.received_at,
      event_id: result.event_id,
    });
  } catch (err) {
    if (err.message && err.message.includes("chat_id and user_id")) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    logger.error({ err }, "INGEST unexpected error");
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
logger.debug("POST /ingest route registered");

/**
 * @openapi
 * /parse/{eventId}:
 *   post:
 *     summary: Parse a stored event into facts
 *     tags: [Parse]
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Facts created
 *       404:
 *         description: Event not found
 */
app.post("/parse/:eventId", validateParams(ParseEventParamsSchema), async (req, res) => {
  const eventId = Number.parseInt(req.params.eventId, 10);
  if (Number.isNaN(eventId)) {
    return res.status(400).json({ ok: false, error: "invalid event id" });
  }

  const { data: event, error } = await supabase
    .from("events")
    .select("id, trace_id, chat_id, user_id, text, meta, received_at")
    .eq("id", eventId)
    .single();

  if (error && error.code === "PGRST116") {
    return res.status(404).json({ ok: false, error: "event not found" });
  }
  if (error || !event) {
    logger.error({ err: error }, "PARSE failed to load event");
    return res.status(500).json({ ok: false, error: "failed to load event" });
  }

  const facts = parseEventToFacts(event);

  if (facts.length > 0) {
    const rows = facts.map((f) => ({
      event_id: event.id,
      trace_id: event.trace_id,
      chat_id: event.chat_id,
      user_id: event.user_id,
      fact_type: f.fact_type,
      fact_payload: f.fact_payload,
      confidence: f.confidence,
      status: "draft",
      parser_version: "v0",
    }));

    const { error: insertError } = await supabase.from("facts").insert(rows);
    if (insertError) {
      logger.error({ err: insertError }, "PARSE failed to insert facts");
      return res.status(500).json({ ok: false, error: "failed to persist facts" });
    }
  }

  const { error: updateError } = await supabase
    .from("events")
    .update({ status: "parsed" })
    .eq("id", event.id);

  if (updateError) {
    logger.error({ err: updateError }, "PARSE failed to update event status");
  }

  return res.json({
    ok: true,
    event_id: event.id,
    created_facts_count: facts.length,
    facts_preview: facts.slice(0, 5),
  });
});

/**
 * @openapi
 * /facts:
 *   get:
 *     summary: List facts with optional filters
 *     tags: [Facts]
 *     parameters:
 *       - in: query
 *         name: chat_id
 *         schema: { type: string }
 *       - in: query
 *         name: user_id
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, maximum: 200 }
 *     responses:
 *       200:
 *         description: List of facts
 */
app.get("/facts", validateQuery(FactsQuerySchema), async (req, res) => {
  const { chat_id: chatId, user_id: userId, status, limit } = req.query;

  let n = Number.parseInt(limit, 10);
  if (Number.isNaN(n) || n <= 0) n = 50;
  if (n > 200) n = 200;

  let query = supabase
    .from("facts")
    .select(
      "id, event_id, trace_id, chat_id, user_id, fact_type, fact_payload, confidence, status, parser_version, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(n);

  if (chatId) query = query.eq("chat_id", chatId);
  if (userId) query = query.eq("user_id", userId);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error }, "FACTS failed to load facts");
    return res.status(500).json({ ok: false, error: "failed to load facts" });
  }

  return res.json({ ok: true, facts: data ?? [] });
});

/**
 * @openapi
 * /events:
 *   get:
 *     summary: List events with optional filters
 *     tags: [Events]
 *     parameters:
 *       - in: query
 *         name: chat_id
 *         schema: { type: string }
 *       - in: query
 *         name: trace_id
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, maximum: 200 }
 *     responses:
 *       200:
 *         description: List of events
 */
app.get("/events", validateQuery(EventsQuerySchema), async (req, res) => {
  const { chat_id: chatId, trace_id: traceId, limit } = req.query;

  let n = Number.parseInt(limit, 10);
  if (Number.isNaN(n) || n <= 0) n = 50;
  if (n > 200) n = 200;

  let query = supabase
    .from("events")
    .select("id, trace_id, source, chat_id, user_id, text, meta, status, received_at")
    .order("received_at", { ascending: false })
    .limit(n);

  if (chatId) query = query.eq("chat_id", chatId);
  if (traceId) query = query.eq("trace_id", traceId);

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error }, "EVENTS failed to load events");
    return res.status(500).json({ ok: false, error: "failed to load events" });
  }

  return res.json({ ok: true, events: data ?? [] });
});
// --- DEBUG ROUTES (Chat Simulator) ---
// Быстрый smoke-check:
//   curl -s http://127.0.0.1:3000/debug/tenants
//   curl -s "http://127.0.0.1:3000/debug/dialogs?tenant_id=emu"
//   curl -s "http://127.0.0.1:3000/debug/dialog/debug_chat?tenant_id=emu"
// /__ping для простого health-check симулятора
app.get("/__ping", (req, res) => {
  res.status(200).json({ ok: true, entry: import.meta.url, cwd: process.cwd() });
});
logger.debug("__ping route registered");

/**
 * @openapi
 * /debug/tenants:
 *   get:
 *     summary: List all known tenants
 *     tags: [Debug]
 *     responses:
 *       200:
 *         description: Array of tenant objects
 */
app.get("/debug/tenants", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("events")
      .select("meta, source")
      .limit(2000);

    if (error) throw error;

    const tenantSet = new Set();
    for (const row of data || []) {
      const tenantId = row.meta?.tenant_id || row.source;
      if (tenantId) {
        tenantSet.add(tenantId);
      }
    }

    const tenants = Array.from(tenantSet).slice(0, 50);
    res.status(200).json({ tenants: tenants.map((t) => ({ tenant_id: t })) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * @openapi
 * /debug/dialogs:
 *   get:
 *     summary: List dialogs for a tenant
 *     tags: [Debug]
 *     parameters:
 *       - in: query
 *         name: tenant_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of dialogs
 */
app.get("/debug/dialogs", validateQuery(DialogsQuerySchema), async (req, res) => {
  try {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

    const { data, error } = await supabase
      .from("events")
      .select("chat_id, received_at, text, meta, source")
      .order("received_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    // Фильтруем в памяти: (meta.tenant_id == tenant_id) OR (если meta.tenant_id нет, то source == tenant_id)
    const filtered = (data || []).filter((row) => {
      const rowTenantId = row.meta?.tenant_id || row.source;
      return rowTenantId === tenant_id;
    });

    const map = new Map();
    for (const row of filtered) {
      if (!row.chat_id) continue;
      if (!map.has(row.chat_id)) {
        map.set(row.chat_id, {
          chat_id: row.chat_id,
          last_ts: row.received_at,
          last_text: row.text,
        });
      }
      if (map.size >= 50) break;
    }

    res.status(200).json({ dialogs: Array.from(map.values()) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * @openapi
 * /debug/dialog/{chat_id}:
 *   get:
 *     summary: Get events for a specific dialog
 *     tags: [Debug]
 *     parameters:
 *       - in: path
 *         name: chat_id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: tenant_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Events in the dialog
 */
app.get("/debug/dialog/:chat_id", validateParams(DialogParamsSchema), validateQuery(DialogQuerySchema), async (req, res) => {
  try {
    const tenant_id = req.query.tenant_id;
    const chat_id = req.params.chat_id;
    if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

    // Filter at DB level: match source OR meta->tenant_id, take latest 500
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("chat_id", chat_id)
      .or(`source.eq.${tenant_id},meta->>tenant_id.eq.${tenant_id}`)
      .order("received_at", { ascending: true })
      .limit(500);

    if (error) throw error;

    // Also load facts for these events so UI can show badges
    const eventIds = (data || []).map((e) => e.id);
    let facts = [];
    if (eventIds.length > 0) {
      const { data: factsData } = await supabase
        .from("facts")
        .select("*")
        .in("event_id", eventIds)
        .order("created_at", { ascending: true })
        .limit(2000);
      facts = factsData || [];
    }

    res.status(200).json({ events: data || [], facts });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
// --- /DEBUG ROUTES ---

/**
 * @openapi
 * /debug/send:
 *   post:
 *     summary: Send a message via the full ingest flow (debug)
 *     tags: [Debug]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [chat_id, user_id, text]
 *             properties:
 *               tenant_id: { type: string }
 *               source: { type: string, default: emu }
 *               chat_id: { type: string }
 *               user_id: { type: string }
 *               text: { type: string }
 *               meta: { type: object }
 *     responses:
 *       200:
 *         description: Ingest result with parsed facts
 */
app.post("/debug/send", ingestLimiter, validateBody(DebugSendSchema), async (req, res) => {
  const contentType = req.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return res.status(400).json({ ok: false, error: "content-type must be application/json" });
  }

  const body = req.body || {};
  // source остается как fallback, tenant_id сохраняется в meta.tenant_id
  const source = body.source ?? "emu";
  const traceId = req.get("x-trace-id") || body.trace_id || randomUUID();

  try {
    const result = await ingestInternal({
      source,
      chat_id: body.chat_id,
      user_id: body.user_id,
      text: body.text,
      meta: body.meta,
      tenant_id: body.tenant_id,
      traceId,
    });

    // Check for past-day SHIFT_AVAILABILITY and insert warning system messages
    const DOW_RU_WARN = { mon: "Понедельник", tue: "Вторник", wed: "Среда", thu: "Четверг", fri: "Пятница", sat: "Суббота", sun: "Воскресенье" };
    const DOW_OFFSET_WARN = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
    for (const f of (result.facts_preview || [])) {
      if (f.fact_type !== "SHIFT_AVAILABILITY") continue;
      const { dow } = f.fact_payload || {};
      if (!dow) continue;

      // Find the week_start from recent facts for this chat to compute the date
      const { data: recentWeekFacts } = await supabase
        .from("facts")
        .select("fact_payload")
        .eq("chat_id", body.chat_id)
        .in("fact_type", ["WEEK_OPEN", "SHIFT_ASSIGNMENT", "SHIFT_AVAILABILITY"])
        .order("created_at", { ascending: false })
        .limit(50);

      let weekStart = null;
      for (const rf of (recentWeekFacts || [])) {
        if (rf.fact_payload?.week_start) {
          weekStart = rf.fact_payload.week_start;
          break;
        }
      }
      if (!weekStart) continue;

      const wsDate = new Date(weekStart + "T00:00:00");
      const slotDate = new Date(wsDate);
      slotDate.setDate(slotDate.getDate() + (DOW_OFFSET_WARN[dow] || 0));
      slotDate.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (slotDate.getTime() < today.getTime()) {
        const dateStr = slotDate.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
        const dowRu = DOW_RU_WARN[dow] || dow;
        const warnText = `⚠️ ${dowRu} (${dateStr}) уже прошёл. Изменение принято, но требует подтверждения.`;
        const sysEvent = {
          trace_id: randomUUID(),
          source: source,
          chat_id: body.chat_id,
          user_id: "system",
          text: warnText,
          role: "system",
          meta: { system_message: true, ...(body.tenant_id ? { tenant_id: body.tenant_id } : {}) },
          status: "received",
          received_at: new Date().toISOString(),
        };
        await supabase.from("events").insert(sysEvent);
        logger.info({ dow, date: dateStr }, "Past-day SHIFT_AVAILABILITY warning inserted");
        break; // one warning per message is enough
      }
    }

    // Загружаем полный event и persisted facts из БД для прозрачности
    const { data: eventData, error: eventErr } = await supabase
      .from("events")
      .select("*")
      .eq("id", result.event_id)
      .single();

    const { data: persistedFacts, error: factsErr } = await supabase
      .from("facts")
      .select("*")
      .eq("event_id", result.event_id)
      .order("created_at", { ascending: true });

    // ingestInternal уже возвращает все нужные поля, но загружаем из БД для гарантии
    return res.status(200).json({
      ok: true,
      event: eventData || result.event,
      facts_preview: result.facts_preview,
      facts_written: result.facts_written,
      persisted_facts_count: persistedFacts?.length ?? result.persisted_facts_count ?? 0,
      facts: persistedFacts || result.facts || [],
      facts_persist_error: result.facts_persist_error || undefined,
    });
  } catch (e) {
    if (e.message && e.message.includes("chat_id and user_id")) {
      return res.status(400).json({ ok: false, error: e.message });
    }
    logger.error({ err: e }, "debug/send error");
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
logger.debug("POST /debug/send route registered");

/**
 * @openapi
 * /debug/schedule:
 *   get:
 *     summary: Build draft schedule from facts
 *     tags: [Debug]
 *     parameters:
 *       - in: query
 *         name: tenant_id
 *         schema: { type: string }
 *       - in: query
 *         name: chat_id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: week_start
 *         schema: { type: string, format: date, example: "2025-01-06" }
 *     responses:
 *       200:
 *         description: Draft schedule with slots, assignments, gaps
 */
/**
 * GET /debug/weeks?chat_id=...
 * Returns distinct week_start values found in facts for this chat.
 */
/**
 * POST /debug/seed — trigger dev seed loading (for welcome screen button)
 */
app.post("/debug/seed", async (req, res) => {
  try {
    // Re-import to get fresh reference
    const { runDevSeed: runSeed, SEED_CHAT_ID: seedChatId, SEED_WEEK: seedWeek } = await import("./devSeed.js");
    const tenantId = process.env.DEFAULT_TENANT_ID || "dev";

    const seedBuild = async (chatId, weekStart) => {
      const slotTypes = await loadSlotTypes(tenantId);
      const seedSettings = await settingsService.getAll(tenantId);
      const { data: facts } = await supabase
        .from("facts").select("*").eq("chat_id", chatId)
        .order("created_at", { ascending: true }).limit(500);
      logger.info("seedBuild: found %d facts for chat %s, building schedule for week %s", (facts || []).length, chatId, weekStart);
      const schedule = buildDraftSchedule({ facts: facts ?? [], weekStartISO: weekStart, slotTypes, settings: seedSettings });
      logger.info("seedBuild: schedule produced %d assignments", (schedule.assignments || []).length);
      const DOW_ORDER_MAP = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
      const rows = [];
      for (const a of schedule.assignments || []) {
        const dayOffset = DOW_ORDER_MAP[a.dow] || 0;
        const d = new Date(weekStart + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + dayOffset);
        const fp = { week_start: weekStart, date: d.toISOString().slice(0, 10), dow: a.dow, from: a.from, to: a.to, assigned_user_id: a.user_id, replaced_user_id: a.replaced_user_id || null, reason: a.reason || "auto-assigned" };
        const fh = createHash("sha256").update(`SHIFT_ASSIGNMENT|${JSON.stringify(fp)}|v0`).digest("hex");
        rows.push({ trace_id: `seed-api-${Date.now()}`, chat_id: chatId, user_id: "admin1", fact_type: "SHIFT_ASSIGNMENT", fact_payload: fp, confidence: 1.0, status: "parsed", parser_version: "v0", fact_hash: fh });
      }
      if (rows.length > 0) {
        const { error: upsertErr } = await supabase.from("facts").upsert(rows, { onConflict: "fact_hash" });
        if (upsertErr) logger.error({ err: upsertErr }, "seedBuild: upsert error");
        else logger.info("seedBuild: persisted %d SHIFT_ASSIGNMENT facts", rows.length);
      } else {
        logger.warn("seedBuild: no assignments to persist");
      }
    };

    await runSeed(ingestInternal, seedBuild, { force: true });
    res.json({ ok: true, chat_id: seedChatId, week: seedWeek });
  } catch (e) {
    logger.error({ err: e }, "POST /debug/seed error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * POST /debug/reset-week — delete all facts and events for a specific week
 */
app.post("/debug/reset-week", async (req, res) => {
  try {
    const chatId = req.body.chat_id || req.query.chat_id || "dev_seed_chat";
    const weekStart = req.body.week_start || req.query.week_start;
    if (!weekStart) return res.status(400).json({ error: "week_start required" });

    // Calculate week end (Monday + 6 days = Sunday)
    const wsDate = new Date(weekStart + "T00:00:00Z");
    const weDate = new Date(wsDate);
    weDate.setUTCDate(weDate.getUTCDate() + 6);
    const weekEnd = weDate.toISOString().slice(0, 10);

    logger.info("POST /debug/reset-week: chat=%s, week=%s..%s", chatId, weekStart, weekEnd);

    // Delete facts: those with week_start matching OR date within the week range
    const { data: factsToDelete } = await supabase
      .from("facts")
      .select("id, fact_type, fact_payload")
      .eq("chat_id", chatId);

    const idsToDelete = (factsToDelete || [])
      .filter((f) => {
        const p = f.fact_payload || {};
        if (p.week_start === weekStart) return true;
        if (p.date && p.date >= weekStart && p.date <= weekEnd) return true;
        return false;
      })
      .map((f) => f.id);

    let factsDeleted = 0;
    if (idsToDelete.length > 0) {
      const { error: delErr } = await supabase.from("facts").delete().in("id", idsToDelete);
      if (delErr) logger.error({ err: delErr }, "reset-week: facts delete error");
      else factsDeleted = idsToDelete.length;
    }

    // Delete events for this chat (simple approach: delete events whose text references the week)
    const { data: eventsDeleted, error: evErr } = await supabase
      .from("events")
      .delete()
      .eq("chat_id", chatId)
      .select("id");
    if (evErr) logger.error({ err: evErr }, "reset-week: events delete error");

    logger.info("POST /debug/reset-week: deleted %d facts, %d events", factsDeleted, (eventsDeleted || []).length);
    res.json({ ok: true, facts_deleted: factsDeleted, events_deleted: (eventsDeleted || []).length });
  } catch (e) {
    logger.error({ err: e }, "POST /debug/reset-week error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * POST /api/reset-week — reset week data and create WEEK_OPEN for fresh start
 * Body/query: { week_start: "2026-03-09", chat_id?: string }
 */
app.post("/api/reset-week", async (req, res) => {
  try {
    const chatId = req.body.chat_id || req.query.chat_id || "dev_seed_chat";
    const weekStart = req.body.week_start || req.query.week_start;
    if (!weekStart) return res.status(400).json({ error: "week_start required (YYYY-MM-DD)" });

    const wsDate = new Date(weekStart + "T00:00:00Z");
    const weDate = new Date(wsDate);
    weDate.setUTCDate(weDate.getUTCDate() + 6);
    const weekEnd = weDate.toISOString().slice(0, 10);

    logger.info("POST /api/reset-week: chat=%s, week=%s..%s", chatId, weekStart, weekEnd);

    // 1. Delete facts for this week
    const { data: factsToDelete } = await supabase
      .from("facts")
      .select("id, fact_type, fact_payload")
      .eq("chat_id", chatId);

    const idsToDelete = (factsToDelete || [])
      .filter((f) => {
        const p = f.fact_payload || {};
        if (p.week_start === weekStart) return true;
        if (p.date && p.date >= weekStart && p.date <= weekEnd) return true;
        return false;
      })
      .map((f) => f.id);

    let factsDeleted = 0;
    if (idsToDelete.length > 0) {
      const { error: delErr } = await supabase.from("facts").delete().in("id", idsToDelete);
      if (delErr) logger.error({ err: delErr }, "api/reset-week: facts delete error");
      else factsDeleted = idsToDelete.length;
    }

    // 2. Create WEEK_OPEN fact
    const weekOpenPayload = { week_start: weekStart, status: "collecting" };
    const weekOpenHash = createHash("sha256").update(`WEEK_OPEN|${JSON.stringify(weekOpenPayload)}|reset`).digest("hex");
    await supabase.from("facts").upsert([{
      trace_id: `reset-week-${Date.now()}`,
      chat_id: chatId,
      user_id: "system",
      fact_type: "WEEK_OPEN",
      fact_payload: weekOpenPayload,
      confidence: 1.0,
      status: "parsed",
      parser_version: "v0",
      fact_hash: weekOpenHash,
    }], { onConflict: "fact_hash" });

    // 3. Insert system message
    const mondayStr = wsDate.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
    const sundayStr = weDate.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
    await supabase.from("events").insert({
      trace_id: randomUUID(),
      source: "system",
      chat_id: chatId,
      user_id: "system",
      text: `\uD83D\uDD04 Неделя ${mondayStr}\u2013${sundayStr} обнулена. Сбор графика начат заново.`,
      role: "system",
      meta: { system_message: true },
      status: "received",
      received_at: new Date().toISOString(),
    });

    logger.info("POST /api/reset-week: deleted %d facts, WEEK_OPEN created for %s", factsDeleted, weekStart);
    res.json({ ok: true, facts_deleted: factsDeleted, week_start: weekStart, status: "collecting" });
  } catch (e) {
    logger.error({ err: e }, "POST /api/reset-week error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/debug/weeks", async (req, res) => {
  try {
    const chatId = req.query.chat_id;
    if (!chatId) return res.status(400).json({ error: "chat_id required" });

    const { data: facts, error } = await supabase
      .from("facts")
      .select("fact_payload")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    const weeks = new Set();
    for (const f of facts || []) {
      const ws = f.fact_payload?.week_start;
      if (ws && typeof ws === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ws)) {
        weeks.add(ws);
      }
    }

    const sorted = [...weeks].sort().reverse(); // newest first
    res.json({ ok: true, weeks: sorted });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/debug/schedule", validateQuery(ScheduleQuerySchema), async (req, res) => {
  try {
    const { tenant_id, chat_id, week_start } = req.query;
    if (!chat_id) {
      return res.status(400).json({ error: "chat_id required" });
    }

    const weekStartISO =
      week_start ??
      new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString().slice(0, 10);

    const { data: facts, error } = await supabase
      .from("facts")
      .select("*")
      .eq("chat_id", chat_id)
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) throw error;

    // Diagnostic: analyze facts format
    const counts_by_type = {};
    const sample_by_type = {};
    const availability_values_set = new Set();
    let slots_extracted_count = 0;

    for (const f of facts || []) {
      const t = f.fact_type || "UNKNOWN";
      counts_by_type[t] = (counts_by_type[t] || 0) + 1;

      if (!sample_by_type[t] && f.fact_payload) {
        sample_by_type[t] = f.fact_payload;
      }

      const p = f.fact_payload || {};
      if (p.availability != null) availability_values_set.add(String(p.availability));

      if (typeof p.dow === "string" && typeof p.from === "string" && typeof p.to === "string") {
        slots_extracted_count += 1;
      }
    }

    const availability_values = Array.from(availability_values_set);

    const slotTypes = await loadSlotTypes(tenant_id);
    const tenantSettings = await settingsService.getAll(tenant_id || "dev");
    const schedule = buildDraftSchedule({
      facts: facts ?? [],
      weekStartISO,
      slotTypes,
      settings: tenantSettings,
    });

    // Extend meta with diagnostics
    schedule.meta = {
      ...(schedule.meta || {}),
      counts_by_type,
      sample_by_type,
      availability_values,
      slots_extracted_count,
      paraplan_ready: paraplan.isReady(),
      paraplan_updated_at: paraplan.getLastUpdate(),
    };

    res.json(schedule);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
logger.debug("GET /debug/schedule route registered");

/**
 * @openapi
 * /debug/week_state:
 *   get:
 *     summary: Compute week state from facts
 *     tags: [Debug]
 *     parameters:
 *       - in: query
 *         name: chat_id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: week_start
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Week state (COLLECTING, ACTIVE, CLOSED)
 */
app.get("/debug/week_state", validateQuery(ScheduleQuerySchema), async (req, res) => {
  try {
    const { chat_id, week_start } = req.query;
    if (!chat_id) {
      return res.status(400).json({ error: "chat_id required" });
    }

    const weekStartISO =
      week_start ??
      new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString().slice(0, 10);

    const { data: facts, error } = await supabase
      .from("facts")
      .select("*")
      .eq("chat_id", chat_id)
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) throw error;

    // Filter facts to this week
    const filteredFacts = (facts || []).filter((f) => {
      // WEEK_* and SCHEDULE_BUILT facts: check week_start in payload
      if (f.fact_type?.startsWith("WEEK_") || f.fact_type === "SCHEDULE_BUILT") {
        return f.fact_payload?.week_start === weekStartISO;
      }

      // Facts with week_start but no date: filter by week_start
      if (f.fact_payload?.week_start && !f.fact_payload?.date) {
        return f.fact_payload.week_start === weekStartISO;
      }

      // Facts with date: check if date is in week range
      if (f.fact_payload?.date) {
        const factDate = f.fact_payload.date;
        const weekStart = new Date(weekStartISO);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const factDateObj = new Date(factDate);
        return factDateObj >= weekStart && factDateObj <= weekEnd;
      }

      // Facts without date or week_start: include them
      return true;
    });

    const weekState = computeWeekState({ facts: filteredFacts, weekStartISO });
    const slotTypesWS = await loadSlotTypes(req.query.tenant_id);
    const tenantSettingsWS = await settingsService.getAll(req.query.tenant_id || "dev");
    const draftSchedule = buildDraftSchedule({
      facts: filteredFacts,
      weekStartISO,
      slotTypes: slotTypesWS,
      settings: tenantSettingsWS,
    });

    // Compute hasProblem: gaps in schedule or empty slots
    const hasGaps = Boolean(
      weekState.hasGaps ||
      (draftSchedule.gaps && draftSchedule.gaps.length > 0) ||
      (draftSchedule.slots && Array.isArray(draftSchedule.slots) && draftSchedule.slots.some((s) => s && s.status === "EMPTY"))
    );
    const hasProblem = hasGaps;

    res.json({
      week_state: { ...weekState, hasProblem, hasGaps },
      schedule: draftSchedule,
      hasProblem,
      meta: {
        facts_count: facts?.length || 0,
      },
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
logger.debug("GET /debug/week_state route registered");

/**
 * @openapi
 * /debug/build-schedule:
 *   post:
 *     summary: Build schedule and persist SHIFT_ASSIGNMENT facts
 *     tags: [Debug]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [chat_id, user_id]
 *             properties:
 *               chat_id: { type: string }
 *               user_id: { type: string }
 *               week_start: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Built schedule with assignment counts
 */
app.post("/debug/build-schedule", validateBody(BuildScheduleSchema), async (req, res) => {
  try {
    const { chat_id, week_start, user_id } = req.body;
    if (!chat_id) {
      return res.status(400).json({ error: "chat_id required" });
    }
    if (!user_id) {
      return res.status(400).json({ error: "user_id required (who is building the schedule)" });
    }

    const weekStartISO =
      week_start ??
      new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString().slice(0, 10);

    // Load facts for this week
    const { data: facts, error: factsError } = await supabase
      .from("facts")
      .select("*")
      .eq("chat_id", chat_id)
      .order("created_at", { ascending: true })
      .limit(500);

    if (factsError) throw factsError;

    // Filter facts to this week
    const filteredFacts = (facts || []).filter((f) => {
      if (f.fact_type?.startsWith("WEEK_") || f.fact_type === "SCHEDULE_BUILT") {
        return f.fact_payload?.week_start === weekStartISO;
      }
      if (f.fact_payload?.week_start && !f.fact_payload?.date) {
        return f.fact_payload.week_start === weekStartISO;
      }
      if (f.fact_payload?.date) {
        const factDate = f.fact_payload.date;
        const weekStart = new Date(weekStartISO);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const factDateObj = new Date(factDate);
        return factDateObj >= weekStart && factDateObj <= weekEnd;
      }
      return true;
    });

    // Build draft schedule using ScheduleEngine
    const slotTypesBS = await loadSlotTypes(req.body.tenant_id);
    const tenantSettingsBS = await settingsService.getAll(req.body.tenant_id || "dev");
    const draftSchedule = buildDraftSchedule({
      facts: filteredFacts,
      weekStartISO,
      slotTypes: slotTypesBS,
      settings: tenantSettingsBS,
    });

    // Create a system event for this build operation
    const traceId = `build-schedule-${Date.now()}`;
    const systemEvent = {
      trace_id: traceId,
      source: "system",
      chat_id: chat_id,
      user_id: user_id,
      text: `BUILD_SCHEDULE ${weekStartISO}`,
      role: "admin",
      meta: { action: "build_schedule", week_start: weekStartISO },
      status: "received",
      received_at: new Date().toISOString(),
    };

    // Insert system event
    const { data: insertedEvent, error: eventError } = await supabase
      .from("events")
      .insert(systemEvent)
      .select("id")
      .single();

    if (eventError) {
      logger.error({ err: eventError }, "BUILD_SCHEDULE failed to create system event");
      throw new Error("Failed to create system event");
    }

    const eventId = insertedEvent.id;

    // Create SHIFT_ASSIGNMENT facts for all assignments (if they don't already exist)
    const assignmentsToCreate = [];

    for (const assignment of draftSchedule.assignments || []) {
      // Check if assignment already exists (to avoid duplicates)
      const slotKey = `${assignment.dow}|${assignment.from}|${assignment.to}`;
      const existingAssignment = filteredFacts.find(
        (f) =>
          f.fact_type === "SHIFT_ASSIGNMENT" &&
          f.fact_payload?.dow === assignment.dow &&
          f.fact_payload?.from === assignment.from &&
          f.fact_payload?.to === assignment.to &&
          f.fact_payload?.assigned_user_id === assignment.user_id
      );

      if (!existingAssignment) {
        // Calculate date from week_start + dow
        const DOW_ORDER = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
        const dayOffset = DOW_ORDER[assignment.dow] || 0;
        const weekStartDate = new Date(weekStartISO + "T00:00:00Z");
        weekStartDate.setUTCDate(weekStartDate.getUTCDate() + dayOffset);
        const date = weekStartDate.toISOString().slice(0, 10);

        // Generate fact_hash for idempotency
        const factPayload = {
          week_start: weekStartISO,
          date,
          dow: assignment.dow,
          from: assignment.from,
          to: assignment.to,
          assigned_user_id: assignment.user_id,
          replaced_user_id: assignment.replaced_user_id || null,
          reason: assignment.reason || "auto-assigned",
        };
        const hashInput = `SHIFT_ASSIGNMENT|${JSON.stringify(factPayload)}|v0`;
        const factHash = createHash("sha256").update(hashInput).digest("hex");

        assignmentsToCreate.push({
          event_id: eventId,
          trace_id: traceId,
          chat_id: chat_id,
          user_id: user_id, // The person who built the schedule
          fact_type: "SHIFT_ASSIGNMENT",
          fact_payload: factPayload,
          confidence: 1.0,
          status: "parsed",
          parser_version: "v0",
          fact_hash: factHash,
        });
      }
    }

    // Persist assignments as facts
    let assignmentsCreated = 0;
    if (assignmentsToCreate.length > 0) {
      // Upsert facts (idempotent by fact_hash)
      const { data: insertedFacts, error: insertError } = await supabase
        .from("facts")
        .upsert(assignmentsToCreate, {
          onConflict: "fact_hash",
          ignoreDuplicates: false,
        })
        .select();

      if (insertError) {
        logger.error({ err: insertError }, "BUILD_SCHEDULE failed to insert assignments");
        // Continue anyway, return what we have
      } else {
        assignmentsCreated = insertedFacts?.length || 0;
        logger.info({ assignmentsCreated, event_id: eventId }, "BUILD_SCHEDULE created assignments");
      }
    } else {
      logger.info("BUILD_SCHEDULE no new assignments to create");
    }

    // Create SCHEDULE_BUILT fact to transition week state COLLECTING → ACTIVE
    const builtPayload = { week_start: weekStartISO, assignments_count: assignmentsCreated };
    const builtHash = createHash("sha256").update(`SCHEDULE_BUILT|${JSON.stringify(builtPayload)}|v0`).digest("hex");
    await supabase.from("facts").upsert([{
      event_id: eventId,
      trace_id: traceId,
      chat_id: chat_id,
      user_id: user_id,
      fact_type: "SCHEDULE_BUILT",
      fact_payload: builtPayload,
      confidence: 1.0,
      status: "parsed",
      parser_version: "v0",
      fact_hash: builtHash,
    }], { onConflict: "fact_hash" });
    logger.info("BUILD_SCHEDULE: created SCHEDULE_BUILT fact for week %s", weekStartISO);

    // IMPORTANT: Recalculate schedule after creating facts, so that new assignments have proper created_at timestamps
    // and slots show as PENDING (not CONFIRMED) by default
    let finalSchedule = draftSchedule;
    if (assignmentsCreated > 0) {
      // Reload facts to include newly created SHIFT_ASSIGNMENT facts
      const { data: updatedFacts, error: reloadError } = await supabase
        .from("facts")
        .select("*")
        .eq("chat_id", chat_id)
        .order("created_at", { ascending: true })
        .limit(500);

      if (!reloadError && updatedFacts) {
        // Filter facts to this week
        const updatedFilteredFacts = (updatedFacts || []).filter((f) => {
          if (f.fact_type?.startsWith("WEEK_")) {
            return f.fact_payload?.week_start === weekStartISO;
          }
          if (f.fact_payload?.date) {
            const factDate = f.fact_payload.date;
            const weekStart = new Date(weekStartISO);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);
            const factDateObj = new Date(factDate);
            return factDateObj >= weekStart && factDateObj <= weekEnd;
          }
          return true;
        });

        // Recalculate schedule with updated facts (now includes new SHIFT_ASSIGNMENT facts with created_at)
        finalSchedule = buildDraftSchedule({
          facts: updatedFilteredFacts,
          weekStartISO,
          slotTypes: slotTypesBS,
          settings: tenantSettingsBS,
        });
        logger.info({ facts_count: updatedFilteredFacts.length }, "BUILD_SCHEDULE recalculated schedule");
      }
    }

    res.json({
      ok: true,
      week_start: weekStartISO,
      schedule: finalSchedule,
      assignments_created: assignmentsCreated,
      assignments_total: finalSchedule.assignments?.length || 0,
      gaps: finalSchedule.gaps?.length || 0,
      conflicts: finalSchedule.conflicts?.length || 0,
      slots: finalSchedule.slots || [],
    });
  } catch (e) {
    logger.error({ err: e }, "BUILD_SCHEDULE error");
    res.status(500).json({ error: String(e?.message || e) });
  }
});
logger.debug("POST /debug/build-schedule route registered");

/**
 * @openapi
 * /api/week/{weekStartISO}/confirm-user:
 *   post:
 *     summary: Confirm schedule for a user
 *     tags: [Schedule]
 *     parameters:
 *       - in: path
 *         name: weekStartISO
 *         required: true
 *         schema: { type: string, format: date }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, chat_id]
 *             properties:
 *               user_id: { type: string }
 *               chat_id: { type: string }
 *     responses:
 *       200:
 *         description: Confirmation created, updated schedule returned
 */
app.post("/api/week/:weekStartISO/confirm-user", validateParams(ConfirmUserParamsSchema), validateBody(ConfirmUserBodySchema), async (req, res) => {
  try {
    const { weekStartISO } = req.params;
    const { user_id, chat_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: "user_id required" });
    }
    if (!chat_id) {
      return res.status(400).json({ error: "chat_id required" });
    }

    // Нормализуем user_id
    const normalizedUserId = UserDirectory.normalizeUserId(user_id);

    // Создаем факт подтверждения
    const eventId = randomUUID();
    const traceId = randomUUID();

    const factPayload = {
      week_start: weekStartISO,
      user_id: normalizedUserId,
    };

    const hashInput = `SCHEDULE_CONFIRMED|${JSON.stringify(factPayload)}|v0`;
    const factHash = createHash("sha256").update(hashInput).digest("hex");

    // Upsert факт подтверждения (idempotent)
    const { data: insertedFacts, error: insertError } = await supabase
      .from("facts")
      .upsert(
        [
          {
            event_id: eventId,
            trace_id: traceId,
            chat_id: chat_id,
            user_id: normalizedUserId,
            fact_type: "SCHEDULE_CONFIRMED",
            fact_payload: factPayload,
            confidence: 1.0,
            status: "parsed",
            parser_version: "v0",
            fact_hash: factHash,
          },
        ],
        {
          onConflict: "fact_hash",
          ignoreDuplicates: false,
        }
      )
      .select();

    if (insertError) {
      logger.error({ err: insertError }, "CONFIRM_USER failed to insert confirmation");
      return res.status(500).json({ error: String(insertError.message || insertError) });
    }

    // Пересчитываем график с новым фактом подтверждения
    const { data: allFacts, error: factsError } = await supabase
      .from("facts")
      .select("*")
      .eq("chat_id", chat_id)
      .order("created_at", { ascending: true })
      .limit(500);

    if (factsError) throw factsError;

    // Фильтруем факты для этой недели
    const filteredFacts = (allFacts || []).filter((f) => {
      if (f.fact_type?.startsWith("WEEK_")) {
        return f.fact_payload?.week_start === weekStartISO;
      }
      if (f.fact_payload?.date) {
        const factDate = f.fact_payload.date;
        const weekStart = new Date(weekStartISO);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const factDateObj = new Date(factDate);
        return factDateObj >= weekStart && factDateObj <= weekEnd;
      }
      if (f.fact_type === "SCHEDULE_CONFIRMED") {
        return f.fact_payload?.week_start === weekStartISO;
      }
      return true;
    });

    // Пересчитываем график
    const slotTypesCU = await loadSlotTypes(req.body.tenant_id);
    const tenantSettingsCU = await settingsService.getAll(req.body.tenant_id || "dev");
    const updatedSchedule = buildDraftSchedule({
      facts: filteredFacts,
      weekStartISO,
      slotTypes: slotTypesCU,
      settings: tenantSettingsCU,
    });

    res.json({
      ok: true,
      week_start: weekStartISO,
      user_id: normalizedUserId,
      schedule: updatedSchedule,
      confirmation_created: insertedFacts && insertedFacts.length > 0,
    });
  } catch (e) {
    logger.error({ err: e }, "CONFIRM_USER error");
    res.status(500).json({ error: String(e?.message || e) });
  }
});
logger.debug("POST /api/week/:weekStartISO/confirm-user route registered");

/**
 * @openapi
 * /debug/timesheet:
 *   get:
 *     summary: Compute timesheet from facts
 *     tags: [Debug]
 *     parameters:
 *       - in: query
 *         name: chat_id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: week_start
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Timesheet with hours, overtime, amounts
 */
app.get("/debug/timesheet", validateQuery(ScheduleQuerySchema), async (req, res) => {
  try {
    const { chat_id, week_start } = req.query;
    if (!chat_id) {
      return res.status(400).json({ error: "chat_id required" });
    }

    const weekStartISO =
      week_start ??
      new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString().slice(0, 10);

    // Load facts
    const { data: facts, error } = await supabase
      .from("facts")
      .select("*")
      .eq("chat_id", chat_id)
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) throw error;

    // Filter facts to this week
    const filteredFacts = (facts || []).filter((f) => {
      // WEEK_* and SCHEDULE_BUILT facts: check week_start in payload
      if (f.fact_type?.startsWith("WEEK_") || f.fact_type === "SCHEDULE_BUILT") {
        return f.fact_payload?.week_start === weekStartISO;
      }

      // Facts with week_start but no date: filter by week_start
      if (f.fact_payload?.week_start && !f.fact_payload?.date) {
        return f.fact_payload.week_start === weekStartISO;
      }

      // Facts with date: check if date is in week range
      if (f.fact_payload?.date) {
        const factDate = f.fact_payload.date;
        const weekStart = new Date(weekStartISO);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const factDateObj = new Date(factDate);
        return factDateObj >= weekStart && factDateObj <= weekEnd;
      }

      // Facts without date or week_start: include them
      return true;
    });

    // Build schedule first (needed for planned hours)
    const slotTypesTS = await loadSlotTypes(req.query.tenant_id);
    const tenantSettingsTS = await settingsService.getAll(req.query.tenant_id || "dev");
    const schedule = buildDraftSchedule({
      facts: filteredFacts,
      weekStartISO,
      slotTypes: slotTypesTS,
      settings: tenantSettingsTS,
    });

    // Hourly rates from UserDirectory
    const hourlyRates = UserDirectory.getAllHourlyRates();

    // Build timesheet
    const timesheet = buildTimesheet({
      facts: filteredFacts,
      weekStartISO,
      hourlyRates,
      schedule,
      settings: tenantSettingsTS,
    });

    // Role-based visibility: staff sees only their own row, director sees all
    const role = req.query.role;
    const viewUserId = req.query.user_id;
    let visibleTimesheet = timesheet;

    if (role === "staff" && viewUserId) {
      const filtered = timesheet.employees.filter((e) => e.user_id === viewUserId);
      // Staff should not see extra_pay (director bonuses) on their entries
      const cleaned = filtered.map((e) => {
        const { extra_pay, extra_pay_total, ...rest } = e;
        return { ...rest, extra_pay: [], extra_pay_total: 0 };
      });
      visibleTimesheet = {
        ...timesheet,
        employees: cleaned,
        totals: {
          total_hours: cleaned.reduce((s, e) => s + e.effective_hours, 0),
          total_cleanings: cleaned.reduce((s, e) => s + e.cleaning_count, 0),
          total_extra_classes: cleaned.reduce((s, e) => s + e.extra_classes_count, 0),
          total_extra_pay: cleaned.reduce((s, e) => s + (e.extra_classes_total_pay || 0), 0),
          total_pay: cleaned.reduce((s, e) => s + e.total_pay, 0),
        },
      };
    }

    res.json({
      week_start: weekStartISO,
      schedule,
      timesheet: visibleTimesheet,
    });
  } catch (e) {
    logger.error({ err: e, chat_id: req.query.chat_id, week_start: req.query.week_start }, "GET /debug/timesheet error");
    res.status(500).json({ error: String(e?.message || e) });
  }
});
logger.debug("GET /debug/timesheet route registered");

// --- Period-based timesheet (aggregates across multiple weeks) ---
app.get("/debug/timesheet-period", validateQuery(TimesheetPeriodQuerySchema), async (req, res) => {
  try {
    const { chat_id, period_start, period_end, role, user_id: viewUserId } = req.query;
    if (!chat_id) {
      return res.status(400).json({ error: "chat_id required" });
    }

    // Calculate all Monday week_starts that overlap with the period
    const pStart = new Date(period_start);
    const pEnd = new Date(period_end);
    const weekStarts = [];
    // Find the Monday on or before period_start
    const d = new Date(pStart);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
    while (d <= pEnd) {
      weekStarts.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 7);
    }

    // Load ALL facts for this chat (we'll filter per week)
    const { data: allFacts, error } = await supabase
      .from("facts")
      .select("*")
      .eq("chat_id", chat_id)
      .order("created_at", { ascending: true })
      .limit(2000);

    if (error) throw error;

    const slotTypesTS = await loadSlotTypes(req.query.tenant_id);
    const tenantSettingsTS = await settingsService.getAll(req.query.tenant_id || "dev");
    const hourlyRates = UserDirectory.getAllHourlyRates();

    // Build timesheet for each week, then aggregate
    const aggregated = new Map(); // user_id -> merged data

    for (const weekStartISO of weekStarts) {
      const weekEnd = new Date(weekStartISO);
      weekEnd.setDate(weekEnd.getDate() + 6);

      // Filter facts to this week
      const filteredFacts = (allFacts || []).filter((f) => {
        if (f.fact_type?.startsWith("WEEK_") || f.fact_type === "SCHEDULE_BUILT") {
          return f.fact_payload?.week_start === weekStartISO;
        }
        if (f.fact_payload?.week_start && !f.fact_payload?.date) {
          return f.fact_payload.week_start === weekStartISO;
        }
        if (f.fact_payload?.date) {
          const factDate = f.fact_payload.date;
          return factDate >= weekStartISO && factDate <= weekEnd.toISOString().slice(0, 10);
        }
        return true;
      });

      const schedule = buildDraftSchedule({
        facts: filteredFacts,
        weekStartISO,
        slotTypes: slotTypesTS,
        settings: tenantSettingsTS,
      });

      const ts = buildTimesheet({
        facts: filteredFacts,
        weekStartISO,
        hourlyRates,
        schedule,
        settings: tenantSettingsTS,
      });

      // Merge into aggregated
      for (const emp of ts.employees) {
        if (!aggregated.has(emp.user_id)) {
          aggregated.set(emp.user_id, { ...emp, weeks: 1 });
        } else {
          const a = aggregated.get(emp.user_id);
          a.shift_hours += emp.shift_hours;
          a.problem_shifts += emp.problem_shifts;
          a.problem_deduction_hours += emp.problem_deduction_hours;
          a.effective_hours += emp.effective_hours;
          a.shift_pay += emp.shift_pay;
          a.cleaning_count += emp.cleaning_count;
          a.cleaning_pay += emp.cleaning_pay;
          a.extra_classes = [...(a.extra_classes || []), ...(emp.extra_classes || [])];
          a.extra_classes_count += emp.extra_classes_count;
          a.extra_classes_total_kids += emp.extra_classes_total_kids;
          a.extra_classes_total_pay += emp.extra_classes_total_pay;
          a.extra_work = [...(a.extra_work || []), ...(emp.extra_work || [])];
          a.extra_work_approved_pay = (a.extra_work_approved_pay || 0) + (emp.extra_work_approved_pay || 0);
          a.extra_pay = [...(a.extra_pay || []), ...(emp.extra_pay || [])];
          a.extra_pay_total = (a.extra_pay_total || 0) + (emp.extra_pay_total || 0);
          a.inter_branch_hours = (a.inter_branch_hours || 0) + (emp.inter_branch_hours || 0);
          a.inter_branch_pay = (a.inter_branch_pay || 0) + (emp.inter_branch_pay || 0);
          a.total_before_rounding += emp.total_before_rounding;
          a.total_pay += emp.total_pay;
          a.weeks += 1;
        }
      }
    }

    let employees = Array.from(aggregated.values()).sort((a, b) => a.user_id.localeCompare(b.user_id));

    // Role-based visibility
    if (role === "staff" && viewUserId) {
      employees = employees
        .filter((e) => e.user_id === viewUserId)
        .map((e) => ({ ...e, extra_pay: [], extra_pay_total: 0 }));
    }

    const totals = {
      total_hours: employees.reduce((s, e) => s + e.effective_hours, 0),
      total_cleanings: employees.reduce((s, e) => s + e.cleaning_count, 0),
      total_extra_classes: employees.reduce((s, e) => s + e.extra_classes_count, 0),
      total_extra_pay: employees.reduce((s, e) => s + (e.extra_classes_total_pay || 0), 0),
      total_pay: employees.reduce((s, e) => s + e.total_pay, 0),
    };

    res.json({
      period_start,
      period_end,
      weeks: weekStarts,
      timesheet: { employees, totals },
    });
  } catch (e) {
    logger.error({ err: e }, "GET /debug/timesheet-period error");
    res.status(500).json({ error: String(e?.message || e) });
  }
});
logger.debug("GET /debug/timesheet-period route registered");

// --- Swagger UI ---
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

// --- Employee CRUD routes ---
app.use("/api/employees", employeesRouter);
logger.debug("/api/employees routes registered");

// --- Slot Template CRUD routes ---
app.use("/api/slots", slotsRouter);
logger.debug("/api/slots routes registered");

// --- Settings CRUD routes ---
app.use("/api/settings", settingsRouter);
logger.debug("/api/settings routes registered");

// --- Extra Work & Extra Pay routes ---
app.use("/api", extraWorkRouter);
logger.debug("/api/extra-work and /api/extra-pay routes registered");

// --- Auto-collect for next week ---
async function autoCollectNextWeek(chatId, tenantId) {
  // Calculate next Monday
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ...
  let daysUntilMon = (1 - dayOfWeek + 7) % 7;
  if (daysUntilMon === 0) daysUntilMon = 7; // if today is Monday, go to next Monday
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + daysUntilMon);
  const nextMondayISO = nextMonday.toISOString().slice(0, 10);

  // Calculate the Sunday of that week
  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6);
  const sundayStr = nextSunday.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  const mondayStr = nextMonday.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });

  // Create WEEK_OPEN fact
  const factPayload = { week_start: nextMondayISO, status: "collecting" };
  const factHash = createHash("sha256").update(`WEEK_OPEN|${JSON.stringify(factPayload)}|auto-collect`).digest("hex");
  await supabase.from("facts").upsert([{
    trace_id: `auto-collect-${Date.now()}`,
    chat_id: chatId,
    user_id: "system",
    fact_type: "WEEK_OPEN",
    fact_payload: factPayload,
    confidence: 1.0,
    status: "parsed",
    parser_version: "v0",
    fact_hash: factHash,
  }], { onConflict: "fact_hash" });

  // Insert system message in chat
  const sysEvent = {
    trace_id: randomUUID(),
    source: "system",
    chat_id: chatId,
    user_id: "system",
    text: `📅 Открыт сбор графика на неделю ${mondayStr}–${sundayStr}. Напишите когда можете/не можете работать!`,
    role: "system",
    meta: { system_message: true, ...(tenantId ? { tenant_id: tenantId } : {}) },
    status: "received",
    received_at: new Date().toISOString(),
  };
  await supabase.from("events").insert(sysEvent);

  return { ok: true, week_start: nextMondayISO, status: "collecting" };
}

app.post("/api/schedule/auto-collect", async (req, res) => {
  try {
    const chatId = req.body.chat_id || req.query.chat_id || "dev_seed_chat";
    const tenantId = req.body.tenant_id || req.query.tenant_id || "dev";
    const result = await autoCollectNextWeek(chatId, tenantId);
    logger.info({ week_start: result.week_start }, "Auto-collect triggered for next week");
    res.json(result);
  } catch (e) {
    logger.error({ err: e }, "POST /api/schedule/auto-collect error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});
logger.debug("POST /api/schedule/auto-collect route registered");

// --- Schedule Image Endpoints ---

app.get("/api/schedule/image", async (req, res) => {
  try {
    const { chat_id, week_start, tenant_id } = req.query;
    if (!chat_id) {
      return res.status(400).json({ error: "chat_id required" });
    }
    const weekStartISO =
      week_start ??
      (() => { const d = new Date(); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); return new Date(d.getFullYear(), d.getMonth(), diff).toISOString().slice(0, 10); })();

    const { data: facts, error } = await supabase
      .from("facts")
      .select("*")
      .eq("chat_id", chat_id)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw error;

    const slotTypes = await loadSlotTypes(tenant_id);
    const tenantSettings = await settingsService.getAll(tenant_id || "dev");
    const schedule = buildDraftSchedule({
      facts: facts ?? [],
      weekStartISO,
      slotTypes,
      settings: tenantSettings,
    });

    const pngBuffer = generateScheduleImage(schedule);
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "no-cache");
    res.send(pngBuffer);
  } catch (e) {
    logger.error({ err: e }, "GET /api/schedule/image error");
    res.status(500).json({ error: String(e?.message || e) });
  }
});
logger.debug("GET /api/schedule/image route registered");

app.post("/api/schedule/publish", async (req, res) => {
  try {
    const { chat_id, week_start, thread_id, tenant_id } = req.body;
    if (!chat_id) {
      return res.status(400).json({ error: "chat_id required" });
    }
    if (!telegramBot) {
      return res.status(503).json({ error: "Telegram bot not initialized" });
    }

    const weekStartISO =
      week_start ??
      (() => { const d = new Date(); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); return new Date(d.getFullYear(), d.getMonth(), diff).toISOString().slice(0, 10); })();

    const { data: facts, error } = await supabase
      .from("facts")
      .select("*")
      .eq("chat_id", chat_id)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw error;

    const slotTypes = await loadSlotTypes(tenant_id);
    const tenantSettings = await settingsService.getAll(tenant_id || "dev");
    const schedule = buildDraftSchedule({
      facts: facts ?? [],
      weekStartISO,
      slotTypes,
      settings: tenantSettings,
    });

    const botMode = getBotMode();
    if (botMode === "manual") {
      logger.info({ chat_id, week_start: weekStartISO, botMode }, "Schedule publish suppressed (manual mode)");
      return res.json({ ok: true, week_start: weekStartISO, message_id: null, pinned: false, mode: "manual" });
    }

    const pngBuffer = generateScheduleImage(schedule);
    const { InputFile } = await import("grammy");

    // debug mode → send to admin DM instead of group
    const targetChatId = botMode === "debug" && ADMIN_CHAT_ID ? ADMIN_CHAT_ID : chat_id;

    // Default to thread_id=2 ("График младшие" topic) for the main group
    const effectiveThreadId = thread_id ?? 2;
    const sendOpts = {};
    // Only set thread_id for actual group (not debug redirect to admin DM)
    if (effectiveThreadId && targetChatId === chat_id) sendOpts.message_thread_id = Number(effectiveThreadId);

    const sentMsg = await telegramBot.api.sendPhoto(
      targetChatId,
      new InputFile(pngBuffer, `${botMode === "debug" ? "[DEBUG] " : ""}schedule.png`),
      sendOpts,
    );

    // Pin the message in the topic (skip in debug mode — don't pin in admin DM)
    if (botMode !== "debug") {
      try {
        await telegramBot.api.pinChatMessage(targetChatId, sentMsg.message_id, { disable_notification: true });
        logger.info({ chat_id: targetChatId, message_id: sentMsg.message_id, thread_id: effectiveThreadId }, "Schedule PNG pinned");
      } catch (pinErr) {
        logger.warn({ err: pinErr, chat_id: targetChatId, message_id: sentMsg.message_id }, "Failed to pin schedule PNG (bot may lack pin permission)");
      }
    }

    logger.info({ chat_id, week_start: weekStartISO, thread_id: effectiveThreadId }, "Schedule PNG published to Telegram");
    res.json({ ok: true, week_start: weekStartISO, message_id: sentMsg.message_id, pinned: true });
  } catch (e) {
    logger.error({ err: e }, "POST /api/schedule/publish error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});
logger.debug("POST /api/schedule/publish route registered");

// POST /api/schedule/publish-test — send PNG to a personal DM (no pinning)
app.post("/api/schedule/publish-test", async (req, res) => {
  try {
    const { chat_id, week_start, telegram_user_id, tenant_id } = req.body;
    if (!telegram_user_id) {
      return res.status(400).json({ error: "telegram_user_id required" });
    }
    if (!telegramBot) {
      return res.status(503).json({ error: "Telegram bot not initialized" });
    }

    const weekStartISO =
      week_start ??
      (() => { const d = new Date(); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); return new Date(d.getFullYear(), d.getMonth(), diff).toISOString().slice(0, 10); })();

    const { data: facts, error } = await supabase
      .from("facts")
      .select("*")
      .eq("chat_id", chat_id || "test")
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw error;

    const slotTypes = await loadSlotTypes(tenant_id);
    const tenantSettings = await settingsService.getAll(tenant_id || "dev");
    const schedule = buildDraftSchedule({
      facts: facts ?? [],
      weekStartISO,
      slotTypes,
      settings: tenantSettings,
    });

    const pngBuffer = generateScheduleImage(schedule);
    const { InputFile } = await import("grammy");

    await telegramBot.api.sendPhoto(
      telegram_user_id,
      new InputFile(pngBuffer, "schedule.png"),
    );

    logger.info({ telegram_user_id, week_start: weekStartISO }, "Test schedule PNG sent to DM");
    res.json({ ok: true, week_start: weekStartISO });
  } catch (e) {
    logger.error({ err: e }, "POST /api/schedule/publish-test error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});
logger.debug("POST /api/schedule/publish-test route registered");

// --- Paraplan Integration Endpoints ---

app.get("/api/paraplan/status", async (req, res) => {
  if (USE_EMOGEN_PARAPLAN) {
    return res.json({ ok: true, mode: "emogen", configured: true, initialized: true, ready: true, emogen_url: EMOGEN_API_URL });
  }
  try {
    res.json({ ok: true, ...paraplan.getStatus() });
  } catch (e) {
    logger.error({ err: e }, "GET /api/paraplan/status error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/paraplan/hours", async (req, res) => {
  if (USE_EMOGEN_PARAPLAN) return proxyToEmogen(req, res, "/api/paraplan/hours");
  try {
    if (!paraplan.isReady()) {
      return res.json({ ok: true, hours: null, message: "Paraplan not initialized" });
    }
    const hours = paraplan.getHours();
    res.json({ ok: true, hours, updatedAt: paraplan.getLastUpdate() });
  } catch (e) {
    logger.error({ err: e }, "GET /api/paraplan/hours error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/paraplan/groups", async (req, res) => {
  if (USE_EMOGEN_PARAPLAN) {
    const qs = req.query.date ? `?date=${encodeURIComponent(req.query.date)}` : "";
    return proxyToEmogen(req, res, `/api/paraplan/groups${qs}`);
  }
  try {
    if (!paraplan.isReady()) {
      return res.json({ ok: true, groups: [], message: "Paraplan not initialized" });
    }
    const { date } = req.query;
    if (date) {
      const dayGroups = paraplan.getGroupsForDate(date);
      return res.json({ ok: true, ...dayGroups, updatedAt: paraplan.getLastUpdate() });
    }
    res.json({ ok: true, groups: paraplan.getGroups(), teachers: paraplan.getTeachers(), updatedAt: paraplan.getLastUpdate() });
  } catch (e) {
    logger.error({ err: e }, "GET /api/paraplan/groups error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/paraplan/refresh", async (req, res) => {
  if (USE_EMOGEN_PARAPLAN) return proxyToEmogen(req, res, "/api/paraplan/refresh");
  try {
    const tenantId = req.query.tenant_id || "dev";
    const savedConfig = await settingsService.get(tenantId, "paraplan_groups");
    const result = await paraplan.refresh(savedConfig || undefined);
    res.json({ ok: true, updatedAt: result?.updatedAt, groupCount: result?.groups?.length || 0 });
  } catch (e) {
    logger.error({ err: e }, "POST /api/paraplan/refresh error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/paraplan/groups-config", async (req, res) => {
  try {
    const tenantId = req.query.tenant_id || "dev";
    const saved = await settingsService.get(tenantId, "paraplan_groups");

    // If no saved config, auto-generate from Paraplan groups
    if (!saved && paraplan.isReady()) {
      const groups = paraplan.getGroups();
      const seniorPrefixes = paraplan.SENIOR_ONLY_PREFIXES || [];
      const config = groups.map((g) => ({
        paraplan_id: g.id,
        name: g.name,
        prefix: g.prefix,
        requires_junior: !seniorPrefixes.includes(g.prefix),
        required_skill_level: null,
        lessons: g.lessons || [],
      }));
      // Save to DB
      await settingsService.set(tenantId, "paraplan_groups", config, "Paraplan groups config with requires_junior flag");
      return res.json({ ok: true, groups: config, source: "auto-generated" });
    }

    res.json({ ok: true, groups: saved || [], source: "saved" });
  } catch (e) {
    logger.error({ err: e }, "GET /api/paraplan/groups-config error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.put("/api/paraplan/groups-config", async (req, res) => {
  try {
    const tenantId = req.body.tenant_id || "dev";
    const { groups } = req.body;
    if (!Array.isArray(groups)) {
      return res.status(400).json({ ok: false, error: "groups array required" });
    }
    await settingsService.set(tenantId, "paraplan_groups", groups, "Paraplan groups config");

    // Recalculate hours with the new filter
    if (paraplan.isReady()) {
      await paraplan.refreshWithFilter(groups);
    }

    res.json({ ok: true, groups });
  } catch (e) {
    logger.error({ err: e }, "PUT /api/paraplan/groups-config error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/paraplan/sync-groups", async (req, res) => {
  if (USE_EMOGEN_PARAPLAN) return proxyToEmogen(req, res, "/api/paraplan/sync-groups");
  try {
    const tenantId = req.body.tenant_id || "dev";
    if (!paraplan.isReady()) {
      return res.status(400).json({ ok: false, error: "Paraplan not ready" });
    }

    // Refresh from Paraplan first
    await paraplan.refresh();
    const freshGroups = paraplan.getGroups();

    // Load existing config to preserve requires_junior flags
    const existing = await settingsService.get(tenantId, "paraplan_groups") || [];
    const existingMap = new Map(existing.map((g) => [g.paraplan_id, g]));

    const config = freshGroups.map((g) => ({
      paraplan_id: g.id,
      name: g.name,
      prefix: g.prefix,
      requires_junior: existingMap.get(g.id)?.requires_junior ?? !(paraplan.SENIOR_ONLY_PREFIXES || []).includes(g.prefix),
      required_skill_level: existingMap.get(g.id)?.required_skill_level ?? null,
      lessons: g.lessons || [],
    }));

    await settingsService.set(tenantId, "paraplan_groups", config, "Paraplan groups config (synced)");
    res.json({ ok: true, groups: config, synced: freshGroups.length });
  } catch (e) {
    logger.error({ err: e }, "POST /api/paraplan/sync-groups error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Compensations (отработки) from Paraplan
app.get("/api/paraplan/compensations", async (req, res) => {
  if (USE_EMOGEN_PARAPLAN) {
    const params = new URLSearchParams();
    if (req.query.from) params.set("from", req.query.from);
    if (req.query.to) params.set("to", req.query.to);
    const qs = params.toString() ? `?${params}` : "";
    return proxyToEmogen(req, res, `/api/paraplan/compensations${qs}`);
  }
  try {
    if (!paraplan.isReady()) return res.json({ ok: false, error: "Paraplan not initialized" });
    const ds = paraplan.getDataService();
    if (!ds) return res.json({ ok: false, error: "No data service" });

    const now = new Date();
    const dateFrom = req.query.from || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const dateTo = req.query.to || `${now.getFullYear()}-${String(now.getMonth()+2).padStart(2,'0')}-01`;
    const data = await ds.getCompensations(dateFrom, dateTo, 1, 100);
    const items = data?.itemList || [];
    res.json({ ok: true, count: items.length, items });
  } catch (e) {
    logger.error({ err: e }, "GET /api/paraplan/compensations error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Subscription templates (абонементы)
app.get("/api/paraplan/subscriptions", async (_req, res) => {
  if (USE_EMOGEN_PARAPLAN) return proxyToEmogen(_req, res, "/api/paraplan/subscriptions");
  try {
    if (!paraplan.isReady()) return res.json({ ok: false, error: "Paraplan not initialized" });
    const ds = paraplan.getDataService();
    if (!ds) return res.json({ ok: false, error: "No data service" });

    const data = await ds.getSubscriptionTemplates();
    const templates = data?.subscriptionTemplateDto || [];
    res.json({ ok: true, count: templates.length, templates });
  } catch (e) {
    logger.error({ err: e }, "GET /api/paraplan/subscriptions error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

logger.debug("Paraplan API routes registered");

// ── Bot mode: manual / auto / debug ─────────────────────────────────────────
app.get("/api/bot-mode", (_req, res) => {
  res.json({ mode: getBotMode() });
});

app.post("/api/bot-mode", (req, res) => {
  try {
    const { mode } = req.body || {};
    const result = setBotMode(mode);
    res.json({ ok: true, mode: result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Emogen proxy: forward price/group settings to Emogen bot backend ────────
const EMOGEN_API_URL = process.env.EMOGEN_API_URL || "";
const EMOGEN_API_PASSWORD = process.env.EMOGEN_API_PASSWORD || "";
const emogenAuthHeader = EMOGEN_API_PASSWORD
  ? "Basic " + Buffer.from(":" + EMOGEN_API_PASSWORD).toString("base64")
  : "";

// When EMOGEN_API_URL is set, route Paraplan data through Emogen (no direct CRM login)
const USE_EMOGEN_PARAPLAN = !!EMOGEN_API_URL;

/**
 * Proxy helper: fetch from Emogen API with auth.
 * @param {string} path - e.g. "/api/paraplan/hours"
 * @param {object} [opts] - fetch options override
 * @returns {Response}
 */
async function emogenFetch(path, opts = {}) {
  const url = `${EMOGEN_API_URL}${path}`;
  const headers = { ...opts.headers };
  if (emogenAuthHeader) headers.Authorization = emogenAuthHeader;
  return fetch(url, { ...opts, headers });
}

/**
 * Proxy an incoming request to Emogen and pipe the JSON response back.
 */
async function proxyToEmogen(req, res, emogenPath) {
  try {
    const r = await emogenFetch(emogenPath);
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (e) {
    logger.warn({ err: e, path: emogenPath }, "Emogen proxy error");
    res.status(502).json({ ok: false, error: "Emogen API unreachable", detail: e?.message });
  }
}

app.get("/api/emogen/groups", async (_req, res) => {
  try {
    const r = await fetch(`${EMOGEN_API_URL}/api/settings/groups`, {
      headers: { Authorization: emogenAuthHeader },
    });
    if (!r.ok) {
      return res.status(r.status).json({ error: `Emogen API: ${r.status} ${r.statusText}` });
    }
    const data = await r.json();
    res.json(data);
  } catch (e) {
    logger.warn({ err: e }, "Emogen API unreachable");
    res.status(502).json({ error: "Emogen API unreachable", detail: e?.message });
  }
});

app.put("/api/emogen/groups/:name", async (req, res) => {
  try {
    const name = encodeURIComponent(req.params.name);
    const r = await fetch(`${EMOGEN_API_URL}/api/settings/groups/${name}`, {
      method: "PUT",
      headers: {
        Authorization: emogenAuthHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(r.status).json({ error: `Emogen API: ${r.status}`, detail: text });
    }
    const data = await r.json();
    res.json(data);
  } catch (e) {
    logger.warn({ err: e }, "Emogen API unreachable (PUT)");
    res.status(502).json({ error: "Emogen API unreachable", detail: e?.message });
  }
});

// GET /api/emogen/status — proxy Emogen /health (silent_mode status)
app.get("/api/emogen/status", async (_req, res) => {
  try {
    const r = await fetch(`${EMOGEN_API_URL}/health`, {
      headers: { Authorization: emogenAuthHeader },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) {
      return res.status(r.status).json({ error: `Emogen API: ${r.status} ${r.statusText}` });
    }
    const data = await r.json();
    res.json(data);
  } catch (e) {
    logger.warn({ err: e }, "Emogen API unreachable (status)");
    res.status(502).json({ error: "Emogen API unreachable", detail: e?.message });
  }
});

// POST /api/emogen/silent-mode — toggle Emogen silent mode
app.post("/api/emogen/silent-mode", async (req, res) => {
  try {
    const r = await fetch(`${EMOGEN_API_URL}/api/silent-mode`, {
      method: "POST",
      headers: {
        Authorization: emogenAuthHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(r.status).json({ error: `Emogen API: ${r.status}`, detail: text });
    }
    const data = await r.json();
    res.json(data);
  } catch (e) {
    logger.warn({ err: e }, "Emogen API unreachable (silent-mode)");
    res.status(502).json({ error: "Emogen API unreachable", detail: e?.message });
  }
});

logger.debug("Emogen proxy routes registered");

// ── Payments list — ежедневный список оплат ────────────────────────────────
import { sendPaymentsList } from "./paymentsService.js";

app.post("/api/payments/send-list", async (req, res) => {
  try {
    const { date, chat_id, thread_id } = req.body;
    if (!chat_id) return res.status(400).json({ ok: false, error: "chat_id required" });
    if (!telegramBot) return res.status(503).json({ ok: false, error: "Telegram bot not initialized" });

    // Default: tomorrow
    const targetDate = date || (() => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    })();

    const result = await sendPaymentsList(telegramBot, chat_id, targetDate, thread_id);
    res.json(result);
  } catch (e) {
    logger.error({ err: e }, "POST /api/payments/send-list error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

logger.debug("Payments routes registered");

// SPA fallback: serve index.html for unmatched routes (no auth, must be after all API routes)
if (existsSync(distDir)) {
  app.get("/{*path}", (req, res, next) => {
    // Don't serve index.html for API/debug/data routes — let them 404 naturally
    if (req.path.startsWith("/api/") || req.path.startsWith("/debug/") || req.path.startsWith("/events") || req.path.startsWith("/facts") || req.path.startsWith("/ingest")) {
      return res.status(404).json({ error: "Not found" });
    }
    // Skip API key check for SPA routes
    res.sendFile(resolve(distDir, "index.html"));
  });
}

const port = process.env.PORT || 3000;
function dumpRoutes(app) {
  try {
    const stack = app?._router?.stack || [];
    const routes = [];
    for (const layer of stack) {
      if (layer.route?.path) {
        const methods = Object.keys(layer.route.methods || {}).filter((m) => layer.route.methods[m]);
        routes.push(`${methods.join(",").toUpperCase()} ${layer.route.path}`);
      }
    }
    logger.debug({ routes }, "registered routes");
  } catch (e) {
    logger.warn({ err: e }, "routes dump failed");
  }
}

dumpRoutes(app);

// Sync employees from DB into UserDirectory on startup, then start server
UserDirectory.syncFromDB(employeeService).then(async () => {
  // Load extra work catalog for NL parser
  try {
    const settings = await settingsService.getAll(process.env.DEFAULT_TENANT_ID || "dev");
    setExtraWorkCatalog(settings.extra_work_catalog || []);
    logger.info({ count: (settings.extra_work_catalog || []).length }, "Extra work catalog loaded for parser");
  } catch (e) {
    logger.warn({ err: e }, "Failed to load extra work catalog for parser");
  }
  // Initialize Paraplan integration
  if (USE_EMOGEN_PARAPLAN) {
    // Production: route Paraplan data through Emogen — no direct CRM login
    logger.info({ emogenUrl: EMOGEN_API_URL }, "[paraplan] Using Emogen proxy (no direct CRM connection)");
    fetchEmogenHours().catch((err) => {
      logger.warn({ err: err?.message }, "[paraplan] Initial Emogen hours fetch failed — will retry");
    });
    // Refresh Emogen hours every 30 minutes
    setInterval(() => fetchEmogenHours().catch(() => {}), 30 * 60 * 1000);
  } else if (paraplan.isConfigured()) {
    // Dev: direct Paraplan connection
    const tenantId = process.env.DEFAULT_TENANT_ID || "dev";
    settingsService.get(tenantId, "paraplan_groups").then((savedConfig) => {
      return paraplan.init(savedConfig || undefined);
    }).then(() => {
      logger.info("[paraplan] Integration ready (direct)");
    }).catch((err) => {
      logger.warn({ err: err.message }, "[paraplan] Init failed — hours will use defaults");
    });
  } else {
    logger.info("[paraplan] Not configured (no EMOGEN_API_URL, no PARAPLAN_LOGIN/PARAPLAN_PASSWORD)");
  }
}).finally(() => {
  app.listen(port, () => {
    logger.info({ port: Number(port), env: envName }, "Server started");
    logger.info(`Swagger UI: http://localhost:${port}/api-docs`);

    // Dev seed: auto-load test data if not in production
    if (envName !== "production") {
      const seedBuildSchedule = async (chatId, weekStart) => {
        const tenantId = process.env.DEFAULT_TENANT_ID || "dev";
        const slotTypes = await loadSlotTypes(tenantId);
        const seedSettings = await settingsService.getAll(tenantId);
        const { data: facts } = await supabase
          .from("facts")
          .select("*")
          .eq("chat_id", chatId)
          .order("created_at", { ascending: true })
          .limit(500);
        const schedule = buildDraftSchedule({ facts: facts ?? [], weekStartISO: weekStart, slotTypes, settings: seedSettings });

        // Persist SHIFT_ASSIGNMENT facts (same logic as /debug/build-schedule)
        const assignmentsToCreate = [];
        const DOW_ORDER_MAP = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
        for (const assignment of schedule.assignments || []) {
          const dayOffset = DOW_ORDER_MAP[assignment.dow] || 0;
          const weekStartDate = new Date(weekStart + "T00:00:00Z");
          weekStartDate.setUTCDate(weekStartDate.getUTCDate() + dayOffset);
          const date = weekStartDate.toISOString().slice(0, 10);
          const factPayload = {
            week_start: weekStart, date, dow: assignment.dow,
            from: assignment.from, to: assignment.to,
            assigned_user_id: assignment.user_id,
            replaced_user_id: assignment.replaced_user_id || null,
            reason: assignment.reason || "auto-assigned",
          };
          const hashInput = `SHIFT_ASSIGNMENT|${JSON.stringify(factPayload)}|v0`;
          const factHash = createHash("sha256").update(hashInput).digest("hex");
          assignmentsToCreate.push({
            trace_id: `seed-build-${Date.now()}`,
            chat_id: chatId, user_id: "admin1",
            fact_type: "SHIFT_ASSIGNMENT", fact_payload: factPayload,
            confidence: 1.0, status: "parsed", parser_version: "v0", fact_hash: factHash,
          });
        }
        if (assignmentsToCreate.length > 0) {
          await supabase.from("facts").upsert(assignmentsToCreate, { onConflict: "fact_hash" });
          logger.info("Dev seed: persisted %d SHIFT_ASSIGNMENT facts", assignmentsToCreate.length);
        }
      };
      runDevSeed(ingestInternal, seedBuildSchedule).catch((e) =>
        logger.error({ err: e }, "Dev seed error"),
      );
    }

    // Start Telegram bot if token is configured
    if (process.env.TELEGRAM_BOT_TOKEN) {
      const botIngest = async (payload) => {
        return ingestInternal({
          source: "telegram",
          chat_id: payload.chat_id,
          user_id: payload.user_id,
          text: payload.text,
          meta: payload.meta,
          tenant_id: payload.tenant_id,
          traceId: undefined,
        });
      };
      // Helper: get Monday of current week (same logic as devSeed)
      const getBotMonday = () => {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(d.getFullYear(), d.getMonth(), diff).toISOString().slice(0, 10);
      };

      const botSchedule = async (chatId) => {
        const tenantId = process.env.DEFAULT_TENANT_ID || "dev";
        const slotTypes = await loadSlotTypes(tenantId);
        const botSettings = await settingsService.getAll(tenantId);
        const { data: facts } = await supabase
          .from("facts")
          .select("*")
          .eq("chat_id", chatId)
          .order("created_at", { ascending: true })
          .limit(500);
        const weekStartISO = getBotMonday();
        return buildDraftSchedule({ facts: facts ?? [], weekStartISO, slotTypes, settings: botSettings });
      };

      const botWeekState = async (chatId) => {
        const tenantId = process.env.DEFAULT_TENANT_ID || "dev";
        const slotTypes = await loadSlotTypes(tenantId);
        const botSettings = await settingsService.getAll(tenantId);
        const { data: facts } = await supabase
          .from("facts")
          .select("*")
          .eq("chat_id", chatId)
          .order("created_at", { ascending: true })
          .limit(500);
        const weekStartISO = getBotMonday();
        const schedule = buildDraftSchedule({ facts: facts ?? [], weekStartISO, slotTypes, settings: botSettings });
        return computeWeekState({ facts: facts ?? [], weekStartISO, schedule });
      };

      const botTimesheet = async (chatId) => {
        const tenantId = process.env.DEFAULT_TENANT_ID || "dev";
        const slotTypes = await loadSlotTypes(tenantId);
        const botSettings = await settingsService.getAll(tenantId);
        const { data: facts } = await supabase
          .from("facts")
          .select("*")
          .eq("chat_id", chatId)
          .order("created_at", { ascending: true })
          .limit(500);
        const weekStartISO = getBotMonday();
        const schedule = buildDraftSchedule({ facts: facts ?? [], weekStartISO, slotTypes, settings: botSettings });
        const hourlyRates = UserDirectory.getAllHourlyRates();
        return buildTimesheet({ facts: facts ?? [], weekStartISO, hourlyRates, schedule, settings: botSettings });
      };

      const mode = process.env.TELEGRAM_MODE || "polling";
      const bot = createBot(botIngest, botSchedule, botWeekState, botTimesheet, employeeService);
      telegramBot = bot;
      if (bot) {
        if (mode === "webhook") {
          const webhookPath = "/telegram-webhook";
          app.post(webhookPath, webhookCallback(bot, "express"));
          (async () => {
            try {
              await bot.init();
              const webhookUrl = process.env.WEBHOOK_URL
                || `https://shiftledger-production.up.railway.app${webhookPath}`;
              await bot.api.setWebhook(webhookUrl, { drop_pending_updates: true });
              logger.info({ webhookUrl }, "Telegram bot started (webhook)");
            } catch (err) {
              logger.error({ err: err.message }, "Failed to set Telegram webhook");
            }
          })();
        } else {
          bot.start({ onStart: () => logger.info("Telegram bot started (long polling)") });
        }
      }
    }

    // --- Auto-collect cron ---
    const _cronState = loadCronState();
    let lastAutoCollectDate = _cronState.autoCollect || null;
    let lastPaymentsCronDate = _cronState.payments || null;
    const DOW_CRON_MAP = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };

    const autoCollectCronCheck = async () => {
      try {
        const tenantId = process.env.DEFAULT_TENANT_ID || "dev";
        const settings = await settingsService.getAll(tenantId);
        const enabled = settings["schedule.auto_collect_enabled"];
        if (!enabled) return;

        const collectDay = settings["schedule.auto_collect_day"] || "fri";
        const today = new Date();
        const todayDateStr = today.toISOString().slice(0, 10);

        // Already ran today?
        if (lastAutoCollectDate === todayDateStr) return;

        // Check if today matches the configured day
        const todayDow = today.getDay(); // 0=Sun, 1=Mon, ...
        const targetDow = DOW_CRON_MAP[collectDay];
        if (targetDow === undefined || todayDow !== targetDow) return;

        // Run auto-collect
        const chatId = "dev_seed_chat"; // default chat
        const result = await autoCollectNextWeek(chatId, tenantId);
        lastAutoCollectDate = todayDateStr;
        saveCronState({ autoCollect: lastAutoCollectDate, payments: lastPaymentsCronDate });
        logger.info({ week_start: result.week_start, date: todayDateStr }, "Auto-collect cron triggered successfully");
      } catch (e) {
        logger.error({ err: e }, "Auto-collect cron error");
      }
    };

    // Check every 60 seconds
    setInterval(autoCollectCronCheck, 60 * 1000);
    // Also check immediately on startup
    autoCollectCronCheck();
    logger.info("Auto-collect cron started (checking every 60s)");

    // --- Payments list cron (daily at 19:30 MSK) ---

    const paymentsCronCheck = async () => {
      try {
        const tenantId = process.env.DEFAULT_TENANT_ID || "dev";
        const settings = await settingsService.getAll(tenantId);
        if (!settings["payments_automation"]) return;

        // Check if it's 19:30 MSK (UTC+3)
        const now = new Date();
        const mskHour = (now.getUTCHours() + 3) % 24;
        const mskMin = now.getUTCMinutes();
        if (mskHour !== 19 || mskMin < 30 || mskMin > 31) return;

        const todayStr = now.toISOString().slice(0, 10);
        if (lastPaymentsCronDate === todayStr) return;

        // Target: tomorrow
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().slice(0, 10);

        const chatId = settings["payments_chat_id"];
        const threadId = settings["payments_thread_id"];
        if (!chatId || !telegramBot) return;

        await sendPaymentsList(telegramBot, chatId, tomorrowStr, threadId);
        lastPaymentsCronDate = todayStr;
        saveCronState({ autoCollect: lastAutoCollectDate, payments: lastPaymentsCronDate });
        logger.info({ date: tomorrowStr, chatId }, "Payments cron: list sent");
      } catch (e) {
        logger.error({ err: e }, "Payments cron error");
      }
    };

    setInterval(paymentsCronCheck, 60 * 1000);
    logger.info("Payments cron started (daily 19:30 MSK)");
  });
});
