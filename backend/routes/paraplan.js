/**
 * Routes: /api/paraplan/*
 * Paraplan CRM integration — status, hours, groups, config, compensations, subscriptions.
 * In production (USE_EMOGEN_PARAPLAN), all requests proxy through Emogen.
 */

import { Router } from "express";
import * as paraplan from "../services/paraplan/index.js";
import * as settingsService from "../settingsService.js";
import { USE_EMOGEN_PARAPLAN, EMOGEN_API_URL, proxyToEmogen, getEmogenHoursCache, getEmogenStatus } from "../emogenClient.js";
import logger from "../logger.js";

const router = Router();

// GET /status
router.get("/status", async (req, res) => {
  if (USE_EMOGEN_PARAPLAN) {
    const cache = getEmogenHoursCache();
    const status = getEmogenStatus();
    return res.json({
      ok: true, mode: "emogen", configured: true, initialized: true, ready: true,
      emogen_url: EMOGEN_API_URL,
      groupCount: status?.groups || 0,
      teacherCount: status?.teachers || 0,
      daysWithHours: cache?.hours ? Object.keys(cache.hours).length : 0,
      updatedAt: cache?.updatedAt || status?.lastUpdate || null,
    });
  }
  try {
    res.json({ ok: true, ...paraplan.getStatus() });
  } catch (e) {
    logger.error({ err: e }, "GET /api/paraplan/status error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// GET /hours
router.get("/hours", async (req, res) => {
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

// GET /groups
router.get("/groups", async (req, res) => {
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

// POST /refresh
router.post("/refresh", async (req, res) => {
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

// GET /slot-overrides
router.get("/slot-overrides", async (req, res) => {
  try {
    const tenantId = req.query.tenant_id || "dev";
    const saved = await settingsService.get(tenantId, "paraplan_slot_overrides");
    res.json({ ok: true, slot_overrides: saved || {} });
  } catch (e) {
    logger.error({ err: e }, "GET /api/paraplan/slot-overrides error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// PUT /slot-overrides
router.put("/slot-overrides", async (req, res) => {
  try {
    const tenantId = req.body.tenant_id || "dev";
    const { slot_overrides } = req.body;
    await settingsService.set(tenantId, "paraplan_slot_overrides", slot_overrides || {}, "Slot-level complexity overrides");
    res.json({ ok: true, slot_overrides });
  } catch (e) {
    logger.error({ err: e }, "PUT /api/paraplan/slot-overrides error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// GET /schedule
router.get("/schedule", async (req, res) => {
  if (USE_EMOGEN_PARAPLAN) return proxyToEmogen(req, res, "/api/paraplan/schedule");
  res.json({ ok: false, error: "Direct Paraplan schedule not implemented" });
});

// GET /groups-config
router.get("/groups-config", async (req, res) => {
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
      await settingsService.set(tenantId, "paraplan_groups", config, "Paraplan groups config with requires_junior flag");
      return res.json({ ok: true, groups: config, source: "auto-generated" });
    }

    res.json({ ok: true, groups: saved || [], source: "saved" });
  } catch (e) {
    logger.error({ err: e }, "GET /api/paraplan/groups-config error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// PUT /groups-config
router.put("/groups-config", async (req, res) => {
  try {
    const tenantId = req.body.tenant_id || "dev";
    const { groups } = req.body;
    if (!Array.isArray(groups)) {
      return res.status(400).json({ ok: false, error: "groups array required" });
    }
    await settingsService.set(tenantId, "paraplan_groups", groups, "Paraplan groups config");

    if (paraplan.isReady()) {
      await paraplan.refreshWithFilter(groups);
    }

    res.json({ ok: true, groups });
  } catch (e) {
    logger.error({ err: e }, "PUT /api/paraplan/groups-config error");
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /sync-groups
router.post("/sync-groups", async (req, res) => {
  if (USE_EMOGEN_PARAPLAN) return proxyToEmogen(req, res, "/api/paraplan/sync-groups");
  try {
    const tenantId = req.body.tenant_id || "dev";
    if (!paraplan.isReady()) {
      return res.status(400).json({ ok: false, error: "Paraplan not ready" });
    }

    await paraplan.refresh();
    const freshGroups = paraplan.getGroups();

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

// GET /compensations
router.get("/compensations", async (req, res) => {
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

// GET /subscriptions
router.get("/subscriptions", async (_req, res) => {
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

export default router;
