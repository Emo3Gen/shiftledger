/**
 * Timesheet Engine v0
 *
 * Principle: final schedule = fact.
 * shift_hours come directly from schedule assignments.
 * Problem shifts get -1h deduction each.
 * total_pay rounded UP to nearest 100.
 */

import { UserDirectory } from "./userDirectory.js";

function calculateHours(from, to) {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  return Math.max(0, th + (tm || 0) / 60 - (fh + (fm || 0) / 60));
}

const DEFAULT_CLEANING_RATE = 500; // ₽ per cleaning
const DEFAULT_EXTRA_CLASS_RATE = 300; // ₽ per hour of extra class

/**
 * @param {Object} params
 * @param {Object} params.schedule - Schedule from buildDraftSchedule (contains assignments)
 * @param {Array}  params.facts - Array of persisted facts
 * @param {string} params.weekStartISO - ISO date string for Monday (YYYY-MM-DD)
 * @param {Object} params.hourlyRates - Map of user_id -> hourly rate
 * @returns {Object} - { week_start, employees: [], totals: {} }
 */
export function buildTimesheet({ schedule, facts, weekStartISO, hourlyRates }) {
  const userData = new Map();

  function getOrCreate(userId) {
    if (!userData.has(userId)) {
      userData.set(userId, {
        shift_hours: 0,
        problem_shifts: 0,
        cleaning_count: 0,
        extra_classes: 0,
        extra_hours: 0,
      });
    }
    return userData.get(userId);
  }

  // Step 1: Calculate shift hours per user from schedule assignments
  const assignmentBySlot = new Map(); // slotKey -> normalized user_id

  for (const assignment of schedule?.assignments || []) {
    const uid = UserDirectory.normalizeUserId(assignment.user_id);
    if (!uid) continue;
    const hours = calculateHours(assignment.from, assignment.to);
    getOrCreate(uid).shift_hours += hours;

    const slotKey = `${assignment.dow}|${assignment.from}|${assignment.to}`;
    assignmentBySlot.set(slotKey, uid);
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

  // Step 3: Collect cleaning and extra class facts
  for (const fact of facts || []) {
    if (fact.fact_type === "CLEANING_DONE") {
      if (fact.fact_payload?.week_start && fact.fact_payload.week_start !== weekStartISO) continue;
      const uid = UserDirectory.normalizeUserId(fact.user_id);
      if (!uid) continue;
      getOrCreate(uid).cleaning_count += 1;
    } else if (fact.fact_type === "EXTRA_CLASS") {
      if (fact.fact_payload?.week_start && fact.fact_payload.week_start !== weekStartISO) continue;
      const { from, to } = fact.fact_payload || {};
      if (!from || !to) continue;
      const uid = UserDirectory.normalizeUserId(fact.user_id);
      if (!uid) continue;
      const hours = calculateHours(from, to);
      const d = getOrCreate(uid);
      d.extra_classes += 1;
      d.extra_hours += hours;
    }
  }

  // Step 4: Build employees array
  const employees = [];

  for (const [user_id, data] of userData) {
    const name = UserDirectory.getDisplayName(user_id);
    const rate = hourlyRates?.[user_id] || UserDirectory.getRatePerHour(user_id) || 0;

    const problem_deduction_hours = data.problem_shifts * 1;
    const effective_hours = Math.max(0, data.shift_hours - problem_deduction_hours);
    const shift_pay = effective_hours * rate;

    const cleaning_pay = data.cleaning_count * DEFAULT_CLEANING_RATE;
    const extra_pay = data.extra_hours * DEFAULT_EXTRA_CLASS_RATE;

    const total_before_rounding = shift_pay + cleaning_pay + extra_pay;
    const total_pay = Math.ceil(total_before_rounding / 100) * 100;

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
      extra_classes: data.extra_classes,
      extra_hours: data.extra_hours,
      extra_pay,
      total_before_rounding,
      total_pay,
    });
  }

  employees.sort((a, b) => a.user_id.localeCompare(b.user_id));

  // Step 5: Totals
  const totals = {
    total_hours: employees.reduce((s, e) => s + e.effective_hours, 0),
    total_cleanings: employees.reduce((s, e) => s + e.cleaning_count, 0),
    total_extra: employees.reduce((s, e) => s + e.extra_hours, 0),
    total_pay: employees.reduce((s, e) => s + e.total_pay, 0),
  };

  return {
    week_start: weekStartISO,
    employees,
    totals,
  };
}
