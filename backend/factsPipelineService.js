import { randomUUID, createHash } from "crypto";
import { supabase } from "./supabaseClient.js";
import { parseEventToFacts } from "./factsParserV0.js";

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
    parser_version: "v0",
  };
  const s = stableStringify(normalized);
  return createHash("sha256").update(s).digest("hex");
}

export async function ingestEvent(input) {
  const startedAt = Date.now();
  const {
    tenant_id,
    channel,
    chat_id,
    user_id,
    text = "",
    ts,
    meta = {},
    message_id,
    source,
  } = input;

  if (!chat_id || !user_id) {
    throw new Error("chat_id and user_id are required");
  }

  const trace_id = meta.trace_id || randomUUID();
  const received_at = new Date().toISOString();

  let existingEvent = null;
  const eventPayload = {
    trace_id,
    source: source ?? channel ?? "emu",
    chat_id,
    user_id,
    text: text ?? "",
    role: meta.role ?? null,
    meta: {
      ...meta,
      tenant_id: tenant_id ?? meta.tenant_id,
      channel: channel ?? meta.channel,
      message_id: message_id ?? meta.message_id,
      ts: ts ?? meta.ts,
    },
    status: "received",
    received_at,
  };

  const persistStart = Date.now();

  if (message_id) {
    const { data, error } = await supabase
      .from("events")
      .select("id, trace_id, chat_id, user_id, text, meta, received_at")
      .eq("chat_id", chat_id)
      .eq("user_id", user_id)
      .contains("meta", { message_id })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[INGEST] failed to check existing event by message_id:", error);
    } else if (data) {
      existingEvent = data;
    }
  }

  let eventId;
  let eventRecord;

  if (existingEvent) {
    eventId = existingEvent.id;
    eventRecord = existingEvent;
  } else {
    const { data: inserted, error } = await supabase
      .from("events")
      .insert(eventPayload)
      .select("id, trace_id, chat_id, user_id, text, meta, received_at")
      .single();

    if (error || !inserted) {
      console.error("[INGEST] failed to insert into Supabase:", error);
      throw new Error("failed to persist event");
    }
    eventId = inserted.id;
    eventRecord = inserted;
  }

  const persist_event_ms = Date.now() - persistStart;

  // Parse
  const parseStart = Date.now();
  const facts = parseEventToFacts({
    text: eventRecord.text,
    received_at: eventRecord.received_at,
    chat_id: eventRecord.chat_id,
    user_id: eventRecord.user_id,
    meta: eventRecord.meta,
  });
  const parse_ms = Date.now() - parseStart;

  // Persist facts
  let persist_facts_ms = 0;
  let writtenFacts = [];
  if (Array.isArray(facts) && facts.length > 0) {
    const rows = facts.map((f) => {
      const payload = f.fact_payload ?? {};
      const hash = computeFactHash(eventId, f.fact_type, payload);
      return {
        event_id: eventId,
        trace_id,
        chat_id,
        user_id,
        fact_type: f.fact_type,
        fact_payload: payload,
        confidence: f.confidence ?? null,
        status: "parsed",
        parser_version: "v0",
        fact_hash: hash,
      };
    });

    const persistFactsStart = Date.now();
    const { data: upserted, error: factsErr } = await supabase
      .from("facts")
      .upsert(rows, { onConflict: "fact_hash" })
      .select(
        "id, event_id, fact_type, fact_payload, confidence, status, parser_version, fact_hash",
      );
    persist_facts_ms = Date.now() - persistFactsStart;

    if (factsErr) {
      console.error("[FACTS] failed to upsert:", factsErr);
    } else if (upserted) {
      writtenFacts = upserted;
    }
  }

  const total_ms = Date.now() - startedAt;

  return {
    event: { id: eventId, ...eventRecord },
    facts: writtenFacts,
    parser_version: "v0",
    timings: {
      persist_event_ms,
      parse_ms,
      persist_facts_ms,
      total_ms,
    },
  };
}

export async function reparseEvent(eventId, { parser_version = "v0" } = {}) {
  const startedAt = Date.now();

  const { data: event, error } = await supabase
    .from("events")
    .select("id, trace_id, chat_id, user_id, text, meta, received_at")
    .eq("id", eventId)
    .single();

  if (error || !event) {
    console.error("[REPARSE] failed to load event:", error);
    throw new Error("failed to load event");
  }

  const parseStart = Date.now();
  const facts = parseEventToFacts(event);
  const parse_ms = Date.now() - parseStart;

  let persist_facts_ms = 0;
  let writtenFacts = [];

  if (Array.isArray(facts) && facts.length > 0) {
    const rows = facts.map((f) => {
      const payload = f.fact_payload ?? {};
      const hash = computeFactHash(event.id, f.fact_type, payload);
      return {
        event_id: event.id,
        trace_id: event.trace_id,
        chat_id: event.chat_id,
        user_id: event.user_id,
        fact_type: f.fact_type,
        fact_payload: payload,
        confidence: f.confidence ?? null,
        status: "parsed",
        parser_version,
        fact_hash: hash,
      };
    });

    const persistFactsStart = Date.now();
    const { data: upserted, error: factsErr } = await supabase
      .from("facts")
      .upsert(rows, { onConflict: "fact_hash" })
      .select(
        "id, event_id, fact_type, fact_payload, confidence, status, parser_version, fact_hash",
      );
    persist_facts_ms = Date.now() - persistFactsStart;

    if (factsErr) {
      console.error("[REPARSE] failed to upsert facts:", factsErr);
    } else if (upserted) {
      writtenFacts = upserted;
    }
  }

  const total_ms = Date.now() - startedAt;

  return {
    event,
    facts: writtenFacts,
    parser_version,
    timings: {
      persist_event_ms: 0,
      parse_ms,
      persist_facts_ms,
      total_ms,
    },
  };
}

