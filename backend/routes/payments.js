/**
 * Routes: /api/payments/*
 * Payment list management — send daily payment lists via Telegram.
 */

import { Router } from "express";
import { sendPaymentsList } from "../paymentsService.js";
import logger from "../logger.js";

/**
 * Create payments router.
 * @param {object} deps
 * @param {Function} deps.getTelegramBot - returns current telegramBot instance
 */
export default function createPaymentsRouter({ getTelegramBot }) {
  const router = Router();

  // POST /send-list
  router.post("/send-list", async (req, res) => {
    try {
      const { date, chat_id, thread_id } = req.body;
      if (!chat_id) return res.status(400).json({ ok: false, error: "chat_id required" });

      const telegramBot = getTelegramBot();
      if (!telegramBot) return res.status(503).json({ ok: false, error: "Telegram bot not initialized" });

      const targetDate = date || (() => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d.toISOString().slice(0, 10);
      })();

      const result = await sendPaymentsList(telegramBot, chat_id, targetDate, thread_id);
      res.json(result);
    } catch (e) {
      logger.error({ err: e }, "POST /api/payments/send-list error");
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  return router;
}
