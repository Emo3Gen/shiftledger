/**
 * Telegram Mini App API routes.
 *
 * POST /auth        — authenticate via Telegram initData
 * GET  /dashboard   — aggregated KPI + team list
 * GET  /schedule    — week schedule grid
 * GET  /payments    — tomorrow's payment list
 * GET  /payroll     — month timesheet
 * POST /schedule/publish   — publish schedule to Telegram
 * POST /payments/send-list — send payment list to Telegram
 */

import { Router } from "express";
import { validateInitData, createToken, requireMiniappAuth } from "../middleware/miniappAuth.js";
import * as employeeService from "../employeeService.js";
import * as settingsService from "../settingsService.js";
import * as slotService from "../slotService.js";
import { UserDirectory } from "../userDirectory.js";
import { buildDraftSchedule } from "../scheduleEngineV0.js";
import { buildTimesheet } from "../timesheetV0.js";
import { supabase } from "../supabaseClient.js";
import { fetchRecords, fetchGroupPrices } from "../paymentsService.js";
import logger from "../logger.js";

const DEFAULT_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID || "dev_seed_chat";

// --- Helpers ---

function getMonday(offset = 0) {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) + offset * 7;
  return new Date(d.getFullYear(), d.getMonth(), diff).toISOString().slice(0, 10);
}

function getTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function loadSlotTypes(tenantId) {
  try {
    const templates = await slotService.getByTenant(tenantId || "dev");
    if (templates && templates.length > 0) {
      return templates.map((t) => ({ name: t.name, from: t.from_time, to: t.to_time }));
    }
  } catch (err) {
    logger.warn({ err }, "[miniapp] loadSlotTypes fallback to defaults");
  }
  return null;
}

async function loadFacts(chatId, weekStartISO) {
  const { data: facts, error } = await supabase
    .from("facts")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) throw error;

  const weekEnd = new Date(weekStartISO);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndISO = weekEnd.toISOString().slice(0, 10);

  return (facts || []).filter((f) => {
    if (f.fact_type?.startsWith("WEEK_") || f.fact_type === "SCHEDULE_BUILT") {
      return f.fact_payload?.week_start === weekStartISO;
    }
    if (f.fact_payload?.week_start && !f.fact_payload?.date) {
      return f.fact_payload.week_start === weekStartISO;
    }
    if (f.fact_payload?.date) {
      return f.fact_payload.date >= weekStartISO && f.fact_payload.date <= weekEndISO;
    }
    return true;
  });
}

function getTodayDow() {
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return days[new Date().getDay()];
}

// --- Router factory ---

export default function createMiniappRouter({ getTelegramBot }) {
  const router = Router();

  // POST /auth — validate initData, find employee, return session token
  router.post("/auth", async (req, res) => {
    try {
      const { initData } = req.body;

      // Dev mode: no initData → use hardcoded dev user
      const isDev = !process.env.TELEGRAM_BOT_TOKEN || !initData;

      let telegramUser;
      if (isDev) {
        telegramUser = { id: 319929790, first_name: "Director" };
        logger.info("[miniapp] Dev mode auth — no initData validation");
      } else {
        telegramUser = validateInitData(initData);
        if (!telegramUser) {
          return res.status(401).json({ ok: false, error: "Invalid initData" });
        }
      }

      // Look up employee by telegram_user_id
      const employee = await employeeService.getByTelegramUserId(String(telegramUser.id));

      // Determine role: if employee found — use their role; otherwise "viewer"
      const role = employee?.role || "viewer";
      const employeeId = employee?.id || "";
      const isOwner = role === "owner" || role === "director" || role === "admin";

      const token = createToken(String(telegramUser.id), role, employeeId);

      res.json({
        ok: true,
        token,
        user: {
          telegram_id: telegramUser.id,
          first_name: telegramUser.first_name,
          role,
          employee_id: employeeId,
          is_owner: isOwner,
        },
      });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] POST /auth error");
      res.status(500).json({ ok: false, error: "Internal error" });
    }
  });

  // --- Protected routes (require miniapp session token) ---

  router.use(requireMiniappAuth);

  // GET /dashboard — KPI + team
  router.get("/dashboard", async (req, res) => {
    try {
      const weekStartISO = getMonday();
      const settings = await settingsService.getAll("dev");
      const slotTypes = await loadSlotTypes("dev");
      const facts = await loadFacts(DEFAULT_CHAT_ID, weekStartISO);

      const schedule = buildDraftSchedule({
        facts,
        weekStartISO,
        slotTypes,
        settings,
      });

      const hourlyRates = UserDirectory.getAllHourlyRates();
      const timesheet = buildTimesheet({
        facts,
        weekStartISO,
        hourlyRates,
        schedule,
        settings,
      });

      const employees = await employeeService.getAll();
      const activeEmployees = employees.filter((e) => e.is_active);

      // Count pending payments (unpaid + trial from Emogen, if available)
      let pendingPayments = 0;
      try {
        const tomorrowStr = getTomorrow();
        const records = await fetchRecords(tomorrowStr);
        const allRecords = records?.records || [];
        pendingPayments = allRecords.filter(
          (r) => r.status === "unpaid" || r.status === "trial"
        ).length;
      } catch {
        // Emogen unavailable — just show 0
      }

      // Team list with hours and pay from timesheet
      const team = activeEmployees.map((emp) => {
        const ts = timesheet.employees.find((e) => e.user_id === emp.id);
        return {
          id: emp.id,
          name: emp.name,
          role: emp.role || "staff",
          hours: ts?.effective_hours || 0,
          pay: ts?.total_pay || 0,
        };
      });

      // Week state from schedule
      const weekState = schedule.week_state || "COLLECTING";

      res.json({
        kpi: {
          employee_count: activeEmployees.length,
          total_payroll: timesheet.totals?.total_pay || 0,
          total_hours: timesheet.totals?.total_hours || 0,
          pending_payments: pendingPayments,
        },
        team,
        week_state: weekState,
      });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] GET /dashboard error");
      res.status(500).json({ error: "Internal error" });
    }
  });

  // GET /schedule?week_start=YYYY-MM-DD
  router.get("/schedule", async (req, res) => {
    try {
      const weekStartISO = req.query.week_start || getMonday();
      const settings = await settingsService.getAll("dev");
      const slotTypes = await loadSlotTypes("dev");
      const facts = await loadFacts(DEFAULT_CHAT_ID, weekStartISO);

      const schedule = buildDraftSchedule({
        facts,
        weekStartISO,
        slotTypes,
        settings,
      });

      // Enrich slots with user display names
      const slots = (schedule.slots || []).map((slot) => ({
        dow: slot.dow,
        slot_name: slot.slot_name,
        from: slot.from,
        to: slot.to,
        user_id: slot.user_id || null,
        user_name: slot.user_id ? UserDirectory.getDisplayName(slot.user_id) : null,
        status: slot.status,
        replaced_user_id: slot.replaced_user_id || null,
        replaced_user_name: slot.replaced_user_id
          ? UserDirectory.getDisplayName(slot.replaced_user_id)
          : null,
        cleaning_user_id: slot.cleaning_user_id || null,
        cleaning_user_name: slot.cleaning_user_id
          ? UserDirectory.getDisplayName(slot.cleaning_user_id)
          : null,
      }));

      res.json({
        week_start: weekStartISO,
        today_dow: getTodayDow(),
        slots,
      });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] GET /schedule error");
      res.status(500).json({ error: "Internal error" });
    }
  });

  // GET /payments?date=YYYY-MM-DD
  router.get("/payments", async (req, res) => {
    try {
      const dateStr = req.query.date || getTomorrow();

      let recordsData;
      try {
        recordsData = await fetchRecords(dateStr);
      } catch (e) {
        logger.warn({ err: e, date: dateStr }, "[miniapp] Emogen records unavailable");
        return res.json({ date: dateStr, groups: [], total_students: 0, total_amount: 0 });
      }

      let pricesData;
      try {
        pricesData = await fetchGroupPrices();
      } catch {
        pricesData = { groups: [] };
      }

      const records = recordsData?.records || [];

      // Group records by group+time
      const bySlot = new Map();
      for (const rec of records) {
        const key = `${rec.group}|${rec.time}`;
        if (!bySlot.has(key)) bySlot.set(key, { name: rec.group, time: rec.time || "", students: [] });
        bySlot.get(key).students.push(rec);
      }

      const STATUS_MAP = {
        active: "subscription",
        compensation: "makeup",
        trial: "trial",
        unpaid: "unpaid",
        frozen: "subscription",
      };

      let totalAmount = 0;
      const groups = Array.from(bySlot.values()).map((slot) => ({
        name: slot.name,
        time: slot.time,
        students: slot.students.map((rec) => {
          const status = STATUS_MAP[rec.status] || rec.status;
          let amount = 0;
          if (rec.status === "unpaid" || rec.status === "trial") {
            // Calculate price if possible
            const sub = rec.subscription || {};
            amount = sub.price || 0;
          }
          if (rec.status === "active" && rec.subscription?.price) {
            amount = rec.subscription.price;
          }
          totalAmount += amount;

          return {
            name: rec.student || "?",
            status,
            amount,
            parent_name: rec.parent_name || null,
          };
        }),
      }));

      res.json({
        date: dateStr,
        groups,
        total_students: records.length,
        total_amount: totalAmount,
      });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] GET /payments error");
      res.status(500).json({ error: "Internal error" });
    }
  });

  // GET /payroll?week_start=YYYY-MM-DD (defaults to current week)
  router.get("/payroll", async (req, res) => {
    try {
      const weekStartISO = req.query.week_start || getMonday();
      const settings = await settingsService.getAll("dev");
      const slotTypes = await loadSlotTypes("dev");
      const facts = await loadFacts(DEFAULT_CHAT_ID, weekStartISO);

      const schedule = buildDraftSchedule({
        facts,
        weekStartISO,
        slotTypes,
        settings,
      });

      const hourlyRates = UserDirectory.getAllHourlyRates();
      const timesheet = buildTimesheet({
        facts,
        weekStartISO,
        hourlyRates,
        schedule,
        settings,
      });

      // Role-based visibility
      const { role, employeeId } = req.telegramUser;
      const isOwner = role === "owner" || role === "director" || role === "admin";

      let employees = timesheet.employees.map((e) => ({
        user_id: e.user_id,
        name: e.name || UserDirectory.getDisplayName(e.user_id),
        effective_hours: e.effective_hours,
        shift_pay: e.shift_pay,
        cleaning_count: e.cleaning_count,
        cleaning_pay: e.cleaning_pay,
        extra_pay: (e.extra_classes_total_pay || 0) + (e.extra_work_approved_pay || 0) + (e.extra_pay_total || 0),
        total_pay: e.total_pay,
      }));

      // Staff sees only their own row
      if (!isOwner && employeeId) {
        employees = employees.filter((e) => e.user_id === employeeId);
      }

      const totals = {
        total_hours: employees.reduce((s, e) => s + e.effective_hours, 0),
        total_pay: employees.reduce((s, e) => s + e.total_pay, 0),
      };

      // Period label
      const d = new Date(weekStartISO + "T12:00:00");
      const endD = new Date(d);
      endD.setDate(d.getDate() + 6);
      const fmt = (dt) => `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}`;
      const period = `${fmt(d)} \u2013 ${fmt(endD)}`;

      res.json({ period, employees, totals });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] GET /payroll error");
      res.status(500).json({ error: "Internal error" });
    }
  });

  // POST /schedule/publish — publish schedule image to Telegram
  router.post("/schedule/publish", async (req, res) => {
    try {
      const { role } = req.telegramUser;
      if (role !== "owner" && role !== "director" && role !== "admin") {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      const bot = getTelegramBot();
      if (!bot) {
        return res.status(503).json({ ok: false, error: "Bot not initialized" });
      }

      const weekStartISO = req.body.week_start || getMonday();
      const chatId = DEFAULT_CHAT_ID;

      const settings = await settingsService.getAll("dev");
      const slotTypes = await loadSlotTypes("dev");
      const facts = await loadFacts(chatId, weekStartISO);

      const schedule = buildDraftSchedule({
        facts,
        weekStartISO,
        slotTypes,
        settings,
      });

      const { generateScheduleImage } = await import("../services/scheduleImage.js");
      const pngBuffer = generateScheduleImage(schedule);
      const { InputFile } = await import("grammy");

      const threadId = req.body.thread_id ?? 2;
      const sendOpts = {};
      if (threadId) sendOpts.message_thread_id = Number(threadId);

      const sentMsg = await bot.api.sendPhoto(
        chatId,
        new InputFile(pngBuffer, "schedule.png"),
        sendOpts,
      );

      try {
        await bot.api.pinChatMessage(chatId, sentMsg.message_id, { disable_notification: true });
      } catch (pinErr) {
        logger.warn({ err: pinErr }, "[miniapp] Failed to pin schedule");
      }

      res.json({ ok: true, week_start: weekStartISO, message_id: sentMsg.message_id });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] POST /schedule/publish error");
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // POST /payments/send-list — send payments to Telegram
  router.post("/payments/send-list", async (req, res) => {
    try {
      const { role } = req.telegramUser;
      if (role !== "owner" && role !== "director" && role !== "admin") {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      const bot = getTelegramBot();
      if (!bot) {
        return res.status(503).json({ ok: false, error: "Bot not initialized" });
      }

      const dateStr = req.body.date || getTomorrow();
      const chatId = DEFAULT_CHAT_ID;
      const threadId = req.body.thread_id;

      const { sendPaymentsList } = await import("../paymentsService.js");
      const result = await sendPaymentsList(bot, chatId, dateStr, threadId);

      res.json({ ok: true, ...result });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] POST /payments/send-list error");
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  return router;
}
