import rateLimit from "express-rate-limit";

const generalMax = parseInt(process.env.RATE_LIMIT_GENERAL, 10) || 100;
const ingestMax = parseInt(process.env.RATE_LIMIT_INGEST, 10) || 30;

/** Global rate limiter — 100 req / 15 min */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: generalMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests", retry_after_seconds: 900 },
});

/** Stricter limiter for /ingest and /debug/send — 30 req / 1 min */
export const ingestLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: ingestMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many messages, slow down" },
});
