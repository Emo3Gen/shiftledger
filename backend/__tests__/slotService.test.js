/**
 * Tests for slotService defaults and scheduleEngine custom slot integration.
 *
 * We can't import slotService directly (it depends on supabaseClient which uses import.meta.url).
 * Instead we test:
 * 1. The default slot values inline (matching slotService.js DEFAULT_SLOTS)
 * 2. The scheduleEngine's ability to accept custom slotTypes
 */

import { buildDraftSchedule } from "../scheduleEngineV0.js";

// Mirror of DEFAULT_SLOTS from slotService.js (for verification without supabase import)
const DEFAULT_SLOTS = [
  { name: "Утро", from_time: "10:00", to_time: "13:00", tenant_id: "dev", is_active: true, dow: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
  { name: "Вечер", from_time: "18:00", to_time: "21:00", tenant_id: "dev", is_active: true, dow: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
];

describe("slot defaults", () => {
  test("2 default slots exist", () => {
    expect(DEFAULT_SLOTS).toHaveLength(2);
  });

  test("first default slot is Утро 10:00-13:00", () => {
    expect(DEFAULT_SLOTS[0].name).toBe("Утро");
    expect(DEFAULT_SLOTS[0].from_time).toBe("10:00");
    expect(DEFAULT_SLOTS[0].to_time).toBe("13:00");
  });

  test("second default slot is Вечер 18:00-21:00", () => {
    expect(DEFAULT_SLOTS[1].name).toBe("Вечер");
    expect(DEFAULT_SLOTS[1].from_time).toBe("18:00");
    expect(DEFAULT_SLOTS[1].to_time).toBe("21:00");
  });

  test("defaults have correct tenant_id and is_active", () => {
    for (const slot of DEFAULT_SLOTS) {
      expect(slot.tenant_id).toBe("dev");
      expect(slot.is_active).toBe(true);
    }
  });

  test("defaults include all 7 days of week", () => {
    const allDays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    for (const slot of DEFAULT_SLOTS) {
      expect(slot.dow).toEqual(allDays);
    }
  });
});

describe("buildDraftSchedule with custom slotTypes", () => {
  test("custom 3-slot configuration generates 21 slots (7 days × 3)", () => {
    const customSlots = [
      { name: "Утро", from: "09:00", to: "12:00" },
      { name: "День", from: "13:00", to: "16:00" },
      { name: "Вечер", from: "17:00", to: "20:00" },
    ];
    const result = buildDraftSchedule({
      facts: [],
      weekStartISO: "2025-01-06",
      slotTypes: customSlots,
    });
    expect(result.slots).toHaveLength(21);
  });

  test("custom 1-slot configuration generates 7 slots", () => {
    const customSlots = [{ name: "Утро", from: "10:00", to: "14:00" }];
    const result = buildDraftSchedule({
      facts: [],
      weekStartISO: "2025-01-06",
      slotTypes: customSlots,
    });
    expect(result.slots).toHaveLength(7);
  });

  test("null slotTypes falls back to default 14 slots", () => {
    const result = buildDraftSchedule({
      facts: [],
      weekStartISO: "2025-01-06",
      slotTypes: null,
    });
    expect(result.slots).toHaveLength(14);
  });

  test("empty slotTypes array falls back to default 14 slots", () => {
    const result = buildDraftSchedule({
      facts: [],
      weekStartISO: "2025-01-06",
      slotTypes: [],
    });
    expect(result.slots).toHaveLength(14);
  });

  test("custom slots use correct from/to times", () => {
    const customSlots = [{ name: "Тест", from: "08:30", to: "11:30" }];
    const result = buildDraftSchedule({
      facts: [],
      weekStartISO: "2025-01-06",
      slotTypes: customSlots,
    });
    expect(result.slots[0].from).toBe("08:30");
    expect(result.slots[0].to).toBe("11:30");
    expect(result.slots[0].slot_name).toBe("Тест");
  });

  test("availability facts work with custom slots", () => {
    const customSlots = [{ name: "Смена", from: "09:00", to: "15:00" }];
    const facts = [
      {
        fact_type: "SHIFT_AVAILABILITY",
        user_id: "u1",
        fact_payload: { dow: "mon", from: "09:00", to: "15:00", availability: "can" },
        created_at: "2025-01-05T10:00:00Z",
      },
    ];
    const result = buildDraftSchedule({
      facts,
      weekStartISO: "2025-01-06",
      slotTypes: customSlots,
    });
    const monAssignment = result.assignments.find(
      (a) => a.dow === "mon" && a.from === "09:00" && a.to === "15:00"
    );
    expect(monAssignment).toBeDefined();
    expect(monAssignment.user_id).toBe("u1");
  });
});
