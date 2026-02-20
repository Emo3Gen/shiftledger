/**
 * Telegram message formatters — human-readable output in Russian.
 */

import { UserDirectory } from "../userDirectory.js";

const DOW_RU = { mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" };
const DOW_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function dowRu(dow) {
  return DOW_RU[dow] || dow;
}

const FACT_LABELS = {
  SHIFT_AVAILABILITY: (p) => `доступность ${dowRu(p.dow)} ${p.from}–${p.to}`,
  SHIFT_UNAVAILABILITY: (p) => `недоступность ${dowRu(p.dow)} ${p.from}–${p.to}`,
  SWAP_REQUEST: (p) => `запрос на замену ${dowRu(p.dow)} ${p.from}–${p.to}`,
  GAP_DECLARATION: (p) => `пробел в графике ${dowRu(p.dow)} ${p.from}–${p.to}`,
  SHIFT_ASSIGNMENT: (p) => `назначение ${p.assigned_user_id} ${dowRu(p.dow)} ${p.from}–${p.to}`,
  SHIFT_WORKED: (p) => `отработано ${p.user_id} ${dowRu(p.dow)} ${p.from}–${p.to}`,
  SHIFT_NO_SHOW: (p) => `неявка ${p.user_id} ${dowRu(p.dow)}`,
  WEEK_OPEN: () => "неделя открыта для сбора",
  WEEK_PROPOSE: () => "график предложен",
  WEEK_LOCK: () => "график зафиксирован",
  WEEK_CONFIRM: () => "график подтверждён",
  SCHEDULE_CONFIRMED: (p) => `подтверждение от ${p.user_id}`,
  CONFIRM_SHIFT_FACT: (p) => `подтверждение смены ${dowRu(p.dow)} ${p.from}–${p.to}: ${p.status}`,
  OVERTIME_APPROVED: (p) => `переработка одобрена: ${p.user_id}`,
  TIMESHEET_CONFIRMED: () => "табель подтверждён",
  CLEANING_DONE: (p) => `уборка выполнена ${p.user_id}`,
  REPORT_PROBLEM: (p) => `проблема: ${p.description || "без описания"}`,
};

/**
 * Format facts array into a human-readable string.
 */
export function formatFacts(facts) {
  if (!facts || facts.length === 0) return "";

  return facts
    .map((f) => {
      const formatter = FACT_LABELS[f.fact_type];
      if (formatter) {
        try {
          return formatter(f.fact_payload || {});
        } catch {
          return f.fact_type;
        }
      }
      return f.fact_type;
    })
    .join("\n");
}

/**
 * Format a week_start ISO date into Russian range: "24–28 фев 2026"
 */
function formatWeekRange(weekStart) {
  const start = new Date(weekStart);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 4); // Mon–Fri

  const sDay = start.getUTCDate();
  const eDay = end.getUTCDate();
  const sMonth = MONTHS_RU[start.getUTCMonth()];
  const eMonth = MONTHS_RU[end.getUTCMonth()];
  const year = start.getUTCFullYear();

  if (sMonth === eMonth) {
    return `${sDay}–${eDay} ${sMonth} ${year}`;
  }
  return `${sDay} ${sMonth} – ${eDay} ${eMonth} ${year}`;
}

/**
 * Get display name for a user_id via UserDirectory, fallback to id.
 */
function displayName(userId) {
  if (!userId) return "—";
  return UserDirectory.getDisplayName(userId);
}

/**
 * Format schedule into a compact Russian grid for Telegram.
 */
export function formatSchedule(schedule) {
  if (!schedule || !schedule.slots || schedule.slots.length === 0) {
    return "Расписание пусто.";
  }

  // Header
  let header = "📅";
  if (schedule.week_start) {
    header += ` ${formatWeekRange(schedule.week_start)}`;
  }

  // Determine active days and slot types
  const activeDows = DOW_ORDER.filter((d) => schedule.slots.some((s) => s.dow === d));
  const slotNames = [...new Set(schedule.slots.map((s) => s.slot_name).filter(Boolean))];
  if (slotNames.length === 0) slotNames.push("");

  // Lookup: "dow:slotName" → slot
  const slotMap = {};
  for (const slot of schedule.slots) {
    slotMap[`${slot.dow}:${slot.slot_name || ""}`] = slot;
  }

  // Get cell text for a slot
  const cellText = (slot) => {
    const uid = slot?.user_id || slot?.assigned_user_id;
    if (!uid) return "—";
    return displayName(uid);
  };

  // Calculate column widths
  const colWidths = slotNames.map((sn) => {
    let w = sn.length;
    for (const dow of activeDows) {
      const t = cellText(slotMap[`${dow}:${sn}`]);
      if (t.length > w) w = t.length;
    }
    return Math.max(w, 4);
  });

  const lines = [header, ""];

  // Column headers
  let headerRow = "     ";
  for (let i = 0; i < slotNames.length; i++) {
    headerRow += slotNames[i].padEnd(colWidths[i] + 2);
  }
  lines.push(headerRow);

  // Data rows
  for (const dow of activeDows) {
    let row = (DOW_RU[dow] || dow).padEnd(5);
    for (let i = 0; i < slotNames.length; i++) {
      const slot = slotMap[`${dow}:${slotNames[i]}`];
      let text = cellText(slot);
      if (slot && slot.status === "PENDING") text += " ⚠️";
      row += text.padEnd(colWidths[i] + 2);
    }
    lines.push(row);
  }

  let result = `<pre>${lines.join("\n")}</pre>`;

  // Gaps section
  const gaps = schedule.gaps || [];
  if (gaps.length > 0) {
    result += "\n\n⚠️ Пробелы:";
    for (const gap of gaps) {
      const d = DOW_RU[gap.dow] || gap.dow;
      result += `\n${d} ${gap.from}–${gap.to} — ${gap.reason || "нет кандидатов"}`;
    }
  }

  // Conflicts section
  const conflicts = schedule.conflicts || [];
  if (conflicts.length > 0) {
    result += "\n\n❌ Конфликты:";
    for (const c of conflicts) {
      const d = DOW_RU[c.dow] || c.dow;
      result += `\n${d} ${c.from}–${c.to} — ${c.reason}`;
    }
  } else {
    result += "\n\n❌ Конфликты:\nНет";
  }

  // Legend
  result += "\n\n✅ — назначено | ⚠️ — нужно подтверждение | — — не закрыто";

  return result;
}
