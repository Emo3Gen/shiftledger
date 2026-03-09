/**
 * Timesheet Engine v0
 *
 * Principle: final schedule = fact.
 * shift_hours come directly from schedule assignments.
 * Problem shifts get -1h deduction each.
 * Cleanings: default = evening shift user, override with CLEANING_SWAP/CLEANING_DONE.
 * Extra classes: tiered pricing based on kids_count.
 * total_pay rounded UP to nearest 100.
 */

import { UserDirectory } from "./userDirectory.js";

function calculateHours(from, to) {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  return Math.max(0, th + (tm || 0) / 60 - (fh + (fm || 0) / 60));
}

const DEFAULT_CLEANING_RATE = 500; // ₽ per cleaning
const EXTRA_CLASS_BASE_RATE = 500; // ₽ per extra class
const EXTRA_CLASS_KIDS_THRESHOLD = 8; // kids threshold
const EXTRA_CLASS_PER_KID_RATE = 100; // ₽ per kid above threshold

/**
 * @param {Object} params
 * @param {Object} params.schedule - Schedule from buildDraftSchedule (contains assignments, cleaning_assignments)
 * @param {Array}  params.facts - Array of persisted facts
 * @param {string} params.weekStartISO - ISO date string for Monday (YYYY-MM-DD)
 * @param {Object} params.hourlyRates - Map of user_id -> hourly rate
 * @param {Object} [params.settings] - Tenant settings (from settingsService.getAll). Optional, falls back to hardcoded defaults.
 * @returns {Object} - { week_start, employees: [], totals: {} }
 */
export function buildTimesheet({ schedule, facts, weekStartISO, hourlyRates, settings }) {
  // Resolve configurable rates from settings (fallback to hardcoded)
  const CLEANING_RATE = settings?.["pay.cleaning_rate"] ?? DEFAULT_CLEANING_RATE;
  const EC_BASE_RATE = settings?.["pay.extra_class_base"] ?? EXTRA_CLASS_BASE_RATE;
  const EC_THRESHOLD = settings?.["pay.extra_class_threshold"] ?? EXTRA_CLASS_KIDS_THRESHOLD;
  const EC_PER_KID = settings?.["pay.extra_class_per_kid"] ?? EXTRA_CLASS_PER_KID_RATE;
  const PROBLEM_DEDUCTION = settings?.["pay.problem_deduction_hours"] ?? 1;
  const ROUNDING_STEP = settings?.["pay.rounding_step"] ?? 100;
  const userData = new Map();

  function getOrCreate(userId) {
    if (!userData.has(userId)) {
      userData.set(userId, {
        shift_hours: 0,
        problem_shifts: 0,
        cleaning_count: 0,
        extra_classes_list: [], // { dow, kids_count, pay }
        extra_work_list: [],    // { id, work_name, price, date, status, comment }
        extra_pay_list: [],     // { id, amount, date, comment }
      });
    }
    return userData.get(userId);
  }

  // Step 1: Calculate shift hours per user from schedule assignments
  const assignmentBySlot = new Map(); // slotKey -> normalized user_id
  const eveningUserByDow = new Map(); // dow -> user_id (for default cleaning)

  for (const assignment of schedule?.assignments || []) {
    const uid = UserDirectory.normalizeUserId(assignment.user_id);
    if (!uid) continue;
    const hours = calculateHours(assignment.from, assignment.to);
    getOrCreate(uid).shift_hours += hours;

    const slotKey = `${assignment.dow}|${assignment.from}|${assignment.to}`;
    assignmentBySlot.set(slotKey, uid);

    // Track evening shift users for default cleaning
    if (assignment.from === "18:00" || assignment.to === "21:00") {
      eveningUserByDow.set(assignment.dow, uid);
    }
  }

  // Step 2: Count problem shifts from SHIFT_MARKED_PROBLEM and PROBLEM_SHIFT facts
  for (const fact of facts || []) {
    if (fact.fact_type === "SHIFT_MARKED_PROBLEM") {
      const { dow, from, to } = fact.fact_payload || {};
      if (!dow || !from || !to) continue;
      if (fact.fact_payload?.week_start && fact.fact_payload.week_start !== weekStartISO) continue;

      const slotKey = `${dow}|${from}|${to}`;
      const userId = assignmentBySlot.get(slotKey);
      if (userId) {
        getOrCreate(userId).problem_shifts += 1;
      }
    } else if (fact.fact_type === "PROBLEM_SHIFT") {
      if (fact.fact_payload?.week_start && fact.fact_payload.week_start !== weekStartISO) continue;
      const targetUserId = fact.fact_payload?.user_id;
      if (!targetUserId) continue;
      const uid = UserDirectory.normalizeUserId(targetUserId);
      getOrCreate(uid).problem_shifts += 1;
    }
  }

  // Step 3: Cleanings — build per-day attribution
  // Priority: CLEANING_DONE > CLEANING_SWAP > default (evening shift)
  const cleaningDoneByDow = new Map(); // dow -> user_id (explicit report)
  const cleaningSwapByDow = new Map(); // dow -> { original_user_id, replacement_user_id }

  for (const fact of facts || []) {
    if (fact.fact_payload?.week_start && fact.fact_payload.week_start !== weekStartISO) continue;

    if (fact.fact_type === "CLEANING_DONE") {
      const uid = UserDirectory.normalizeUserId(fact.user_id);
      if (!uid) continue;
      const dow = fact.fact_payload?.dow;
      if (dow) {
        cleaningDoneByDow.set(dow, uid);
      } else {
        // No specific day — count directly
        getOrCreate(uid).cleaning_count += 1;
      }
    } else if (fact.fact_type === "CLEANING_SWAP") {
      const { dow, original_user_id, replacement_user_id } = fact.fact_payload || {};
      if (!dow) continue;
      const replId = replacement_user_id
        ? UserDirectory.normalizeUserId(replacement_user_id)
        : (fact.user_id ? UserDirectory.normalizeUserId(fact.user_id) : null);
      const origId = original_user_id
        ? UserDirectory.normalizeUserId(original_user_id)
        : null;
      cleaningSwapByDow.set(dow, { original_user_id: origId, replacement_user_id: replId });
    }
  }

  // Attribute cleanings per day
  // Load cleaning_schedule from settings (which days/slots have scheduled cleaning)
  const cleaningSchedule = settings?.["cleaning_schedule"] || {
    mon: { morning: false, evening: true },
    tue: { morning: false, evening: true },
    wed: { morning: false, evening: true },
    thu: { morning: false, evening: true },
    fri: { morning: false, evening: true },
    sat: { morning: false, evening: true },
    sun: { morning: false, evening: false },
  };

  const DOW_ALL = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  for (const dow of DOW_ALL) {
    const isScheduled = cleaningSchedule[dow]?.evening !== false;
    let cleaningUser = null;

    if (cleaningDoneByDow.has(dow)) {
      // Explicit report — who actually cleaned (count even if unscheduled)
      cleaningUser = cleaningDoneByDow.get(dow);
    } else if (!isScheduled && !cleaningSwapByDow.has(dow)) {
      // Cleaning not scheduled for this day and no swap facts — skip
      continue;
    } else if (cleaningSwapByDow.has(dow)) {
      // Swap override
      const swap = cleaningSwapByDow.get(dow);
      cleaningUser = swap.replacement_user_id;
    } else if (eveningUserByDow.has(dow)) {
      // Default: evening shift user
      cleaningUser = eveningUserByDow.get(dow);
    }

    if (cleaningUser) {
      getOrCreate(cleaningUser).cleaning_count += 1;
    }
  }

  // Step 4: Extra classes — collect with kids_count
  for (const fact of facts || []) {
    if (fact.fact_type !== "EXTRA_CLASS") continue;
    if (fact.fact_payload?.week_start && fact.fact_payload.week_start !== weekStartISO) continue;
    const uid = UserDirectory.normalizeUserId(fact.user_id);
    if (!uid) continue;

    const kidsCount = fact.fact_payload?.kids_count ?? null;
    const dow = fact.fact_payload?.dow || null;

    // Calculate pay based on kids_count
    let pay;
    if (kidsCount === null || kidsCount === undefined || kidsCount <= EC_THRESHOLD) {
      pay = EC_BASE_RATE;
    } else {
      const extraKids = kidsCount - EC_THRESHOLD;
      pay = EC_BASE_RATE + (extraKids * EC_PER_KID);
    }

    getOrCreate(uid).extra_classes_list.push({
      dow,
      kids_count: kidsCount,
      pay,
    });
  }

  // Step 4b: Extra work requests (approved only count toward pay)
  for (const fact of facts || []) {
    if (fact.fact_type !== "EXTRA_WORK_REQUEST") continue;
    const uid = UserDirectory.normalizeUserId(fact.user_id);
    if (!uid) continue;

    const p = fact.fact_payload || {};
    getOrCreate(uid).extra_work_list.push({
      id: fact.id,
      work_name: p.work_name || p.work_type_id || "—",
      price: p.price || 0,
      date: p.date || null,
      status: p.status || "pending",
      comment: p.comment || null,
    });
  }

  // Step 4c: Extra pay (director bonuses)
  for (const fact of facts || []) {
    if (fact.fact_type !== "EXTRA_PAY") continue;
    const uid = UserDirectory.normalizeUserId(fact.user_id);
    if (!uid) continue;

    const p = fact.fact_payload || {};
    getOrCreate(uid).extra_pay_list.push({
      id: fact.id,
      amount: p.amount || 0,
      date: p.date || null,
      comment: p.comment || null,
    });
  }

  // Step 5: Inter-branch bonus (fixed ₽ per shift, or legacy hours*rate)
  const INTER_BRANCH_BONUS = settings?.["pay.inter_branch_bonus"] ?? null; // fixed ₽ per shift
  const INTER_BRANCH_EXTRA_HOURS = settings?.["pay.inter_branch_extra_hours"] ?? 0; // legacy: extra hours per shift
  const DEFAULT_BRANCH = settings?.["schedule.default_branch"] || "Архангельск";

  // Step 6: Build employees array
  const employees = [];

  for (const [user_id, data] of userData) {
    // Skip non-employee users (owner, admin, system)
    if (/^(owner|admin|system)/i.test(user_id)) continue;

    const name = UserDirectory.getDisplayName(user_id);
    const rate = hourlyRates?.[user_id] || UserDirectory.getRatePerHour(user_id) || 0;

    const problem_deduction_hours = data.problem_shifts * PROBLEM_DEDUCTION;
    const effective_hours = Math.max(0, data.shift_hours - problem_deduction_hours);
    const shift_pay = effective_hours * rate;

    const cleaning_pay = data.cleaning_count * CLEANING_RATE;

    const extra_classes_count = data.extra_classes_list.length;
    const extra_classes_total_pay = data.extra_classes_list.reduce((s, e) => s + e.pay, 0);
    const extra_classes_total_kids = data.extra_classes_list.reduce((s, e) => s + (e.kids_count || 0), 0);

    // Inter-branch bonus: if employee's branch differs from default branch
    let inter_branch_hours = 0;
    let inter_branch_pay = 0;
    const userBranch = UserDirectory.getBranch(user_id);
    if (userBranch !== DEFAULT_BRANCH) {
      const userShiftCount = (schedule?.assignments || []).filter(
        a => UserDirectory.normalizeUserId(a.user_id) === user_id
      ).length;
      if (INTER_BRANCH_BONUS != null && INTER_BRANCH_BONUS > 0) {
        // New: fixed ₽ per shift
        inter_branch_pay = userShiftCount * INTER_BRANCH_BONUS;
      } else if (INTER_BRANCH_EXTRA_HOURS > 0) {
        // Legacy: extra hours × rate
        inter_branch_hours = userShiftCount * INTER_BRANCH_EXTRA_HOURS;
        inter_branch_pay = inter_branch_hours * rate;
      }
    }

    // Extra work: only approved count toward pay
    const extra_work_approved_pay = data.extra_work_list
      .filter((w) => w.status === "approved")
      .reduce((s, w) => s + w.price, 0);

    // Extra pay: all director bonuses count
    const extra_pay_total = data.extra_pay_list.reduce((s, p) => s + p.amount, 0);

    const total_before_rounding = shift_pay + cleaning_pay + extra_classes_total_pay + inter_branch_pay + extra_work_approved_pay + extra_pay_total;
    const total_pay = ROUNDING_STEP > 0
      ? Math.ceil(total_before_rounding / ROUNDING_STEP) * ROUNDING_STEP
      : total_before_rounding;

    employees.push({
      user_id,
      name,
      shift_hours: data.shift_hours,
      problem_shifts: data.problem_shifts,
      problem_deduction_hours,
      effective_hours,
      rate,
      shift_pay,
      cleaning_count: data.cleaning_count,
      cleaning_pay,
      extra_classes: data.extra_classes_list,
      extra_classes_count,
      extra_classes_total_kids,
      extra_classes_total_pay,
      extra_work: data.extra_work_list,
      extra_work_approved_pay,
      extra_pay: data.extra_pay_list,
      extra_pay_total,
      inter_branch_hours,
      inter_branch_pay,
      total_before_rounding,
      total_pay,
    });
  }

  employees.sort((a, b) => a.user_id.localeCompare(b.user_id));

  // Step 6: Totals
  const totals = {
    total_hours: employees.reduce((s, e) => s + e.effective_hours, 0),
    total_cleanings: employees.reduce((s, e) => s + e.cleaning_count, 0),
    total_extra_classes: employees.reduce((s, e) => s + e.extra_classes_count, 0),
    total_extra_pay: employees.reduce((s, e) => s + e.extra_classes_total_pay, 0),
    total_pay: employees.reduce((s, e) => s + e.total_pay, 0),
  };

  return {
    week_start: weekStartISO,
    employees,
    totals,
  };
}
