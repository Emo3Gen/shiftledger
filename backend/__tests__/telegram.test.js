/**
 * Tests for Telegram bot: payload mapping, formatters, /start command.
 */

import { buildIngestPayload } from "../telegram/bot.js";
import { formatFacts, formatSchedule } from "../telegram/formatters.js";

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
    expect(result).toContain("зафиксирован");
  });
});

// --- formatSchedule ---

describe("formatSchedule", () => {
  test("formats slots into monospace table with Russian day names", () => {
    const schedule = {
      slots: [
        { dow: "mon", from: "10:00", to: "13:00", slot_name: "Утро", assigned_user_id: "u1" },
        { dow: "mon", from: "18:00", to: "21:00", slot_name: "Вечер", assigned_user_id: null },
      ],
    };
    const result = formatSchedule(schedule);
    expect(result).toContain("<pre>");
    expect(result).toContain("Пн");
    expect(result).toContain("10:00–13:00");
    expect(result).toContain("u1");
    expect(result).toContain("—");
  });

  test("returns empty message for null schedule", () => {
    expect(formatSchedule(null)).toBe("Расписание пусто.");
  });

  test("returns empty message for empty slots", () => {
    expect(formatSchedule({ slots: [] })).toBe("Расписание пусто.");
  });
});
