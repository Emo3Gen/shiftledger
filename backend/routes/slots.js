/**
 * CRUD routes for /api/slots
 */

import { Router } from "express";
import { z } from "zod";
import { validateBody, validateQuery, validateParams } from "../middleware/validate.js";
import * as slotService from "../slotService.js";

const router = Router();

// --- Zod schemas ---

const SlotIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const SlotsQuerySchema = z.object({
  tenant_id: z.string().min(1).max(100).default("dev"),
});

const CreateSlotSchema = z.object({
  tenant_id: z.string().min(1).max(100).default("dev"),
  name: z.string().min(1).max(200),
  dow: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).default(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
  from_time: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM"),
  to_time: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM"),
  meta: z.record(z.unknown()).optional(),
});

const UpdateSlotSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  dow: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).optional(),
  from_time: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM").optional(),
  to_time: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM").optional(),
  is_active: z.boolean().optional(),
  meta: z.record(z.unknown()).optional(),
});

// --- Routes ---

// GET /api/slots?tenant_id=...
router.get("/", validateQuery(SlotsQuerySchema), async (req, res) => {
  try {
    const slots = await slotService.getByTenant(req.query.tenant_id);
    res.json({ ok: true, slots });
  } catch (err) {
    console.error("[SLOTS] getByTenant error:", err);
    res.status(500).json({ ok: false, error: "failed to load slots" });
  }
});

// POST /api/slots — create slot
router.post("/", validateBody(CreateSlotSchema), async (req, res) => {
  try {
    const slot = await slotService.create(req.body);
    res.status(201).json({ ok: true, slot });
  } catch (err) {
    console.error("[SLOTS] create error:", err);
    res.status(500).json({ ok: false, error: "failed to create slot" });
  }
});

// PUT /api/slots/:id — update slot
router.put("/:id", validateParams(SlotIdParamsSchema), validateBody(UpdateSlotSchema), async (req, res) => {
  try {
    const slot = await slotService.update(req.params.id, req.body);
    res.json({ ok: true, slot });
  } catch (err) {
    console.error("[SLOTS] update error:", err);
    res.status(500).json({ ok: false, error: "failed to update slot" });
  }
});

// DELETE /api/slots/:id — soft delete
router.delete("/:id", validateParams(SlotIdParamsSchema), async (req, res) => {
  try {
    const slot = await slotService.deactivate(req.params.id);
    res.json({ ok: true, slot });
  } catch (err) {
    console.error("[SLOTS] deactivate error:", err);
    res.status(500).json({ ok: false, error: "failed to deactivate slot" });
  }
});

export default router;
