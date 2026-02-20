/**
 * Telegram message formatters — human-readable output in Russian.
 */

const FACT_LABELS = {
  SHIFT_AVAILABILITY: (p) => {
    const avail = p.availability === "can" ? "доступен" : "не может";
    return `${avail} ${p.dow} ${p.from}–${p.to}`;
  },
  SHIFT_UNAVAILABILITY: (p) => `не может ${p.dow} ${p.from}–${p.to}`,
  SWAP_REQUEST: (p) => `обмен ${p.from_user} ↔ ${p.to_user} ${p.dow} ${p.from}–${p.to}`,
  GAP_DECLARATION: (p) => `пробел ${p.dow} ${p.from}–${p.to}`,
  SHIFT_ASSIGNMENT: (p) => `назначение ${p.assigned_user_id} ${p.dow} ${p.from}–${p.to}`,
  SHIFT_WORKED: (p) => `отработано ${p.user_id} ${p.dow} ${p.from}–${p.to}`,
  SHIFT_NO_SHOW: (p) => `неявка ${p.user_id} ${p.dow}`,
  WEEK_OPEN: () => "неделя открыта для сбора",
  WEEK_PROPOSE: () => "график предложен",
  WEEK_LOCK: () => "график зафиксирован",
  WEEK_CONFIRM: () => "график подтверждён",
  SCHEDULE_CONFIRMED: (p) => `подтверждение от ${p.user_id}`,
  CONFIRM_SHIFT_FACT: (p) => `подтверждение смены ${p.dow} ${p.from}–${p.to}: ${p.status}`,
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
 * Format schedule into a monospace Telegram table.
 */
export function formatSchedule(schedule) {
  if (!schedule || !schedule.slots || schedule.slots.length === 0) {
    return "Расписание пусто.";
  }

  const DOW_RU = { mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" };
  const lines = [];

  for (const slot of schedule.slots) {
    const dow = DOW_RU[slot.dow] || slot.dow;
    const time = `${slot.from}–${slot.to}`;
    const name = slot.slot_name || "";
    const userId = slot.assigned_user_id || "—";
    lines.push(`${dow} ${time} ${name} → ${userId}`);
  }

  return `<pre>${lines.join("\n")}</pre>`;
}
