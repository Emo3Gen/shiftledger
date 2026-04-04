import { buildDraftSchedule } from "../scheduleEngineV0.js";

const WEEK_START = "2025-01-06";
const DOWS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SLOTS = [
  { from: "10:00", to: "13:00" },
  { from: "18:00", to: "21:00" },
];

function makeFact(overrides) {
  return {
    fact_type: "SHIFT_AVAILABILITY",
    user_id: "u1",
    fact_payload: {
      dow: "mon",
      from: "10:00",
      to: "13:00",
      availability: "can",
    },
    created_at: "2025-01-05T10:00:00Z",
    ...overrides,
  };
}

/** Generate SHIFT_AVAILABILITY facts for given user on given days (both slots). */
function availForDays(userId, days) {
  const facts = [];
  for (const dow of days) {
    for (const { from, to } of SLOTS) {
      facts.push(
        makeFact({
          user_id: userId,
          fact_payload: { dow, from, to, availability: "can" },
        })
      );
    }
  }
  return facts;
}

describe("scheduleEngineV0 — stress tests (SL-014)", () => {
  // ─── Scenario 1: Friday without data ───────────────────────────────────────
  test("Scenario 1: no facts for Friday → fri slots empty, other days assigned", () => {
    // All 4 employees available Mon–Thu + Sat–Sun, Friday is missing
    const daysWithData = ["mon", "tue", "wed", "thu", "sat", "sun"];
    const facts = [
      ...availForDays("u1", daysWithData),
      ...availForDays("u2", daysWithData),
      ...availForDays("u3", daysWithData),
      ...availForDays("u4", daysWithData),
    ];

    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });

    // Friday slots should have no assignments
    const friAssignments = result.assignments.filter((a) => a.dow === "fri");
    expect(friAssignments).toHaveLength(0);

    // Other days should have assignments
    for (const dow of daysWithData) {
      const dayAssignments = result.assignments.filter((a) => a.dow === dow);
      expect(dayAssignments.length).toBeGreaterThan(0);
    }

    // Friday slots in slots array should be EMPTY
    const friSlots = result.slots.filter((s) => s.dow === "fri");
    expect(friSlots.length).toBeGreaterThan(0);
    for (const s of friSlots) {
      expect(s.user_id).toBeNull();
    }
  });

  // ─── Scenario 2: All unavailable Monday morning ────────────────────────────
  test("Scenario 2: all employees unavailable Mon morning → no assignment for that slot", () => {
    const users = ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"];
    const facts = [];

    // All users UNAVAILABLE for Mon 10-13
    for (const uid of users) {
      facts.push(
        makeFact({
          fact_type: "SHIFT_UNAVAILABILITY",
          user_id: uid,
          fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "cannot" },
        })
      );
    }

    // Some users available for other slots so the engine has work to do
    facts.push(...availForDays("u1", ["tue", "wed"]));
    facts.push(...availForDays("u2", ["tue", "wed"]));

    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });

    // Mon morning should not be assigned
    const monMorning = result.assignments.find(
      (a) => a.dow === "mon" && a.from === "10:00" && a.to === "13:00"
    );
    expect(monMorning).toBeUndefined();

    // Other days should still have assignments
    const tueAssignments = result.assignments.filter((a) => a.dow === "tue");
    expect(tueAssignments.length).toBeGreaterThan(0);
  });

  // ─── Scenario 3: User changes availability twice ───────────────────────────
  test("Scenario 3: u1 says 'can' then 'cannot' for Mon morning → last fact wins", () => {
    const facts = [
      // First: u1 can
      makeFact({
        user_id: "u1",
        fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" },
        created_at: "2025-01-05T09:00:00Z",
      }),
      // Then: u1 cannot (later timestamp)
      makeFact({
        fact_type: "SHIFT_UNAVAILABILITY",
        user_id: "u1",
        fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "cannot" },
        created_at: "2025-01-05T11:00:00Z",
      }),
      // u2 also available — ensures the slot isn't just empty
      makeFact({
        user_id: "u2",
        fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" },
      }),
    ];

    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const monMorning = result.assignments.find(
      (a) => a.dow === "mon" && a.from === "10:00" && a.to === "13:00"
    );

    // u1 must NOT be assigned (last fact was UNAVAILABILITY)
    if (monMorning) {
      expect(monMorning.user_id).not.toBe("u1");
    }
  });

  // ─── Scenario 4: Duplicate messages (TG bug) ──────────────────────────────
  test("Scenario 4: same message 10 times → single assignment per slot", () => {
    const facts = [];
    // u2 sends identical availability 10 times with different event timestamps
    for (let i = 0; i < 10; i++) {
      facts.push(
        makeFact({
          user_id: "u2",
          fact_payload: { dow: "tue", from: "10:00", to: "13:00", availability: "can" },
          created_at: `2025-01-05T10:${String(i).padStart(2, "0")}:00Z`,
        })
      );
    }

    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const tueMorning = result.assignments.filter(
      (a) => a.dow === "tue" && a.from === "10:00" && a.to === "13:00"
    );

    // Exactly 1 assignment, not 10
    expect(tueMorning).toHaveLength(1);
    expect(tueMorning[0].user_id).toBe("u2");
  });

  // ─── Scenario 5: Only one employee for entire week ─────────────────────────
  test("Scenario 5: only u1 available for all 14 slots → u1 fills everything, no crash", () => {
    const facts = availForDays("u1", DOWS);

    const start = Date.now();
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const elapsed = Date.now() - start;

    // Must not hang or crash
    expect(elapsed).toBeLessThan(500);

    // u1 should be assigned to every slot
    expect(result.assignments.length).toBe(14);
    for (const a of result.assignments) {
      expect(a.user_id).toBe("u1");
    }
  });

  // ─── Scenario 6: minHours conflict ─────────────────────────────────────────
  test("Scenario 6: u1 (minHours=22) available only 2 slots (6h) → gets 2 slots, no crash", () => {
    // u1 has minHours=22 in UserDirectory, but only available for 2 morning slots
    const facts = [
      makeFact({
        user_id: "u1",
        fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" },
      }),
      makeFact({
        user_id: "u1",
        fact_payload: { dow: "tue", from: "10:00", to: "13:00", availability: "can" },
      }),
    ];

    let result;
    expect(() => {
      result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    }).not.toThrow();

    // u1 should be assigned to both available slots
    const u1Assignments = result.assignments.filter((a) => a.user_id === "u1");
    expect(u1Assignments).toHaveLength(2);

    // Engine should still produce valid output
    expect(result.slots).toHaveLength(14);
    expect(Array.isArray(result.conflicts)).toBe(true);
  });

  // ─── Scenario 7: Self-replacement (replacement_user_id === user_id) ────────
  test("Scenario 7: SHIFT_REPLACEMENT where user replaces themselves → no 'X за X'", () => {
    // u1 is assigned to Mon morning, then u1 tries to "replace" themselves
    const facts = [
      makeFact({
        user_id: "u1",
        fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" },
      }),
      makeFact({
        fact_type: "SHIFT_REPLACEMENT",
        user_id: "u1",
        fact_payload: { dow: "mon", from: "10:00", to: "13:00" },
        created_at: "2025-01-05T12:00:00Z",
      }),
    ];

    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const monMorning = result.assignments.find(
      (a) => a.dow === "mon" && a.from === "10:00" && a.to === "13:00"
    );

    expect(monMorning).toBeDefined();
    expect(monMorning.user_id).toBe("u1");

    // replaced_user_id should NOT equal user_id (no "Иса за Иса")
    if (monMorning.replaced_user_id) {
      expect(monMorning.replaced_user_id).not.toBe("u1");
    }

    // Reason should not contain "за Иса" from Иса's own replacement
    if (monMorning.reason) {
      expect(monMorning.reason).not.toMatch(/Иса за Иса/);
    }
  });
});
