/**
 * CRUD routes for /api/settings
 */

import { Router } from "express";
import { z } from "zod";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import * as settingsService from "../settingsService.js";
import logger from "../logger.js";

const router = Router();

// --- Zod schemas ---

const SettingsQuerySchema = z.object({
  tenant_id: z.string().min(1).max(100).default("dev"),
  prefix: z.string().min(1).max(200).optional(),
});

const SettingsKeyParamsSchema = z.object({
  key: z.string().min(1).max(200),
});

const UpdateSettingBodySchema = z.object({
  value: z.any(),
  description: z.string().max(500).optional(),
  tenant_id: z.string().min(1).max(100).default("dev"),
});

const BulkSettingsBodySchema = z.object({
  tenant_id: z.string().min(1).max(100).default("dev"),
  settings: z.array(
    z.object({
      key: z.string().min(1).max(200),
      value: z.any(),
      description: z.string().max(500).optional(),
    })
  ).min(1).max(50),
});

// --- Routes ---

/**
 * GET /api/settings?tenant_id=dev&prefix=pay.
 * Returns all settings (or filtered by prefix).
 */
router.get("/", validateQuery(SettingsQuerySchema), async (req, res) => {
  try {
    const tenantId = req.query.tenant_id || "dev";
    const prefix = req.query.prefix;

    let settings;
    if (prefix) {
      settings = await settingsService.getGroup(tenantId, prefix);
    } else {
      settings = await settingsService.getAll(tenantId);
    }
    res.json({ ok: true, settings });
  } catch (err) {
    logger.error({ err }, "SETTINGS getAll error");
    res.status(500).json({ ok: false, error: "failed to load settings" });
  }
});

/**
 * GET /api/settings/:key?tenant_id=dev
 * Returns a single setting value.
 */
router.get("/:key", validateParams(SettingsKeyParamsSchema), async (req, res) => {
  try {
    const tenantId = req.query.tenant_id || "dev";
    const value = await settingsService.get(tenantId, req.params.key);
    res.json({ ok: true, key: req.params.key, value });
  } catch (err) {
    logger.error({ err }, "SETTINGS get error");
    res.status(500).json({ ok: false, error: "failed to load setting" });
  }
});

/**
 * PUT /api/settings/:key
 * Upsert a single setting.
 */
router.put("/:key", validateParams(SettingsKeyParamsSchema), validateBody(UpdateSettingBodySchema), async (req, res) => {
  try {
    const tenantId = req.body.tenant_id || "dev";
    const result = await settingsService.set(tenantId, req.params.key, req.body.value, req.body.description);
    res.json({ ok: true, setting: result });
  } catch (err) {
    logger.error({ err }, "SETTINGS set error");
    res.status(500).json({ ok: false, error: "failed to update setting" });
  }
});

/**
 * POST /api/settings/bulk
 * Bulk upsert multiple settings.
 */
router.post("/bulk", validateBody(BulkSettingsBodySchema), async (req, res) => {
  try {
    const tenantId = req.body.tenant_id || "dev";
    const results = await settingsService.bulkSet(tenantId, req.body.settings);
    res.json({ ok: true, updated: results.length, settings: results });
  } catch (err) {
    logger.error({ err }, "SETTINGS bulkSet error");
    res.status(500).json({ ok: false, error: "failed to bulk update settings" });
  }
});

export default router;
