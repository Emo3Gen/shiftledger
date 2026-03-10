/**
 * Telegram Mini App authentication middleware.
 *
 * Validates HMAC-based session tokens issued by POST /api/miniapp/auth.
 * Token format: userId.expiry.hmac
 */

import { createHmac } from "crypto";
import logger from "../logger.js";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TOKEN_SECRET = BOT_TOKEN
  ? createHmac("sha256", "miniapp-token").update(BOT_TOKEN).digest("hex")
  : "dev-secret";

// Token TTL: 24 hours
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Create a session token for a Telegram user.
 */
export function createToken(telegramUserId, role, employeeId) {
  const expiry = Date.now() + TOKEN_TTL_MS;
  const payload = `${telegramUserId}.${role}.${employeeId}.${expiry}`;
  const hmac = createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex").slice(0, 32);
  return `${payload}.${hmac}`;
}

/**
 * Parse and validate a session token.
 * @returns {{ telegramUserId: string, role: string, employeeId: string } | null}
 */
export function verifyToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;

  const [telegramUserId, role, employeeId, expiryStr, hmac] = parts;
  const expiry = Number(expiryStr);

  // Check expiry
  if (Date.now() > expiry) return null;

  // Verify HMAC
  const payload = `${telegramUserId}.${role}.${employeeId}.${expiryStr}`;
  const expected = createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex").slice(0, 32);
  if (hmac !== expected) return null;

  return { telegramUserId, role, employeeId };
}

/**
 * Validate Telegram initData HMAC signature.
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;

    // Remove hash from params and sort
    params.delete("hash");
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    // HMAC-SHA256(secret_key, data_check_string)
    // where secret_key = HMAC-SHA256("WebAppData", bot_token)
    const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const computed = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    if (computed !== hash) {
      logger.warn("Mini App initData HMAC mismatch");
      return null;
    }

    // Parse user from initData
    const userJson = params.get("user");
    if (!userJson) return null;
    return JSON.parse(userJson);
  } catch (e) {
    logger.warn({ err: e }, "validateInitData error");
    return null;
  }
}

/**
 * Express middleware — validates miniapp session token.
 * Adds req.telegramUser = { telegramUserId, role, employeeId }.
 */
export function requireMiniappAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  req.telegramUser = user;
  next();
}
