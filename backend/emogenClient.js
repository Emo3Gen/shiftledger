/**
 * Emogen API client — shared helper for proxying requests to Emogen backend.
 */

import logger from "./logger.js";

export const EMOGEN_API_URL = process.env.EMOGEN_API_URL || "";
const EMOGEN_API_PASSWORD = process.env.EMOGEN_API_PASSWORD || "";
export const emogenAuthHeader = EMOGEN_API_PASSWORD
  ? "Basic " + Buffer.from(":" + EMOGEN_API_PASSWORD).toString("base64")
  : "";

// When EMOGEN_API_URL is set, route Paraplan data through Emogen (no direct CRM login)
export const USE_EMOGEN_PARAPLAN = !!EMOGEN_API_URL;

// Shared Emogen caches (set by server.js, read by routes/paraplan.js)
let _emogenHoursCache = null;
let _emogenStatus = null; // { groups, teachers, lastUpdate, ready }

export function setEmogenHoursCache(cache) { _emogenHoursCache = cache; }
export function getEmogenHoursCache() { return _emogenHoursCache; }
export function setEmogenStatus(s) { _emogenStatus = s; }
export function getEmogenStatus() { return _emogenStatus; }

/**
 * Fetch from Emogen API with auth.
 * @param {string} path - e.g. "/api/paraplan/hours"
 * @param {object} [opts] - fetch options override
 * @returns {Promise<Response>}
 */
export async function emogenFetch(path, opts = {}) {
  const url = `${EMOGEN_API_URL}${path}`;
  const headers = { ...opts.headers };
  if (emogenAuthHeader) headers.Authorization = emogenAuthHeader;
  return fetch(url, { ...opts, headers });
}

/**
 * Fetch Emogen health/status and cache it.
 * Emogen /health returns { paraplan: { ready, groups, teachers, lastUpdate } }
 */
export async function refreshEmogenStatus() {
  if (!EMOGEN_API_URL) return null;
  try {
    const r = await emogenFetch("/health");
    if (!r.ok) { logger.warn({ status: r.status }, "[emogen] Health check failed"); return null; }
    const data = await r.json();
    if (data.paraplan) {
      _emogenStatus = data.paraplan;
      logger.info({ groups: data.paraplan.groups, teachers: data.paraplan.teachers }, "[emogen] Status cached");
    }
    return _emogenStatus;
  } catch (e) {
    logger.warn({ err: e.message }, "[emogen] Health fetch error");
    return null;
  }
}

/**
 * Proxy an incoming request to Emogen and pipe the JSON response back.
 */
export async function proxyToEmogen(req, res, emogenPath) {
  try {
    const r = await emogenFetch(emogenPath);
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (e) {
    logger.warn({ err: e, path: emogenPath }, "Emogen proxy error");
    res.status(502).json({ ok: false, error: "Emogen API unreachable", detail: e?.message });
  }
}
