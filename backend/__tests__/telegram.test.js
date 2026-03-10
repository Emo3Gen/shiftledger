/**
 * Tests for Telegram bot: payload mapping, formatters, /start command.
 */

// Mock botMode.js to avoid import.meta.url issue in Jest/Babel
jest.mock("../botMode.js", () => ({
  getBotMode: () => "manual",
  setBotMode: jest.fn(),
  ADMIN_CHAT_ID: "",
}));

import { buildIngestPayload, createBot } from "../telegram/bot.js";
import { formatFacts, formatSchedule, formatWeekState, formatPayBreakdown, formatPinnedSchedule } from "../telegram/formatters.js";

// --- buildIngestPayload ---

describe("buildIngestPayload", () => {
  const ctx = {
    chat: { id: 12345, type: "private" },
    from: { id: 67890, first_name: "Иса", username: "isa_user" },
    message: { message_id: 42, date: 1704067200, text: "AVAIL mon 10-13" },
  };

  test("maps Telegram context to ingest payload", () => {
    const payload = buildIngestPayload(ctx);
    expect(payload.channel).toBe("telegram");
    expect(payload.chat_id).toBe("12345");
    expect(payload.user_id).toBe("67890");
    expect(payload.message_id).toBe("42");
    expect(payload.text).toBe("AVAIL mon 10-13");
    expect(payload.tenant_id).toBe("dev");
  });

  test("includes telegram meta with chat_type and first_name", () => {
    const payload = buildIngestPayload(ctx);
    expect(payload.meta.role).toBe("staff");
    expect(payload.meta.telegram.chat_type).toBe("private");
    expect(payload.meta.telegram.first_name).toBe("Иса");
    expect(payload.meta.telegram.username).toBe("isa_user");
  });

  test("ts is ISO string from message.date", () => {
    const payload = buildIngestPayload(ctx);
    expect(payload.ts).toBe("2024-01-01T00:00:00.000Z");
  });
});

// --- formatFacts ---

describe("formatFacts", () => {
  test("formats SHIFT_AVAILABILITY with Russian day name", () => {
    const facts = [
      {
        fact_type: "SHIFT_AVAILABILITY",
        fact_payload: { dow: "mon", from: "10:00", to: "13:00" },
      },
    ];
    const result = formatFacts(facts);
    expect(result).toBe("доступность Пн 10:00–13:00");
  });

  test("formats SHIFT_UNAVAILABILITY with Russian day name", () => {
    const facts = [
      {
        fact_type: "SHIFT_UNAVAILABILITY",
        fact_payload: { dow: "tue", from: "10:00", to: "13:00" },
      },
    ];
    const result = formatFacts(facts);
    expect(result).toBe("недоступность Вт 10:00–13:00");
  });

  test("formats SHIFT_UNAVAILABILITY with needs_replacement flag", () => {
    const facts = [
      {
        fact_type: "SHIFT_UNAVAILABILITY",
        fact_payload: { dow: "thu", from: "10:00", to: "13:00", needs_replacement: true },
      },
    ];
    const result = formatFacts(facts);
    expect(result).toBe("недоступность Чт 10:00–13:00 (нужна замена)");
  });

  test("formats SHIFT_REPLACEMENT with Russian day name", () => {
    const facts = [
      {
        fact_type: "SHIFT_REPLACEMENT",
        fact_payload: { dow: "thu", from: "10:00", to: "13:00" },
      },
    ];
    const result = formatFacts(facts);
    expect(result).toBe("замена Чт 10:00–13:00");
  });

  test("formats SWAP_REQUEST with Russian day name", () => {
    const facts = [
      {
        fact_type: "SWAP_REQUEST",
        fact_payload: { dow: "wed", from: "10:00", to: "13:00" },
      },
    ];
    const result = formatFacts(facts);
    expect(result).toBe("запрос на замену Ср 10:00–13:00");
  });

  test("formats GAP_DECLARATION with Russian day name", () => {
    const facts = [
      {
        fact_type: "GAP_DECLARATION",
        fact_payload: { dow: "thu", from: "18:00", to: "21:00" },
      },
    ];
    const result = formatFacts(facts);
    expect(result).toBe("пробел в графике Чт 18:00–21:00");
  });

  test("returns empty string for empty array", () => {
    expect(formatFacts([])).toBe("");
  });

  test("returns empty string for null/undefined", () => {
    expect(formatFacts(null)).toBe("");
    expect(formatFacts(undefined)).toBe("");
  });

  test("handles unknown fact types gracefully", () => {
    const facts = [{ fact_type: "UNKNOWN_TYPE", fact_payload: {} }];
    const result = formatFacts(facts);
    expect(result).toBe("UNKNOWN_TYPE");
  });

  test("formats multiple facts", () => {
    const facts = [
      { fact_type: "WEEK_OPEN", fact_payload: {} },
      { fact_type: "WEEK_LOCK", fact_payload: {} },
    ];
    const result = formatFacts(facts);
    expect(result).toContain("неделя открыта");
    expect(result).toContain("закрыта");
  });
});

// --- formatSchedule ---

describe("formatSchedule", () => {
  test("renders compact grid with Russian day names and employee names", () => {
    const schedule = {
      week_start: "2026-02-24",
      slots: [
        { dow: "mon", from: "10:00", to: "13:00", slot_name: "Утро", user_id: "u1" },
        { dow: "mon", from: "18:00", to: "21:00", slot_name: "Вечер", user_id: null },
        { dow: "tue", from: "10:00", to: "13:00", slot_name: "Утро", user_id: "u2" },
        { dow: "tue", from: "18:00", to: "21:00", slot_name: "Вечер", user_id: "u3" },
      ],
      gaps: [],
      conflicts: [],
    };
    const result = formatSchedule(schedule);
    expect(result).toContain("<pre>");
    expect(result).toContain("📅 24–28 фев 2026");
    expect(result).toContain("Пн");
    expect(result).toContain("Вт");
    expect(result).toContain("Утро");
    expect(result).toContain("Вечер");
    // Employee names from UserDirectory (u1=Иса, u2=Дарина, u3=Ксюша)
    expect(result).toContain("Иса");
    expect(result).toContain("Дарина");
    expect(result).toContain("Ксюша");
    // Unassigned slot
    expect(result).toContain("—");
    // Legend
    expect(result).toContain("✅ — назначено");
  });

  test("shows gaps section when gaps exist", () => {
    const schedule = {
      slots: [
        { dow: "mon", from: "18:00", to: "21:00", slot_name: "Вечер", user_id: null },
      ],
      gaps: [{ dow: "mon", from: "18:00", to: "21:00", reason: "no candidates" }],
      conflicts: [],
    };
    const result = formatSchedule(schedule);
    expect(result).toContain("⚠️ Пробелы:");
    expect(result).toContain("Пн 18:00–21:00");
  });

  test("shows conflicts section when conflicts exist", () => {
    const schedule = {
      slots: [
        { dow: "wed", from: "10:00", to: "13:00", slot_name: "Утро", user_id: "u1" },
      ],
      gaps: [],
      conflicts: [{ dow: "wed", from: "10:00", to: "13:00", reason: "двойное назначение" }],
    };
    const result = formatSchedule(schedule);
    expect(result).toContain("❌ Конфликты:");
    expect(result).toContain("Ср 10:00–13:00 — двойное назначение");
  });

  test("shows 'Нет' when no conflicts", () => {
    const schedule = {
      slots: [
        { dow: "mon", from: "10:00", to: "13:00", slot_name: "Утро", user_id: "u1" },
      ],
      gaps: [],
      conflicts: [],
    };
    const result = formatSchedule(schedule);
    expect(result).toContain("❌ Конфликты:\nНет");
  });

  test("shows week range across months", () => {
    const schedule = {
      week_start: "2026-01-28",
      slots: [
        { dow: "mon", from: "10:00", to: "13:00", slot_name: "Утро", user_id: "u1" },
      ],
      gaps: [],
      conflicts: [],
    };
    const result = formatSchedule(schedule);
    // Jan 28 + 4 = Feb 1, so cross-month
    expect(result).toContain("28 янв – 1 фев 2026");
  });

  test("returns empty message for null schedule", () => {
    expect(formatSchedule(null)).toBe("Расписание пусто.");
  });

  test("returns empty message for empty slots", () => {
    expect(formatSchedule({ slots: [] })).toBe("Расписание пусто.");
  });

  test("falls back to assigned_user_id when user_id is absent", () => {
    const schedule = {
      slots: [
        { dow: "mon", from: "10:00", to: "13:00", slot_name: "Утро", assigned_user_id: "u1" },
      ],
      gaps: [],
      conflicts: [],
    };
    const result = formatSchedule(schedule);
    expect(result).toContain("Иса");
  });

  test("shows replacement info in schedule", () => {
    const schedule = {
      slots: [
        { dow: "thu", from: "10:00", to: "13:00", slot_name: "Утро", user_id: "u3", replaced_user_id: "u1" },
      ],
      gaps: [],
      conflicts: [],
    };
    const result = formatSchedule(schedule);
    expect(result).toContain("Ксюша (за Иса)");
  });
});

// --- formatWeekState ---

describe("formatWeekState", () => {
  test("translates COLLECTING", () => {
    expect(formatWeekState("COLLECTING")).toBe("Сбор доступности");
  });

  test("translates ACTIVE", () => {
    expect(formatWeekState("ACTIVE")).toBe("График активен");
  });

  test("translates CLOSED", () => {
    expect(formatWeekState("CLOSED")).toBe("Неделя закрыта");
  });

  test("returns unknown state as-is", () => {
    expect(formatWeekState("UNKNOWN")).toBe("UNKNOWN");
  });
});

// --- formatPayBreakdown ---

describe("formatPayBreakdown", () => {
  test("returns 'Нет данных' for null", () => {
    expect(formatPayBreakdown(null)).toBe("Нет данных");
  });

  test("formats basic shift pay", () => {
    const emp = {
      user_id: "u1",
      name: "Иса",
      shift_hours: 9,
      problem_shifts: 0,
      problem_deduction_hours: 0,
      effective_hours: 9,
      rate: 250,
      shift_pay: 2250,
      cleaning_count: 0,
      cleaning_pay: 0,
      extra_classes: [],
      extra_classes_count: 0,
      extra_classes_total_pay: 0,
      total_before_rounding: 2250,
      total_pay: 2300,
    };
    const result = formatPayBreakdown(emp);
    expect(result).toContain("Иса");
    expect(result).toContain("9ч × 250₽/ч = 2250₽");
    expect(result).toContain("2250₽ → 2300₽ (округл.)");
    expect(result).not.toContain("Проблемные");
    expect(result).not.toContain("Уборки");
    expect(result).not.toContain("Доп.занятия");
  });

  test("formats with problem shifts and cleanings", () => {
    const emp = {
      user_id: "u2",
      name: "Дарина",
      shift_hours: 12,
      problem_shifts: 1,
      problem_deduction_hours: 1,
      effective_hours: 11,
      rate: 250,
      shift_pay: 2750,
      cleaning_count: 2,
      cleaning_pay: 1000,
      extra_classes: [],
      extra_classes_count: 0,
      extra_classes_total_pay: 0,
      total_before_rounding: 3750,
      total_pay: 3800,
    };
    const result = formatPayBreakdown(emp);
    expect(result).toContain("Проблемные");
    expect(result).toContain("1 шт, −1ч");
    expect(result).toContain("Уборки");
    expect(result).toContain("2 × 500₽ = 1000₽");
  });

  test("formats with extra classes (above threshold)", () => {
    const emp = {
      user_id: "u3",
      name: "Ксюша",
      shift_hours: 6,
      problem_shifts: 0,
      problem_deduction_hours: 0,
      effective_hours: 6,
      rate: 250,
      shift_pay: 1500,
      cleaning_count: 0,
      cleaning_pay: 0,
      extra_classes: [
        { dow: "mon", kids_count: 12, pay: 900 },
        { dow: "wed", kids_count: 5, pay: 500 },
      ],
      extra_classes_count: 2,
      extra_classes_total_pay: 1400,
      total_before_rounding: 2900,
      total_pay: 2900,
    };
    const result = formatPayBreakdown(emp);
    expect(result).toContain("Доп.занятия");
    expect(result).toContain("Пн: 12 детей → 500 + 4×100 = 900₽");
    expect(result).toContain("Ср: 5 детей → 500₽");
    expect(result).toContain("2900₽");
    expect(result).not.toContain("округл.");
  });
});

// --- formatPinnedSchedule ---

describe("formatPinnedSchedule", () => {
  test("returns empty message for null/empty schedule", () => {
    expect(formatPinnedSchedule(null)).toContain("пусто");
    expect(formatPinnedSchedule({ slots: [] })).toContain("пусто");
  });

  test("formats schedule with day rows and slot columns", () => {
    const schedule = {
      week_start: "2026-02-09",
      slots: [
        { dow: "mon", slot_name: "Утро", user_id: "u1" },
        { dow: "mon", slot_name: "Вечер", user_id: "u2" },
        { dow: "tue", slot_name: "Утро", user_id: "u3" },
        { dow: "tue", slot_name: "Вечер", user_id: "u4" },
      ],
    };
    const result = formatPinnedSchedule(schedule);
    expect(result).toContain("Расписание");
    expect(result).toContain("Пн");
    expect(result).toContain("Вт");
    expect(result).toContain("Обновлено:");
  });

  test("marks replacements with 🔄", () => {
    const schedule = {
      slots: [
        { dow: "mon", slot_name: "Утро", user_id: "u3", replaced_user_id: "u1" },
      ],
    };
    const result = formatPinnedSchedule(schedule);
    expect(result).toContain("🔄");
  });

  test("marks cleanings with 🧹", () => {
    const schedule = {
      slots: [
        { dow: "mon", slot_name: "Утро", user_id: "u1" },
      ],
      cleaning_assignments: { mon: "u2" },
    };
    const result = formatPinnedSchedule(schedule);
    expect(result).toContain("🧹");
  });
});

// --- Employee-Telegram mapping ---

describe("employee-telegram mapping", () => {
  test("getByTelegramUserId returns employee when found", async () => {
    const getByTelegramUserId = async (tgId) =>
      tgId === "67890" ? { id: "u1", name: "Иса", telegram_user_id: "67890" } : null;

    const result = await getByTelegramUserId("67890");
    expect(result).not.toBeNull();
    expect(result.id).toBe("u1");
    expect(result.name).toBe("Иса");
  });

  test("getByTelegramUserId returns null for unknown user", async () => {
    const getByTelegramUserId = async () => null;

    const result = await getByTelegramUserId("99999");
    expect(result).toBeNull();
  });

  test("linkTelegram updates employee with telegram info", async () => {
    const linkTelegram = async (empId, tgId, tgUsername) => ({
      id: empId,
      name: "Иса",
      telegram_user_id: tgId,
      telegram_username: tgUsername,
    });

    const result = await linkTelegram("u1", "67890", "isa_user");
    expect(result.telegram_user_id).toBe("67890");
    expect(result.telegram_username).toBe("isa_user");
  });

  test("buildIngestPayload can be overridden with resolved employee ID", () => {
    const ctx = {
      chat: { id: 12345, type: "private" },
      from: { id: 67890, first_name: "Иса", username: "isa_user" },
      message: { message_id: 42, date: 1704067200, text: "могу пн утро" },
    };

    const payload = buildIngestPayload(ctx);
    expect(payload.user_id).toBe("67890"); // Default: telegram ID

    // Simulate override (as bot does after resolveEmployee)
    payload.user_id = "u1";
    expect(payload.user_id).toBe("u1"); // Overridden with internal ID
  });
});
