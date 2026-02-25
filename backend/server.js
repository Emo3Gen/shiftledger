import dotenv from "dotenv";

const envName = process.env.APP_ENV || "dev";
dotenv.config({ path: `.env.${envName}` });

import express from "express";
import { randomUUID, createHash } from "crypto";
import { supabase } from "./supabaseClient.js";
import { parseEventToFacts } from "./factsParserV0.js";
import { buildDraftSchedule } from "./scheduleEngineV0.js";
import { buildTimesheet } from "./timesheetV0.js";
import { computeWeekState } from "./weekStateV0.js";
import { UserDirectory } from "./userDirectory.js";
import employeesRouter from "./routes/employees.js";
import slotsRouter from "./routes/slots.js";
import settingsRouter from "./routes/settings.js";
import * as employeeService from "./employeeService.js";
import * as slotService from "./slotService.js";
import * as settingsService from "./settingsService.js";
import { requireApiKey } from "./middleware/auth.js";
import { validateBody, validateQuery, validateParams } from "./middleware/validate.js";
import logger from "./logger.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { generalLimiter, ingestLimiter } from "./middleware/rateLimiter.js";
import { createBot } from "./telegram/bot.js";
import swaggerUi from "swagger-ui-express";
import { specs as swaggerSpecs } from "./swagger.js";
import {
  IngestSchema,
  DebugSendSchema,
  ParseEventParamsSchema,
  ScheduleQuerySchema,
  BuildScheduleSchema,
  ConfirmUserParamsSchema,
  ConfirmUserBodySchema,
  FactsQuerySchema,
  EventsQuerySchema,
  DialogsQuerySchema,
  DialogParamsSchema,
  DialogQuerySchema,
} from "./validation/schemas.js";

const app = express();

// Structured request logging (pino)
app.use(requestLogger);

// Global rate limiter
app.use(generalLimiter);

// Парсер JSON ДОЛЖЕН быть подключён до роутов,
// чтобы req.body был заполнен.
app.use(express.json());

// API key auth (skips /health and /__ping; dev mode if API_KEY not set)
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
  });
});

// Простой webhook: только логируем Update.
app.post("/telegram/webhook", async (req, res) => {
  const update = req.body;

  logger.info({ update }, "Telegram webhook update");

  // Здесь позже можно будет вызвать Supabase-запросы, бизнес-логику и т.д.
  // Например:
  // import { supabase } from "./supabaseClient.js";
  // await supabase.from("updates").insert({ raw: update });

  return res.sendStatus(200);
});

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

    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("chat_id", chat_id)
      .order("received_at", { ascending: true })
      .limit(200);

    if (error) throw error;

    // Фильтруем в памяти: (meta.tenant_id == tenant_id) OR (если meta.tenant_id нет, то source == tenant_id)
    const filtered = (data || []).filter((row) => {
      const rowTenantId = row.meta?.tenant_id || row.source;
      return rowTenantId === tenant_id;
    });

    res.status(200).json({ events: filtered });
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
      // WEEK_* facts: check week_start in payload
      if (f.fact_type?.startsWith("WEEK_")) {
        return f.fact_payload?.week_start === weekStartISO;
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

      // Facts without date: include them (can be refined later)
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
      // WEEK_* facts: check week_start in payload
      if (f.fact_type?.startsWith("WEEK_")) {
        return f.fact_payload?.week_start === weekStartISO;
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

      // SHIFT_WORKED, SHIFT_NO_SHOW: check week_start in payload
      if (f.fact_type === "SHIFT_WORKED" || f.fact_type === "SHIFT_NO_SHOW") {
        return f.fact_payload?.week_start === weekStartISO;
      }

      // TIMESHEET_CONFIRMED: check week_start in payload
      if (f.fact_type === "TIMESHEET_CONFIRMED") {
        return f.fact_payload?.week_start === weekStartISO;
      }

      // Include other facts for now
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

    res.json({
      week_start: weekStartISO,
      schedule,
      timesheet,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
logger.debug("GET /debug/timesheet route registered");

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
UserDirectory.syncFromDB(employeeService).finally(() => {
  app.listen(port, () => {
    logger.info({ port: Number(port), env: envName }, "Server started");
    logger.info(`Swagger UI: http://localhost:${port}/api-docs`);

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
        const weekStartISO = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString().slice(0, 10);
        return buildDraftSchedule({ facts: facts ?? [], weekStartISO, slotTypes, settings: botSettings });
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
        const weekStartISO = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString().slice(0, 10);
        const schedule = buildDraftSchedule({ facts: facts ?? [], weekStartISO, slotTypes, settings: botSettings });
        const hourlyRates = UserDirectory.getAllHourlyRates();
        return buildTimesheet({ facts: facts ?? [], weekStartISO, hourlyRates, schedule, settings: botSettings });
      };

      const mode = process.env.TELEGRAM_MODE || "polling";
      const bot = createBot(botIngest, botSchedule, null, botTimesheet, employeeService);
      if (bot) {
        if (mode === "webhook") {
          logger.info("Telegram bot started in webhook mode (configure WEBHOOK_URL externally)");
        } else {
          bot.start({ onStart: () => logger.info("Telegram bot started (long polling)") });
        }
      }
    }
  });
});
