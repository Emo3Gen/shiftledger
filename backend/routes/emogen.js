/**
 * Routes: /api/emogen/*
 * Proxy to Emogen bot backend — group pricing, status, silent mode.
 */

import { Router } from "express";
import { EMOGEN_API_URL, emogenAuthHeader } from "../emogenClient.js";
import logger from "../logger.js";

const router = Router();

// GET /groups — fetch group pricing from Emogen
router.get("/groups", async (_req, res) => {
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

// PUT /groups/:name — update group pricing
router.put("/groups/:name", async (req, res) => {
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

// GET /status — proxy Emogen /health
router.get("/status", async (_req, res) => {
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

// POST /silent-mode — toggle Emogen silent mode
router.post("/silent-mode", async (req, res) => {
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

export default router;
