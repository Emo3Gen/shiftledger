/**
 * CRUD routes for /api/slots
 */

import { Router } from "express";
import { z } from "zod";
import { validateBody, validateQuery, validateParams } from "../middleware/validate.js";
import * as slotService from "../slotService.js";
import logger from "../logger.js";

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

/**
 * @openapi
 * /api/slots:
 *   get:
 *     summary: List active slot templates for a tenant
 *     tags: [Slots]
 *     parameters:
 *       - in: query
 *         name: tenant_id
 *         schema: { type: string, default: dev }
 *     responses:
 *       200:
 *         description: Array of slot templates
 */
router.get("/", validateQuery(SlotsQuerySchema), async (req, res) => {
  try {
    const slots = await slotService.getByTenant(req.query.tenant_id);
    res.json({ ok: true, slots });
  } catch (err) {
    logger.error({ err }, "SLOTS getByTenant error");
    res.status(500).json({ ok: false, error: "failed to load slots" });
  }
});

/**
 * @openapi
 * /api/slots:
 *   post:
 *     summary: Create a new slot template
 *     tags: [Slots]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, from_time, to_time]
 *             properties:
 *               tenant_id: { type: string, default: dev }
 *               name: { type: string }
 *               dow: { type: array, items: { type: string } }
 *               from_time: { type: string, example: "10:00" }
 *               to_time: { type: string, example: "13:00" }
 *     responses:
 *       201:
 *         description: Slot created
 */
router.post("/", validateBody(CreateSlotSchema), async (req, res) => {
  try {
    const slot = await slotService.create(req.body);
    res.status(201).json({ ok: true, slot });
  } catch (err) {
    logger.error({ err }, "SLOTS create error");
    res.status(500).json({ ok: false, error: "failed to create slot" });
  }
});

/**
 * @openapi
 * /api/slots/{id}:
 *   put:
 *     summary: Update a slot template
 *     tags: [Slots]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               from_time: { type: string }
 *               to_time: { type: string }
 *               is_active: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated slot
 */
router.put("/:id", validateParams(SlotIdParamsSchema), validateBody(UpdateSlotSchema), async (req, res) => {
  try {
    const slot = await slotService.update(req.params.id, req.body);
    res.json({ ok: true, slot });
  } catch (err) {
    logger.error({ err }, "SLOTS update error");
    res.status(500).json({ ok: false, error: "failed to update slot" });
  }
});

/**
 * @openapi
 * /api/slots/{id}:
 *   delete:
 *     summary: Deactivate (soft-delete) a slot template
 *     tags: [Slots]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Deactivated slot
 */
router.delete("/:id", validateParams(SlotIdParamsSchema), async (req, res) => {
  try {
    const slot = await slotService.deactivate(req.params.id);
    res.json({ ok: true, slot });
  } catch (err) {
    logger.error({ err }, "SLOTS deactivate error");
    res.status(500).json({ ok: false, error: "failed to deactivate slot" });
  }
});

export default router;
