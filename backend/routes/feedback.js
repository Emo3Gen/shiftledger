/**
 * SL-032: CRUD routes for /api/feedback (ticket system)
 */
import { Router } from "express";
import { z } from "zod";
import { validateBody, validateQuery, validateParams } from "../middleware/validate.js";
import { supabase } from "../supabaseClient.js";
import logger from "../logger.js";

const router = Router();

// --- Zod schemas ---

const CreateFeedbackSchema = z.object({
  type: z.enum(["bug", "feature", "question", "other"]).default("bug"),
  text: z.string().min(1).max(2000),
  screenshot_url: z.string().max(500).optional(),
  page_url: z.string().max(500).optional(),
  created_by: z.string().max(200).optional(),
});

const UpdateFeedbackSchema = z.object({
  status: z.enum(["new", "in_progress", "resolved", "closed"]).optional(),
  response: z.string().max(2000).optional(),
});

const FeedbackQuerySchema = z.object({
  status: z.string().max(20).optional(),
  type: z.string().max(20).optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
});

const IdParamSchema = z.object({
  id: z.string().min(1),
});

// --- Routes ---

// GET / — list tickets
router.get("/", validateQuery(FeedbackQuerySchema), async (req, res) => {
  try {
    const { status, type, limit } = req.query;
    const lim = Number(limit) || 50;

    let query = supabase
      .from("feedback")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(lim);

    if (status) query = query.eq("status", status);
    if (type) query = query.eq("type", type);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ ok: true, items: data || [] });
  } catch (e) {
    logger.error({ err: e }, "GET /api/feedback error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST / — create ticket
router.post("/", validateBody(CreateFeedbackSchema), async (req, res) => {
  try {
    const { type, text, screenshot_url, page_url, created_by } = req.body;

    const { data, error } = await supabase
      .from("feedback")
      .insert([{ type, text, screenshot_url, page_url, created_by }])
      .select("*")
      .single();

    if (error) throw error;

    logger.info({ id: data.id, type, created_by }, "Feedback ticket created");
    res.status(201).json({ ok: true, feedback: data });
  } catch (e) {
    logger.error({ err: e }, "POST /api/feedback error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// GET /:id — single ticket
router.get("/:id", validateParams(IdParamSchema), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("feedback")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ ok: false, error: "Not found" });

    res.json({ ok: true, feedback: data });
  } catch (e) {
    logger.error({ err: e }, "GET /api/feedback/:id error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// PATCH /:id — update ticket (status, response)
router.patch("/:id", validateParams(IdParamSchema), validateBody(UpdateFeedbackSchema), async (req, res) => {
  try {
    const patch = { ...req.body, updated_at: new Date().toISOString() };
    if (req.body.status === "resolved") {
      patch.responded_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from("feedback")
      .update(patch)
      .eq("id", req.params.id)
      .select("*")
      .single();

    if (error) throw error;

    logger.info({ id: req.params.id, patch }, "Feedback ticket updated");
    res.json({ ok: true, feedback: data });
  } catch (e) {
    logger.error({ err: e }, "PATCH /api/feedback/:id error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /check — manual trigger for AI classification
router.post("/check", async (_req, res) => {
  try {
    const { classifyNewTickets } = await import("../crons/ticketMonitor.js");
    const processed = await classifyNewTickets();
    res.json({ ok: true, processed });
  } catch (e) {
    logger.error({ err: e }, "POST /api/feedback/check error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
