/**
 * API Key authentication middleware.
 *
 * Checks Authorization: Bearer <token> header or ?api_key=<token> query param.
 * If API_KEY env var is not set — dev mode, all requests pass through.
 */

import logger from "../logger.js";

const API_KEY = process.env.API_KEY || "";

if (!API_KEY) {
  logger.warn("API_KEY is not set — running in dev mode (no auth)");
}

/**
 * Express middleware — validates API key.
 * Skips auth if API_KEY is not configured (dev mode).
 */
export function requireApiKey(req, res, next) {
  // Dev mode — no auth
  if (!API_KEY) return next();

  // Skip health check
  if (req.path === "/health" || req.path === "/__ping") return next();

  // Extract token from Authorization header or query param
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const queryToken = req.query?.api_key || "";

  const token = bearerToken || queryToken;

  if (!token || token !== API_KEY) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or missing API key",
    });
  }

  next();
}
