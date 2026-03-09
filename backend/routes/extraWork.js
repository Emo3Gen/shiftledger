/**
 * Routes for /api/extra-work (employee work requests) and /api/extra-pay (director bonuses)
 *
 * Extra work: catalog-based requests from employees, need approval.
 * Extra pay: arbitrary bonuses from director, no approval needed.
 *
 * Both stored as facts in the facts table for consistency with the timesheet engine.
 */

import { Router } from "express";
import { z } from "zod";
import { validateBody, validateQuery, validateParams } from "../middleware/validate.js";
import { supabase } from "../supabaseClient.js";
import * as settingsService from "../settingsService.js";
import { randomUUID } from "crypto";
import logger from "../logger.js";
import { UserDirectory } from "../userDirectory.js";

const router = Router();

// Helper: insert a system event into the chat
async function insertSystemEvent(chatId, text) {
  const sysEvent = {
    trace_id: randomUUID(),
    source: "system",
    chat_id: chatId,
    user_id: "system",
    text,
    role: "system",
    meta: { system_message: true },
    status: "received",
    received_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("events").insert(sysEvent);
  if (error) logger.error({ err: error }, "Failed to insert system event");
}

// --- Zod schemas ---

const ExtraWorkCreateSchema = z.object({
  user_id: z.string().min(1).max(100),
  work_type_id: z.string().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  comment: z.string().max(500).optional(),
  chat_id: z.string().min(1).max(200).optional(),
});

const ExtraWorkQuerySchema = z.object({
  chat_id: z.string().max(200).optional(),
  user_id: z.string().max(100).optional(),
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.string().max(20).optional(),
});

const IdParamSchema = z.object({
  id: z.string().min(1),
});

const ExtraPayCreateSchema = z.object({
  user_id: z.string().min(1).max(100),
  amount: z.number().min(0),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  comment: z.string().max(500).optional(),
  chat_id: z.string().min(1).max(200).optional(),
});

const ExtraPayQuerySchema = z.object({
  chat_id: z.string().max(200).optional(),
  user_id: z.string().max(100).optional(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// ============================================================
// EXTRA WORK (catalog-based, needs approval)
// ============================================================

/**
 * POST /api/extra-work — create extra work request
 */
router.post("/extra-work", validateBody(ExtraWorkCreateSchema), async (req, res) => {
  try {
    const { user_id, work_type_id, date, comment, chat_id } = req.body;

    // Look up catalog entry
    const settings = await settingsService.getAll("dev");
    const catalog = settings.extra_work_catalog || [];
    const workType = catalog.find((w) => w.id === work_type_id);
    if (!workType) {
      return res.status(400).json({ ok: false, error: `work_type_id "${work_type_id}" not found in catalog` });
    }

    const now = new Date().toISOString();
    const factDate = date || now.slice(0, 10);
    const traceId = randomUUID();

    const row = {
      event_id: null,
      trace_id: traceId,
      chat_id: chat_id || "director",
      user_id,
      fact_type: "EXTRA_WORK_REQUEST",
      fact_payload: {
        work_type_id,
        work_name: workType.name,
        price: workType.price,
        date: factDate,
        comment: comment || null,
        status: "pending",
      },
      confidence: 1.0,
      status: "parsed",
      parser_version: "api",
      fact_hash: `ew_${traceId}`,
      created_at: now,
    };

    const { data, error } = await supabase.from("facts").insert(row).select("*").single();
    if (error) throw error;

    res.status(201).json({ ok: true, extra_work: data });
  } catch (err) {
    logger.error({ err }, "POST /api/extra-work error");
    res.status(500).json({ ok: false, error: "failed to create extra work request" });
  }
});

/**
 * GET /api/extra-work — list extra work requests
 */
router.get("/extra-work", validateQuery(ExtraWorkQuerySchema), async (req, res) => {
  try {
    const { chat_id, user_id, week_start, period_start, period_end, status } = req.query;

    let query = supabase
      .from("facts")
      .select("*")
      .eq("fact_type", "EXTRA_WORK_REQUEST")
      .order("created_at", { ascending: false })
      .limit(200);

    if (chat_id) query = query.eq("chat_id", chat_id);
    if (user_id) query = query.eq("user_id", user_id);
    if (status) query = query.eq("fact_payload->>status", status);

    const { data, error } = await query;
    if (error) throw error;

    let items = data || [];

    // Filter by date range if provided
    if (period_start || period_end || week_start) {
      items = items.filter((f) => {
        const d = f.fact_payload?.date;
        if (!d) return true;
        if (week_start) {
          const ws = new Date(week_start);
          const we = new Date(ws);
          we.setDate(we.getDate() + 6);
          return d >= week_start && d <= we.toISOString().slice(0, 10);
        }
        if (period_start && d < period_start) return false;
        if (period_end && d > period_end) return false;
        return true;
      });
    }

    res.json({ ok: true, items });
  } catch (err) {
    logger.error({ err }, "GET /api/extra-work error");
    res.status(500).json({ ok: false, error: "failed to load extra work requests" });
  }
});

/**
 * DELETE /api/extra-work/clear — delete all EXTRA_WORK_REQUEST facts (optionally filter by chat_id)
 */
router.delete("/extra-work/clear", async (req, res) => {
  try {
    let query = supabase
      .from("facts")
      .delete()
      .eq("fact_type", "EXTRA_WORK_REQUEST");

    if (req.query.chat_id) {
      query = query.eq("chat_id", req.query.chat_id);
    }

    const { error } = await query;
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /api/extra-work/clear error");
    res.status(500).json({ ok: false, error: "failed to clear extra work requests" });
  }
});

/**
 * PUT /api/extra-work/:id/approve
 */
router.put("/extra-work/:id/approve", validateParams(IdParamSchema), async (req, res) => {
  try {
    // Load current fact
    const { data: fact, error: loadErr } = await supabase
      .from("facts")
      .select("*")
      .eq("id", req.params.id)
      .eq("fact_type", "EXTRA_WORK_REQUEST")
      .single();

    if (loadErr || !fact) {
      return res.status(404).json({ ok: false, error: "extra work request not found" });
    }

    const updatedPayload = { ...fact.fact_payload, status: "approved", approved_at: new Date().toISOString() };

    const { data, error } = await supabase
      .from("facts")
      .update({ fact_payload: updatedPayload })
      .eq("id", req.params.id)
      .select("*")
      .single();

    if (error) throw error;

    // System message: approval
    const empName = UserDirectory.getDisplayName(fact.user_id);
    const workName = fact.fact_payload?.work_name || "доп. работа";
    const price = fact.fact_payload?.price;
    const priceStr = price ? ` (${price}\u20BD)` : "";
    await insertSystemEvent(fact.chat_id, `\u2705 Утверждено: ${workName} для ${empName}${priceStr}`);

    res.json({ ok: true, extra_work: data });
  } catch (err) {
    logger.error({ err }, "PUT /api/extra-work/:id/approve error");
    res.status(500).json({ ok: false, error: "failed to approve" });
  }
});

/**
 * PUT /api/extra-work/:id/reject
 */
router.put("/extra-work/:id/reject", validateParams(IdParamSchema), async (req, res) => {
  try {
    const { data: fact, error: loadErr } = await supabase
      .from("facts")
      .select("*")
      .eq("id", req.params.id)
      .eq("fact_type", "EXTRA_WORK_REQUEST")
      .single();

    if (loadErr || !fact) {
      return res.status(404).json({ ok: false, error: "extra work request not found" });
    }

    const updatedPayload = { ...fact.fact_payload, status: "rejected", rejected_at: new Date().toISOString() };

    const { data, error } = await supabase
      .from("facts")
      .update({ fact_payload: updatedPayload })
      .eq("id", req.params.id)
      .select("*")
      .single();

    if (error) throw error;

    // System message: rejection
    const empName = UserDirectory.getDisplayName(fact.user_id);
    const workName = fact.fact_payload?.work_name || "доп. работа";
    await insertSystemEvent(fact.chat_id, `\u274C Отклонено: ${workName} для ${empName}`);

    res.json({ ok: true, extra_work: data });
  } catch (err) {
    logger.error({ err }, "PUT /api/extra-work/:id/reject error");
    res.status(500).json({ ok: false, error: "failed to reject" });
  }
});

/**
 * DELETE /api/extra-work/:id — delete extra work request
 */
router.delete("/extra-work/:id", validateParams(IdParamSchema), async (req, res) => {
  try {
    const { error } = await supabase
      .from("facts")
      .delete()
      .eq("id", req.params.id)
      .eq("fact_type", "EXTRA_WORK_REQUEST");

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /api/extra-work/:id error");
    res.status(500).json({ ok: false, error: "failed to delete extra work request" });
  }
});

// ============================================================
// EXTRA PAY (director arbitrary bonuses)
// ============================================================

/**
 * POST /api/extra-pay — add arbitrary bonus
 */
router.post("/extra-pay", validateBody(ExtraPayCreateSchema), async (req, res) => {
  try {
    const { user_id, amount, date, comment, chat_id } = req.body;

    const now = new Date().toISOString();
    const factDate = date || now.slice(0, 10);
    const traceId = randomUUID();

    const row = {
      event_id: null,
      trace_id: traceId,
      chat_id: chat_id || "director",
      user_id,
      fact_type: "EXTRA_PAY",
      fact_payload: {
        amount,
        date: factDate,
        comment: comment || null,
      },
      confidence: 1.0,
      status: "parsed",
      parser_version: "api",
      fact_hash: `ep_${traceId}`,
      created_at: now,
    };

    const { data, error } = await supabase.from("facts").insert(row).select("*").single();
    if (error) throw error;

    res.status(201).json({ ok: true, extra_pay: data });
  } catch (err) {
    logger.error({ err }, "POST /api/extra-pay error");
    res.status(500).json({ ok: false, error: "failed to create extra pay" });
  }
});

/**
 * GET /api/extra-pay — list extra pay entries
 */
router.get("/extra-pay", validateQuery(ExtraPayQuerySchema), async (req, res) => {
  try {
    const { chat_id, user_id, period_start, period_end } = req.query;

    let query = supabase
      .from("facts")
      .select("*")
      .eq("fact_type", "EXTRA_PAY")
      .order("created_at", { ascending: false })
      .limit(200);

    if (chat_id) query = query.eq("chat_id", chat_id);
    if (user_id) query = query.eq("user_id", user_id);

    const { data, error } = await query;
    if (error) throw error;

    let items = data || [];
    if (period_start || period_end) {
      items = items.filter((f) => {
        const d = f.fact_payload?.date;
        if (!d) return true;
        if (period_start && d < period_start) return false;
        if (period_end && d > period_end) return false;
        return true;
      });
    }

    res.json({ ok: true, items });
  } catch (err) {
    logger.error({ err }, "GET /api/extra-pay error");
    res.status(500).json({ ok: false, error: "failed to load extra pay" });
  }
});

/**
 * DELETE /api/extra-pay/clear — delete all EXTRA_PAY facts (optionally filter by chat_id)
 */
router.delete("/extra-pay/clear", async (req, res) => {
  try {
    let query = supabase
      .from("facts")
      .delete()
      .eq("fact_type", "EXTRA_PAY");

    if (req.query.chat_id) {
      query = query.eq("chat_id", req.query.chat_id);
    }

    const { error } = await query;
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /api/extra-pay/clear error");
    res.status(500).json({ ok: false, error: "failed to clear extra pay" });
  }
});

/**
 * DELETE /api/extra-pay/:id — delete extra pay entry
 */
router.delete("/extra-pay/:id", validateParams(IdParamSchema), async (req, res) => {
  try {
    const { error } = await supabase
      .from("facts")
      .delete()
      .eq("id", req.params.id)
      .eq("fact_type", "EXTRA_PAY");

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /api/extra-pay/:id error");
    res.status(500).json({ ok: false, error: "failed to delete extra pay" });
  }
});

export default router;
