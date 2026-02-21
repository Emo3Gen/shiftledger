/**
 * Tests for Telegram bot: payload mapping, formatters, /start command.
 */

import { buildIngestPayload } from "../telegram/bot.js";
import { formatFacts, formatSchedule, formatWeekState } from "../telegram/formatters.js";

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
