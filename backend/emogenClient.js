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

// Shared Emogen hours cache (set by server.js, read by routes/paraplan.js)
let _emogenHoursCache = null;
export function setEmogenHoursCache(cache) { _emogenHoursCache = cache; }
export function getEmogenHoursCache() { return _emogenHoursCache; }

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
