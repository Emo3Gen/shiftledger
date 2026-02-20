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
import { requireApiKey } from "./middleware/auth.js";
import { validateBody, validateQuery, validateParams } from "./middleware/validate.js";
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

// Ранний логгер всех запросов, чтобы видеть реальные пути.
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

// Парсер JSON ДОЛЖЕН быть подключён до роутов,
// чтобы req.body был заполнен.
app.use(express.json());

// API key auth (skips /health and /__ping; dev mode if API_KEY not set)
app.use(requireApiKey);

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

  console.log(
    `[INGEST] trace_id=${event.trace_id} chat_id=${event.chat_id} user_id=${event.user_id}`,
  );

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
    console.error("[INGEST] failed to insert into Supabase:", error);
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
    console.log(
      `[PARSE_PREVIEW] event_id=${eventId} text="${inserted.text}" facts=${factsPreview.length}`,
    );
    if (factsPreview.length > 0) {
      console.log(
        `[PARSE_PREVIEW] sample:`,
        factsPreview.slice(0, 2).map((f) => ({
          fact_type: f.fact_type,
          payload_keys: Object.keys(f.fact_payload || {}),
        })),
      );
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
        console.error(
          `[FACTS_PERSIST] event_id=${eventId} err=${factsPersistError}`,
        );
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
    console.error("[INGEST] unexpected error while parsing/inserting facts:", factsUnexpectedErr);
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

// Healthcheck для Cloudflare Worker / внешних проверок.
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

  // Лог в stdout, чтобы хорошо читалось в dev-логах.
  console.log("=== Telegram Update ===");
  console.log(JSON.stringify(update, null, 2));
  console.log("========================");

  // Здесь позже можно будет вызвать Supabase-запросы, бизнес-логику и т.д.
  // Например:
  // import { supabase } from "./supabaseClient.js";
  // await supabase.from("updates").insert({ raw: update });

  return res.sendStatus(200);
});

// Минимальный ingestion endpoint для приёма событий из чата.
app.post("/ingest", validateBody(IngestSchema), async (req, res) => {
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
    console.error("[INGEST] unexpected error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
console.log("[DEBUG] POST /ingest route registered");

// Parse event into facts and persist them.
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
    console.error("[PARSE] failed to load event:", error);
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
      console.error("[PARSE] failed to insert facts:", insertError);
      return res.status(500).json({ ok: false, error: "failed to persist facts" });
    }
  }

  const { error: updateError } = await supabase
    .from("events")
    .update({ status: "parsed" })
    .eq("id", event.id);

  if (updateError) {
    console.error("[PARSE] failed to update event status:", updateError);
  }

  return res.json({
    ok: true,
    event_id: event.id,
    created_facts_count: facts.length,
    facts_preview: facts.slice(0, 5),
  });
});

// List facts with optional filters.
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
    console.error("[FACTS] failed to load facts:", error);
    return res.status(500).json({ ok: false, error: "failed to load facts" });
  }

  return res.json({ ok: true, facts: data ?? [] });
});

// List events with optional filters.
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
    console.error("[EVENTS] failed to load events:", error);
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
  res.status(200).json({ ok: true, entry: __filename, cwd: process.cwd() });
});
console.log("[DEBUG] __ping route registered");

// GET /debug/tenants
// Извлекаем tenants: приоритет meta.tenant_id, fallback на source.
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

// GET /debug/dialogs?tenant_id=...
// Фильтруем: (meta.tenant_id == tenant_id) OR (если meta.tenant_id нет, то source == tenant_id)
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

// GET /debug/dialog/:chat_id?tenant_id=...
// Фильтруем: (meta.tenant_id == tenant_id) OR (если meta.tenant_id нет, то source == tenant_id)
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

// POST /debug/send — отправка сообщения через реальный ingest-flow
app.post("/debug/send", validateBody(DebugSendSchema), async (req, res) => {
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
    console.error("[DEBUG] /debug/send error:", e);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
console.log("[DEBUG] POST /debug/send route registered");

// GET /debug/schedule — построение draft schedule из facts
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

    const schedule = buildDraftSchedule({
      facts: facts ?? [],
      weekStartISO,
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
console.log("[DEBUG] GET /debug/schedule route registered");

// GET /debug/week_state — вычисление состояния недели из facts
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
    const draftSchedule = buildDraftSchedule({
      facts: filteredFacts,
      weekStartISO,
    });

    // Compute hasProblem flags - fail-safe initialization
    let hasProblem = false;
    let hasGaps = false;
    let hasUnconfirmed = false;
    let hasEmergency = false;

    try {
      // hasGaps: check for gaps in schedule or empty slots
      hasGaps = Boolean(
        (draftSchedule.gaps && draftSchedule.gaps.length > 0) ||
        (draftSchedule.slots && Array.isArray(draftSchedule.slots) && draftSchedule.slots.some((s) => s && s.status === "EMPTY"))
      );

      // hasUnconfirmed: check for pending slots
      hasUnconfirmed = Boolean(
        draftSchedule.slots && Array.isArray(draftSchedule.slots) && draftSchedule.slots.some((s) => s && s.status === "PENDING")
      );

      // hasEmergency: check if week state is EMERGENCY
      hasEmergency = Boolean(weekState && weekState.state === "EMERGENCY");

      // Combine all flags
      hasProblem = Boolean(hasGaps || hasUnconfirmed || hasEmergency);
    } catch (problemCalcError) {
      // Fail-safe: if calculation fails, hasProblem stays false
      console.warn("[WEEK_STATE] Failed to calculate hasProblem flags:", problemCalcError);
      hasProblem = false;
    }

    res.json({
      week_state: { ...weekState, hasProblem, hasGaps, hasUnconfirmed, hasEmergency },
      schedule: draftSchedule,
      hasProblem, // Also include at top level for convenience
      meta: {
        facts_count: facts?.length || 0,
      },
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
console.log("[DEBUG] GET /debug/week_state route registered");

// POST /debug/build-schedule — построение и сохранение графика (создание SHIFT_ASSIGNMENT фактов)
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
    const draftSchedule = buildDraftSchedule({
      facts: filteredFacts,
      weekStartISO,
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
      console.error("[BUILD_SCHEDULE] Failed to create system event:", eventError);
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
        console.error("[BUILD_SCHEDULE] Failed to insert assignments:", insertError);
        // Continue anyway, return what we have
      } else {
        assignmentsCreated = insertedFacts?.length || 0;
        console.log(`[BUILD_SCHEDULE] Created ${assignmentsCreated} SHIFT_ASSIGNMENT facts for event_id=${eventId}`);
      }
    } else {
      console.log(`[BUILD_SCHEDULE] No new assignments to create (all already exist)`);
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
        });
        console.log(`[BUILD_SCHEDULE] Recalculated schedule with ${updatedFilteredFacts.length} facts`);
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
    console.error("[BUILD_SCHEDULE] Error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});
console.log("[DEBUG] POST /debug/build-schedule route registered");

// POST /api/week/:weekStartISO/confirm-user — подтверждение графика пользователем
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
      console.error("[CONFIRM_USER] Failed to insert confirmation:", insertError);
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
    const updatedSchedule = buildDraftSchedule({
      facts: filteredFacts,
      weekStartISO,
    });

    res.json({
      ok: true,
      week_start: weekStartISO,
      user_id: normalizedUserId,
      schedule: updatedSchedule,
      confirmation_created: insertedFacts && insertedFacts.length > 0,
    });
  } catch (e) {
    console.error("[CONFIRM_USER] Error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});
console.log("[DEBUG] POST /api/week/:weekStartISO/confirm-user route registered");

// GET /debug/timesheet — вычисление табеля из facts
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
    const schedule = buildDraftSchedule({
      facts: filteredFacts,
      weekStartISO,
    });

    // Hourly rates from UserDirectory
    const hourlyRates = UserDirectory.getAllHourlyRates();

    // Build timesheet
    const timesheet = buildTimesheet({
      facts: filteredFacts,
      weekStartISO,
      hourlyRates,
      schedule,
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
console.log("[DEBUG] GET /debug/timesheet route registered");

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
    console.log("[ROUTES]", routes);
  } catch (e) {
    console.log("[ROUTES] dump failed:", e?.message || e);
  }
}

dumpRoutes(app);

app.listen(port, () => {
  console.log(`[backend] listening on http://127.0.0.1:${port} (env=${envName})`);
});
