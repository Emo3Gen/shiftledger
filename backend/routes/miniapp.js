/**
 * Telegram Mini App API routes — full functionality.
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { validateInitData, createToken, requireMiniappAuth } from "../middleware/miniappAuth.js";
import * as employeeService from "../employeeService.js";
import * as settingsService from "../settingsService.js";
import * as slotService from "../slotService.js";
import { UserDirectory } from "../userDirectory.js";
import { buildDraftSchedule } from "../scheduleEngineV0.js";
import { buildTimesheet } from "../timesheetV0.js";
import { supabase } from "../supabaseClient.js";
import { fetchRecords, fetchGroupPrices } from "../paymentsService.js";
import { getBotMode, setBotMode } from "../botMode.js";
import logger from "../logger.js";

const DEFAULT_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID || "dev_seed_chat";
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function isOwnerRole(role) {
  return role === "owner" || role === "director" || role === "admin";
}

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

function formatWeekLabel(weekStartISO) {
  const d = new Date(weekStartISO + "T12:00:00");
  const end = new Date(d);
  end.setDate(d.getDate() + 6);
  const fmt = (dt) => `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}`;
  return `${fmt(d)}-${fmt(end)}`;
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
    if (f.fact_type?.startsWith("WEEK_") || f.fact_type === "SCHEDULE_BUILT") return f.fact_payload?.week_start === weekStartISO;
    if (f.fact_payload?.week_start && !f.fact_payload?.date) return f.fact_payload.week_start === weekStartISO;
    if (f.fact_payload?.date) return f.fact_payload.date >= weekStartISO && f.fact_payload.date <= weekEndISO;
    return true;
  });
}

function getTodayDow() {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date().getDay()];
}

/** Convert engine slots → rich format for miniapp */
function slotsToRich(engineSlots) {
  const result = {};
  for (const dow of DAYS) {
    result[dow] = {
      morning: null, morning_id: null, evening: null, evening_id: null,
      cleaning: false, morning_status: "EMPTY", evening_status: "EMPTY",
      morning_problem: false, evening_problem: false,
      morning_available: [], evening_available: [],
    };
  }
  for (const slot of (engineSlots || [])) {
    const day = result[slot.dow];
    if (!day) continue;
    const isM = slot.slot_name === "Утро" || slot.slot_name === "morning";
    const pfx = isM ? "morning" : "evening";
    day[pfx] = slot.user_id ? (UserDirectory.getDisplayName(slot.user_id) || slot.user_id) : null;
    day[`${pfx}_id`] = slot.user_id || null;
    day[`${pfx}_status`] = slot.user_id ? (slot.status || "ASSIGNED") : "EMPTY";
    day[`${pfx}_problem`] = !!(slot.is_problematic || slot.has_problem);
    day[`${pfx}_available`] = (slot.available_user_ids || []).map((uid) => ({
      id: uid,
      name: UserDirectory.getDisplayName(uid) || uid,
    }));
    if (isM && slot.cleaning_user_id) day.cleaning = true;
  }
  return result;
}

async function buildScheduleAndTimesheet(weekStartISO) {
  const settings = await settingsService.getAll("dev");
  const slotTypes = await loadSlotTypes("dev");
  const facts = await loadFacts(DEFAULT_CHAT_ID, weekStartISO);
  const schedule = buildDraftSchedule({ facts, weekStartISO, slotTypes, settings });
  const hourlyRates = UserDirectory.getAllHourlyRates();
  const timesheet = buildTimesheet({ facts, weekStartISO, hourlyRates, schedule, settings });
  return { schedule, timesheet, facts, settings, slotTypes };
}

// --- Router factory ---

export default function createMiniappRouter({ getTelegramBot }) {
  const router = Router();

  // ──── AUTH ────

  router.post("/auth", async (req, res) => {
    try {
      const { initData } = req.body;
      const isDev = !process.env.TELEGRAM_BOT_TOKEN || !initData;
      let telegramUser;
      if (isDev) {
        telegramUser = { id: 319929790, first_name: "Director" };
        logger.info("[miniapp] Dev mode auth");
      } else {
        telegramUser = validateInitData(initData);
        if (!telegramUser) return res.status(401).json({ ok: false, error: "Invalid initData" });
      }
      const employee = await employeeService.getByTelegramUserId(String(telegramUser.id));
      const role = employee?.role || "viewer";
      const employeeId = employee?.id || "";
      const token = createToken(String(telegramUser.id), role, employeeId);
      res.json({
        ok: true, token,
        user: { telegram_id: telegramUser.id, first_name: telegramUser.first_name, role, employee_id: employeeId, is_owner: isOwnerRole(role) },
      });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] POST /auth error");
      res.status(500).json({ ok: false, error: "Internal error" });
    }
  });

  router.use(requireMiniappAuth);

  // ──── DASHBOARD ────

  router.get("/dashboard", async (req, res) => {
    try {
      const weekStartISO = getMonday();
      const { schedule, timesheet } = await buildScheduleAndTimesheet(weekStartISO);
      const employees = await employeeService.getAll();
      const activeEmployees = employees.filter((e) => e.is_active);

      let pendingPayments = 0;
      try {
        const records = await fetchRecords(getTomorrow());
        pendingPayments = (records?.records || []).filter((r) => r.status === "unpaid" || r.status === "trial").length;
      } catch {}

      const team = activeEmployees.map((emp) => {
        const ts = timesheet.employees.find((e) => e.user_id === emp.id);
        return { id: emp.id, name: emp.name, role: emp.role || "staff", hours: ts?.effective_hours || 0, pay: ts?.total_pay || 0 };
      });

      res.json({
        kpi: {
          employee_count: activeEmployees.length,
          total_payroll: timesheet.totals?.total_pay || 0,
          total_hours: timesheet.totals?.total_hours || 0,
          pending_payments: pendingPayments,
        },
        team,
        week_state: schedule.week_state || "COLLECTING",
      });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] GET /dashboard error");
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ──── SCHEDULE (rich format) ────

  router.get("/schedule", async (req, res) => {
    try {
      const weekStartISO = req.query.week_start || getMonday();
      const { schedule, timesheet } = await buildScheduleAndTimesheet(weekStartISO);
      const slots = slotsToRich(schedule.slots);
      const empHours = {};
      for (const e of timesheet.employees) {
        empHours[e.user_id] = { hours: e.effective_hours, min: UserDirectory.getUser(e.user_id)?.min_hours_per_week || 0 };
      }

      res.json({ week: formatWeekLabel(weekStartISO), week_start: weekStartISO, today_dow: getTodayDow(), slots, employee_hours: empHours });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] GET /schedule error");
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ──── EMPLOYEES (full CRUD) ────

  router.get("/employees", async (req, res) => {
    try {
      const full = req.query.full === "true";
      const employees = await employeeService.getAll();
      const list = employees.filter((e) => e.is_active).map((e) => {
        if (!full) return { id: e.id, name: e.name, role: e.role || "staff" };
        return {
          id: e.id, name: e.name, role: e.role || "staff",
          rate_per_hour: e.rate_per_hour, min_hours_per_week: e.min_hours_per_week,
          max_hours_per_week: e.max_hours_per_week, auto_schedule: e.auto_schedule,
          branch: e.branch, telegram_user_id: e.telegram_user_id || null,
          skill_level: e.skill_level || "beginner",
        };
      });
      res.json(list);
    } catch (e) {
      logger.error({ err: e }, "[miniapp] GET /employees error");
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.post("/employees", async (req, res) => {
    try {
      if (!isOwnerRole(req.telegramUser.role)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const emp = await employeeService.create(req.body);
      res.json({ ok: true, employee: emp });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] POST /employees error");
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.put("/employees/:id", async (req, res) => {
    try {
      if (!isOwnerRole(req.telegramUser.role)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const emp = await employeeService.update(req.params.id, req.body);
      res.json({ ok: true, employee: emp });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] PUT /employees/:id error");
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.delete("/employees/:id", async (req, res) => {
    try {
      if (!isOwnerRole(req.telegramUser.role)) return res.status(403).json({ ok: false, error: "Forbidden" });
      await employeeService.deactivate(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] DELETE /employees/:id error");
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ──── SCHEDULE ACTIONS: Propose / Lock / Reset ────

  router.post("/schedule/propose", async (req, res) => {
    try {
      if (!isOwnerRole(req.telegramUser.role)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const weekStartISO = req.body.week_start || getMonday();
      const { schedule } = await buildScheduleAndTimesheet(weekStartISO);
      res.json({ ok: true, week_start: weekStartISO, slots_count: (schedule.slots || []).length });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] POST /schedule/propose error");
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/schedule/lock", async (req, res) => {
    try {
      if (!isOwnerRole(req.telegramUser.role)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const weekStartISO = req.body.week_start || getMonday();
      const chatId = DEFAULT_CHAT_ID;
      // Insert WEEK_STATE_CHANGE fact → ACTIVE
      await supabase.from("facts").insert({
        id: randomUUID(), chat_id: chatId, event_id: `miniapp-lock-${Date.now()}`,
        fact_type: "WEEK_STATE_CHANGE",
        fact_payload: { week_start: weekStartISO, new_state: "ACTIVE", source: "miniapp" },
        created_at: new Date().toISOString(),
      });
      res.json({ ok: true, week_start: weekStartISO, state: "ACTIVE" });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] POST /schedule/lock error");
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/schedule/reset", async (req, res) => {
    try {
      if (!isOwnerRole(req.telegramUser.role)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const weekStartISO = req.body.week_start || getMonday();
      const chatId = DEFAULT_CHAT_ID;
      // Delete SHIFT_ASSIGNMENT facts for this week
      const { data: facts } = await supabase.from("facts").select("id, fact_payload").eq("chat_id", chatId).eq("fact_type", "SHIFT_ASSIGNMENT").limit(1000);
      const toDelete = (facts || []).filter((f) => f.fact_payload?.week_start === weekStartISO).map((f) => f.id);
      if (toDelete.length > 0) await supabase.from("facts").delete().in("id", toDelete);
      // Insert WEEK_STATE_CHANGE → COLLECTING
      await supabase.from("facts").insert({
        id: randomUUID(), chat_id: chatId, event_id: `miniapp-reset-${Date.now()}`,
        fact_type: "WEEK_STATE_CHANGE",
        fact_payload: { week_start: weekStartISO, new_state: "COLLECTING", source: "miniapp" },
        created_at: new Date().toISOString(),
      });
      res.json({ ok: true, week_start: weekStartISO, state: "COLLECTING", deleted: toDelete.length });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] POST /schedule/reset error");
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ──── SCHEDULE SLOT UPDATE ────

  router.put("/schedule/slot", async (req, res) => {
    try {
      if (!isOwnerRole(req.telegramUser.role)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const { week_start, day, slot, employee_id, cleaning } = req.body;
      if (!week_start || !day || !slot) return res.status(400).json({ ok: false, error: "week_start, day, slot required" });
      if (!DAYS.includes(day)) return res.status(400).json({ ok: false, error: "Invalid day" });
      if (slot !== "morning" && slot !== "evening") return res.status(400).json({ ok: false, error: "Invalid slot" });

      const slotName = slot === "morning" ? "Утро" : "Вечер";
      const chatId = DEFAULT_CHAT_ID;

      // Delete existing assignments for this slot
      const { data: allFacts } = await supabase.from("facts").select("*").eq("chat_id", chatId).eq("fact_type", "SHIFT_ASSIGNMENT").limit(500);
      const slotFacts = (allFacts || []).filter((f) => f.fact_payload?.week_start === week_start && f.fact_payload?.dow === day && f.fact_payload?.slot_name === slotName);
      if (slotFacts.length > 0) await supabase.from("facts").delete().in("id", slotFacts.map((f) => f.id));

      if (employee_id) {
        await supabase.from("facts").insert({
          id: randomUUID(), chat_id: chatId, event_id: `miniapp-${Date.now()}`, fact_type: "SHIFT_ASSIGNMENT",
          fact_payload: { week_start, dow: day, slot_name: slotName, user_id: employee_id, source: "miniapp" },
          created_at: new Date().toISOString(),
        });
      }

      if (typeof cleaning === "boolean" && slot === "morning") {
        const { data: cleanFacts } = await supabase.from("facts").select("*").eq("chat_id", chatId).eq("fact_type", "CLEANING_DONE").limit(500);
        const slotClean = (cleanFacts || []).filter((f) => f.fact_payload?.week_start === week_start && f.fact_payload?.dow === day);
        if (slotClean.length > 0) await supabase.from("facts").delete().in("id", slotClean.map((f) => f.id));
        if (cleaning && employee_id) {
          await supabase.from("facts").insert({
            id: randomUUID(), chat_id: chatId, event_id: `miniapp-clean-${Date.now()}`, fact_type: "CLEANING_DONE",
            fact_payload: { week_start, dow: day, user_id: employee_id, source: "miniapp" },
            created_at: new Date().toISOString(),
          });
        }
      }

      const name = employee_id ? (UserDirectory.getDisplayName(employee_id) || employee_id) : null;
      res.json({ ok: true, slot: { day, slot, name, employee_id: employee_id || null, cleaning: !!cleaning } });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] PUT /schedule/slot error");
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ──── PAYROLL (rich) ────

  router.get("/payroll", async (req, res) => {
    try {
      const weekStartISO = req.query.week_start || getMonday();
      const period = req.query.period || "week"; // week | first_half | second_half | month

      // For multi-week periods, aggregate
      const weekStarts = [];
      if (period === "week") {
        weekStarts.push(weekStartISO);
      } else {
        const d = new Date(weekStartISO + "T12:00:00");
        const year = d.getFullYear();
        const month = d.getMonth();
        let start, end;
        if (period === "first_half") { start = 1; end = 15; }
        else if (period === "second_half") { start = 16; end = new Date(year, month + 1, 0).getDate(); }
        else { start = 1; end = new Date(year, month + 1, 0).getDate(); }

        const periodStart = new Date(year, month, start);
        const periodEnd = new Date(year, month, end);
        // Find all Mondays in range
        const cursor = new Date(periodStart);
        cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7)); // go to Monday
        while (cursor <= periodEnd) {
          const ws = cursor.toISOString().slice(0, 10);
          const wsEnd = new Date(cursor);
          wsEnd.setDate(wsEnd.getDate() + 6);
          if (wsEnd >= periodStart && cursor <= periodEnd) weekStarts.push(ws);
          cursor.setDate(cursor.getDate() + 7);
        }
      }

      const aggregated = new Map();
      for (const ws of weekStarts) {
        const { timesheet } = await buildScheduleAndTimesheet(ws);
        for (const emp of timesheet.employees) {
          if (!aggregated.has(emp.user_id)) {
            aggregated.set(emp.user_id, { ...emp });
          } else {
            const a = aggregated.get(emp.user_id);
            a.shift_hours += emp.shift_hours;
            a.problem_shifts += emp.problem_shifts;
            a.problem_deduction_hours += emp.problem_deduction_hours;
            a.effective_hours += emp.effective_hours;
            a.shift_pay += emp.shift_pay;
            a.cleaning_count += emp.cleaning_count;
            a.cleaning_pay += emp.cleaning_pay;
            a.extra_classes = [...(a.extra_classes || []), ...(emp.extra_classes || [])];
            a.extra_classes_count += emp.extra_classes_count;
            a.extra_classes_total_kids += emp.extra_classes_total_kids;
            a.extra_classes_total_pay += emp.extra_classes_total_pay;
            a.extra_work = [...(a.extra_work || []), ...(emp.extra_work || [])];
            a.extra_work_approved_pay = (a.extra_work_approved_pay || 0) + (emp.extra_work_approved_pay || 0);
            a.extra_pay = [...(a.extra_pay || []), ...(emp.extra_pay || [])];
            a.extra_pay_total = (a.extra_pay_total || 0) + (emp.extra_pay_total || 0);
            a.inter_branch_hours = (a.inter_branch_hours || 0) + (emp.inter_branch_hours || 0);
            a.inter_branch_pay = (a.inter_branch_pay || 0) + (emp.inter_branch_pay || 0);
            a.total_before_rounding += emp.total_before_rounding;
            a.total_pay += emp.total_pay;
          }
        }
      }

      const { role, employeeId } = req.telegramUser;
      let employees = Array.from(aggregated.values()).map((e) => ({
        user_id: e.user_id,
        name: e.name || UserDirectory.getDisplayName(e.user_id),
        shift_hours: e.shift_hours,
        effective_hours: e.effective_hours,
        problem_shifts: e.problem_shifts,
        rate: e.rate,
        shift_pay: e.shift_pay,
        cleaning_count: e.cleaning_count,
        cleaning_pay: e.cleaning_pay,
        extra_classes_count: e.extra_classes_count,
        extra_classes_total_kids: e.extra_classes_total_kids,
        extra_classes_total_pay: e.extra_classes_total_pay,
        extra_work: e.extra_work || [],
        extra_work_approved_pay: e.extra_work_approved_pay || 0,
        extra_pay: e.extra_pay || [],
        extra_pay_total: e.extra_pay_total || 0,
        inter_branch_hours: e.inter_branch_hours || 0,
        inter_branch_pay: e.inter_branch_pay || 0,
        total_pay: e.total_pay,
      }));

      if (!isOwnerRole(role) && employeeId) {
        employees = employees.filter((e) => e.user_id === employeeId).map((e) => ({ ...e, extra_pay: [], extra_pay_total: 0 }));
      }

      const totals = {
        total_hours: employees.reduce((s, e) => s + e.effective_hours, 0),
        total_pay: employees.reduce((s, e) => s + e.total_pay, 0),
      };

      const fmt = (dt) => `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}`;
      let periodLabel;
      if (period === "week") {
        const d = new Date(weekStartISO + "T12:00:00");
        const endD = new Date(d); endD.setDate(d.getDate() + 6);
        periodLabel = `${fmt(d)} \u2013 ${fmt(endD)}`;
      } else {
        const d = new Date(weekStartISO + "T12:00:00");
        const year = d.getFullYear();
        const month = d.getMonth();
        let start, end;
        if (period === "first_half") { start = 1; end = 15; }
        else if (period === "second_half") { start = 16; end = new Date(year, month + 1, 0).getDate(); }
        else { start = 1; end = new Date(year, month + 1, 0).getDate(); }
        periodLabel = `${fmt(new Date(year, month, start))} \u2013 ${fmt(new Date(year, month, end))}`;
      }

      res.json({ period: periodLabel, employees, totals });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] GET /payroll error");
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ──── EXTRA WORK / EXTRA PAY ────

  router.post("/extra-pay", async (req, res) => {
    try {
      if (!isOwnerRole(req.telegramUser.role)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const { user_id, amount, date, comment, work_type_id, work_name, price } = req.body;
      if (!user_id) return res.status(400).json({ ok: false, error: "user_id required" });

      const chatId = DEFAULT_CHAT_ID;
      const isExtraWork = !!work_type_id;

      if (isExtraWork) {
        await supabase.from("facts").insert({
          id: randomUUID(), chat_id: chatId, event_id: `miniapp-ew-${Date.now()}`,
          fact_type: "EXTRA_WORK_REQUEST",
          fact_payload: { user_id, work_type_id, work_name: work_name || work_type_id, price: price || 0, date: date || new Date().toISOString().slice(0, 10), comment, status: "pending" },
          created_at: new Date().toISOString(),
        });
      } else {
        if (!amount) return res.status(400).json({ ok: false, error: "amount required" });
        await supabase.from("facts").insert({
          id: randomUUID(), chat_id: chatId, event_id: `miniapp-ep-${Date.now()}`,
          fact_type: "EXTRA_PAY",
          fact_payload: { user_id, amount: Number(amount), date: date || new Date().toISOString().slice(0, 10), comment },
          created_at: new Date().toISOString(),
        });
      }
      res.json({ ok: true });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] POST /extra-pay error");
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.put("/extra-pay/:id/:action", async (req, res) => {
    try {
      if (!isOwnerRole(req.telegramUser.role)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const { id, action } = req.params;
      if (action !== "approve" && action !== "reject") return res.status(400).json({ ok: false, error: "Invalid action" });

      const { data: fact } = await supabase.from("facts").select("*").eq("id", id).single();
      if (!fact) return res.status(404).json({ ok: false, error: "Not found" });

      const payload = { ...fact.fact_payload, status: action === "approve" ? "approved" : "rejected" };
      if (action === "approve") payload.approved_at = new Date().toISOString();
      else payload.rejected_at = new Date().toISOString();

      await supabase.from("facts").update({ fact_payload: payload }).eq("id", id);
      res.json({ ok: true });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] PUT /extra-pay/:id/:action error");
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.delete("/extra-pay/:id", async (req, res) => {
    try {
      if (!isOwnerRole(req.telegramUser.role)) return res.status(403).json({ ok: false, error: "Forbidden" });
      await supabase.from("facts").delete().eq("id", req.params.id);
      res.json({ ok: true });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] DELETE /extra-pay/:id error");
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ──── CATALOG ────

  router.get("/catalog", async (req, res) => {
    try {
      const settings = await settingsService.getAll("dev");
      res.json(settings["extra_work_catalog"] || []);
    } catch (e) {
      logger.error({ err: e }, "[miniapp] GET /catalog error");
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ──── PAYMENTS ────

  router.get("/payments", async (req, res) => {
    try {
      const dateStr = req.query.date || getTomorrow();
      let recordsData;
      try { recordsData = await fetchRecords(dateStr); }
      catch (e) { return res.json({ date: dateStr, groups: [], total_students: 0, total_amount: 0 }); }

      let pricesData;
      try { pricesData = await fetchGroupPrices(); } catch { pricesData = { groups: [] }; }

      const records = recordsData?.records || [];
      const bySlot = new Map();
      for (const rec of records) {
        const key = `${rec.group}|${rec.time}`;
        if (!bySlot.has(key)) bySlot.set(key, { name: rec.group, time: rec.time || "", students: [] });
        bySlot.get(key).students.push(rec);
      }
      const STATUS_MAP = { active: "subscription", compensation: "makeup", trial: "trial", unpaid: "unpaid", frozen: "subscription" };
      let totalAmount = 0;
      const groups = Array.from(bySlot.values()).map((slot) => ({
        name: slot.name, time: slot.time,
        students: slot.students.map((rec) => {
          const status = STATUS_MAP[rec.status] || rec.status;
          let amount = 0;
          if (rec.status === "active" && rec.subscription?.price) amount = rec.subscription.price;
          if (rec.status === "unpaid" || rec.status === "trial") amount = rec.subscription?.price || 0;
          totalAmount += amount;
          return { name: rec.student || "?", status, amount, parent_name: rec.parent_name || null };
        }),
      }));
      res.json({ date: dateStr, groups, total_students: records.length, total_amount: totalAmount });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] GET /payments error");
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ──── SETTINGS ────

  router.get("/settings", async (req, res) => {
    try { res.json(await settingsService.getAll("dev")); }
    catch (e) { res.status(500).json({ error: "Internal error" }); }
  });

  router.put("/settings", async (req, res) => {
    try {
      if (!isOwnerRole(req.telegramUser.role)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const { key, value } = req.body;
      if (!key) return res.status(400).json({ ok: false, error: "key required" });
      await settingsService.set("dev", key, value);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.get("/bot-mode", (_req, res) => { res.json({ mode: getBotMode() }); });
  router.post("/bot-mode", (req, res) => {
    try {
      if (!isOwnerRole(req.telegramUser.role)) return res.status(403).json({ ok: false, error: "Forbidden" });
      res.json({ ok: true, mode: setBotMode(req.body?.mode) });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  // ──── PUBLISH / SEND ────

  router.post("/schedule/publish", async (req, res) => {
    try {
      if (!isOwnerRole(req.telegramUser.role)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const bot = getTelegramBot();
      if (!bot) return res.status(503).json({ ok: false, error: "Bot not initialized" });
      const weekStartISO = req.body.week_start || getMonday();
      const { schedule } = await buildScheduleAndTimesheet(weekStartISO);
      const { generateScheduleImage } = await import("../services/scheduleImage.js");
      const { InputFile } = await import("grammy");
      const sentMsg = await bot.api.sendPhoto(DEFAULT_CHAT_ID, new InputFile(generateScheduleImage(schedule), "schedule.png"), { message_thread_id: Number(req.body.thread_id ?? 2) });
      try { await bot.api.pinChatMessage(DEFAULT_CHAT_ID, sentMsg.message_id, { disable_notification: true }); } catch {}
      res.json({ ok: true, week_start: weekStartISO, message_id: sentMsg.message_id });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] POST /schedule/publish error");
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/payments/send-list", async (req, res) => {
    try {
      if (!isOwnerRole(req.telegramUser.role)) return res.status(403).json({ ok: false, error: "Forbidden" });
      const bot = getTelegramBot();
      if (!bot) return res.status(503).json({ ok: false, error: "Bot not initialized" });
      const { sendPaymentsList } = await import("../paymentsService.js");
      const result = await sendPaymentsList(bot, DEFAULT_CHAT_ID, req.body.date || getTomorrow(), req.body.thread_id);
      res.json({ ok: true, ...result });
    } catch (e) {
      logger.error({ err: e }, "[miniapp] POST /payments/send-list error");
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  return router;
}
