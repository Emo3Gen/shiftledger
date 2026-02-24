/**
 * Timesheet Engine v0
 *
 * Builds timesheet from facts (SHIFT_WORKED, SHIFT_ASSIGNMENT, etc.)
 */

import { UserDirectory } from "./userDirectory.js";

function slotKey(dow, from, to) {
  return `${dow}|${from}|${to}`;
}

function parseTimeToHours(timeStr) {
  // timeStr format: "HH:MM"
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours + (minutes || 0) / 60;
}

function calculateHours(from, to) {
  const fromHours = parseTimeToHours(from);
  const toHours = parseTimeToHours(to);
  return Math.max(0, toHours - fromHours);
}

// Fixed pay rates for extras
const CLEANING_PAY_PER_EVENT = 500; // ₽ per cleaning
const EXTRA_CLASS_PAY_PER_HOUR = 300; // ₽ per hour of extra class

/**
 * @param {Object} params
 * @param {Array} params.facts - Array of persisted facts from database
 * @param {string} params.weekStartISO - ISO date string for Monday of the week (YYYY-MM-DD)
 * @param {Object} params.hourlyRates - Map of user_id -> hourly rate (number)
 * @param {Object} params.schedule - Schedule object from buildDraftSchedule (contains assignments)
 * @returns {Object} - { week_start, rows: [], totals: {}, meta: {} }
 */
export function buildTimesheet({ facts, weekStartISO, hourlyRates, schedule }) {
  // Step 1: Collect planned hours from schedule assignments
  const plannedHoursByUser = new Map(); // user_id -> total planned hours
  const plannedSlotsByUser = new Map(); // user_id -> Set of slotKeys

  if (schedule && Array.isArray(schedule.assignments)) {
    for (const assignment of schedule.assignments) {
      const { dow, from, to, user_id } = assignment;
      if (!user_id || !dow || !from || !to) continue;

      // Normalize user_id (slug -> internal id)
      const normalizedUserId = UserDirectory.normalizeUserId(user_id);

      const slotKey = `${dow}|${from}|${to}`;
      const hours = calculateHours(from, to);

      // Use normalized user_id for aggregation
      if (!plannedSlotsByUser.has(normalizedUserId)) {
        plannedSlotsByUser.set(normalizedUserId, new Set());
      }
      plannedSlotsByUser.get(normalizedUserId).add(slotKey);

      const currentPlanned = plannedHoursByUser.get(normalizedUserId) || 0;
      plannedHoursByUser.set(normalizedUserId, currentPlanned + hours);
    }
  }

  // Step 2: Collect worked hours
  // Rule: plan = fact by default, only ask for fact for problematic shifts
  const workedHoursByUser = new Map(); // user_id -> total worked hours
  const workedSlotsByUser = new Map(); // user_id -> Set of slotKeys
  const factConfirmationsBySlot = new Map(); // slotKey -> { status, reason, created_at }

  // Collect explicit SHIFT_WORKED facts (always used)
  for (const fact of facts || []) {
    if (fact.fact_type === "SHIFT_WORKED") {
      const { dow, from, to } = fact.fact_payload || {};
      if (!dow || !from || !to) continue;

      // Filter by week if week_start is provided
      if (fact.fact_payload?.week_start && fact.fact_payload.week_start !== weekStartISO) {
        continue;
      }

      const user_id = fact.user_id;
      if (!user_id) continue;
      
      // Normalize user_id (slug -> internal id)
      const normalizedUserId = UserDirectory.normalizeUserId(user_id);

      const slotKey = `${dow}|${from}|${to}`;
      const hours = calculateHours(from, to);

      // Use normalized user_id for aggregation
      if (!workedSlotsByUser.has(normalizedUserId)) {
        workedSlotsByUser.set(normalizedUserId, new Set());
      }
      workedSlotsByUser.get(normalizedUserId).add(slotKey);

      const currentWorked = workedHoursByUser.get(normalizedUserId) || 0;
      workedHoursByUser.set(normalizedUserId, currentWorked + hours);
    } else if (fact.fact_type === "SHIFT_FACT_CONFIRMED") {
      // Track fact confirmations for problematic shifts
      const { dow, from, to, status, reason } = fact.fact_payload || {};
      if (!dow || !from || !to) continue;

      // Filter by week if week_start is provided
      if (fact.fact_payload?.week_start && fact.fact_payload.week_start !== weekStartISO) {
        continue;
      }

      const slotKey = `${dow}|${from}|${to}`;
      const factCreatedAt = new Date(fact.created_at || 0).getTime();
      const existing = factConfirmationsBySlot.get(slotKey);
      const existingCreatedAt = existing ? new Date(existing.created_at).getTime() : 0;
      if (!existing || factCreatedAt > existingCreatedAt) {
        factConfirmationsBySlot.set(slotKey, {
          status, // "ok" or "problem"
          reason,
          created_at: fact.created_at,
        });
      }
    }
  }

  // Step 2b: Collect cleaning and extra class facts
  const cleaningCountByUser = new Map(); // user_id -> count
  const extraClassHoursByUser = new Map(); // user_id -> total hours
  const extraClassCountByUser = new Map(); // user_id -> count

  for (const fact of facts || []) {
    if (fact.fact_type === "CLEANING_DONE") {
      // Filter by week if week_start is provided
      if (fact.fact_payload?.week_start && fact.fact_payload.week_start !== weekStartISO) {
        continue;
      }
      const user_id = fact.user_id;
      if (!user_id) continue;
      const normalizedUserId = UserDirectory.normalizeUserId(user_id);
      cleaningCountByUser.set(normalizedUserId, (cleaningCountByUser.get(normalizedUserId) || 0) + 1);
    } else if (fact.fact_type === "EXTRA_CLASS") {
      // Filter by week if week_start is provided
      if (fact.fact_payload?.week_start && fact.fact_payload.week_start !== weekStartISO) {
        continue;
      }
      const { from, to } = fact.fact_payload || {};
      if (!from || !to) continue;
      const user_id = fact.user_id;
      if (!user_id) continue;
      const normalizedUserId = UserDirectory.normalizeUserId(user_id);
      const hours = calculateHours(from, to);
      extraClassHoursByUser.set(normalizedUserId, (extraClassHoursByUser.get(normalizedUserId) || 0) + hours);
      extraClassCountByUser.set(normalizedUserId, (extraClassCountByUser.get(normalizedUserId) || 0) + 1);
    }
  }

  // Step 3: Collect all unique user_ids (from planned, worked, or hourlyRates)
  const allUserIds = new Set();
  for (const userId of plannedHoursByUser.keys()) allUserIds.add(userId);
  for (const userId of workedHoursByUser.keys()) allUserIds.add(userId);
  for (const userId of Object.keys(hourlyRates || {})) allUserIds.add(userId);
  for (const userId of cleaningCountByUser.keys()) allUserIds.add(userId);
  for (const userId of extraClassCountByUser.keys()) allUserIds.add(userId);

  // Step 4: Build rows
  // For each user, calculate worked hours:
  // - If explicit SHIFT_WORKED exists for a slot -> use it
  // - Else if slot is problematic and has SHIFT_FACT_CONFIRMED:
  //   - If status="ok" -> plan = fact (use planned hours)
  //   - If status="problem" -> reduce by 1 hour (v1 simplification)
  // - Else -> plan = fact (default, use planned hours)
  const rows = [];
  let totalHoursWorked = 0;
  let totalAmount = 0;

  for (const user_id of allUserIds) {
    const plannedHours = plannedHoursByUser.get(user_id) || 0;
    let workedHours = workedHoursByUser.get(user_id) || 0; // Start with explicit SHIFT_WORKED hours

    // For planned slots without explicit SHIFT_WORKED, apply plan=fact rule
    const userPlannedSlots = plannedSlotsByUser.get(user_id) || new Set();
    const userWorkedSlots = workedSlotsByUser.get(user_id) || new Set();

    for (const slotKey of userPlannedSlots) {
      if (userWorkedSlots.has(slotKey)) {
        // Already counted from SHIFT_WORKED
        continue;
      }

      // Check if this slot has a fact confirmation (for problematic shifts)
      const factConfirmation = factConfirmationsBySlot.get(slotKey);
      if (factConfirmation) {
        if (factConfirmation.status === "ok") {
          // Plan = fact (default)
          const [dow, from, to] = slotKey.split("|");
          const hours = calculateHours(from, to);
          workedHours += hours;
        } else if (factConfirmation.status === "problem") {
          // Problem reported: reduce by 1 hour (v1 simplification)
          const [dow, from, to] = slotKey.split("|");
          const hours = calculateHours(from, to);
          const adjustedHours = Math.max(0, hours - 1);
          workedHours += adjustedHours;
        }
      } else {
        // Default: plan = fact (no explicit fact confirmation needed)
        const [dow, from, to] = slotKey.split("|");
        const hours = calculateHours(from, to);
        workedHours += hours;
      }
    }

    const overtimeHours = Math.max(0, workedHours - plannedHours);
    // Normalize user_id and get rate from UserDirectory
    const normalizedUserId = UserDirectory.normalizeUserId(user_id);
    const rate = hourlyRates?.[normalizedUserId] || UserDirectory.getRatePerHour(user_id) || 0;
    const amount = workedHours * rate;

    const flags = [];
    if (workedHours > 0 && plannedHours === 0) {
      flags.push("worked_without_plan");
    }
    if (overtimeHours > 0) {
      flags.push("overtime");
    }
    if (plannedHours > 0 && workedHours === 0) {
      flags.push("no_show");
    }

    // Check for fact adjustments
    for (const slotKey of userPlannedSlots) {
      if (userWorkedSlots.has(slotKey)) continue;
      const factConfirmation = factConfirmationsBySlot.get(slotKey);
      if (factConfirmation && factConfirmation.status === "problem") {
        flags.push("fact_adjusted");
        if (factConfirmation.reason) {
          flags.push(`problem:${factConfirmation.reason}`);
        }
      }
    }

    // Cleaning and extra classes for this user
    const cleaningCount = cleaningCountByUser.get(user_id) || 0;
    const cleaningPay = cleaningCount * CLEANING_PAY_PER_EVENT;
    const extraClassesCount = extraClassCountByUser.get(user_id) || 0;
    const extraClassesHours = extraClassHoursByUser.get(user_id) || 0;
    const extraClassesPay = extraClassesHours * EXTRA_CLASS_PAY_PER_HOUR;
    const totalPay = amount + cleaningPay + extraClassesPay;

    // Add displayName and check for unknown user
    // normalizedUserId already declared above (line 174)
    const displayName = UserDirectory.getDisplayName(user_id);
    const isUnknown = !UserDirectory.getUser(user_id);

    if (isUnknown) {
      flags.push("unknown_user");
    }

    rows.push({
      user_id: normalizedUserId, // Use normalized ID (u1, u2...)
      display_name: displayName, // Add displayName for UI
      hours_planned: plannedHours,
      hours_worked: workedHours,
      overtime_hours: overtimeHours,
      amount,
      cleaning_count: cleaningCount,
      cleaning_pay: cleaningPay,
      extra_classes_count: extraClassesCount,
      extra_classes_hours: extraClassesHours,
      extra_classes_pay: extraClassesPay,
      total_pay: totalPay,
      flags,
      is_unknown: isUnknown, // Flag for unknown users
    });

    totalHoursWorked += workedHours;
    totalAmount += amount;
  }

  // Sort rows by user_id for consistency
  rows.sort((a, b) => a.user_id.localeCompare(b.user_id));

  // Compute totals for extras
  const totalCleaningPay = rows.reduce((sum, r) => sum + r.cleaning_pay, 0);
  const totalExtraClassesPay = rows.reduce((sum, r) => sum + r.extra_classes_pay, 0);
  const totalPay = totalAmount + totalCleaningPay + totalExtraClassesPay;

  return {
    week_start: weekStartISO,
    rows,
    totals: {
      hours_worked: totalHoursWorked,
      amount: totalAmount,
      cleaning_pay: totalCleaningPay,
      extra_classes_pay: totalExtraClassesPay,
      total_pay: totalPay,
    },
    meta: {
      facts_count: facts?.length || 0,
    },
  };
}
