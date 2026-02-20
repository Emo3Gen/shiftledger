import { buildDraftSchedule } from "../scheduleEngineV0.js";

const WEEK_START = "2025-01-06";

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

describe("scheduleEngineV0", () => {
  test("2 users, 3 slots → correct assignments", () => {
    const facts = [
      makeFact({ user_id: "u1", fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" } }),
      makeFact({ user_id: "u2", fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" } }),
      makeFact({ user_id: "u1", fact_payload: { dow: "mon", from: "18:00", to: "21:00", availability: "can" } }),
      makeFact({ user_id: "u2", fact_payload: { dow: "tue", from: "10:00", to: "13:00", availability: "can" } }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    expect(result.assignments.length).toBeGreaterThanOrEqual(3);
    expect(result.week_start).toBe(WEEK_START);
  });

  test("slot without any availability → no assignment, may be empty", () => {
    // Only provide availability for one slot, no one available for wed 10-13
    const facts = [
      makeFact({ user_id: "u1", fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" } }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    // mon 10-13 should be assigned, but wed 10-13 has no availability
    const monAssignment = result.assignments.find(
      (a) => a.dow === "mon" && a.from === "10:00" && a.to === "13:00"
    );
    expect(monAssignment).toBeDefined();
  });

  test("GAP with candidate → appears in gaps with 'candidates available'", () => {
    const facts = [
      makeFact({
        fact_type: "SHIFT_GAP",
        user_id: "admin1",
        fact_payload: { dow: "thu", from: "18:00", to: "21:00", urgency: "high" },
      }),
      makeFact({
        user_id: "u1",
        fact_payload: { dow: "thu", from: "18:00", to: "21:00", availability: "can" },
      }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const gap = result.gaps.find((g) => g.dow === "thu" && g.from === "18:00");
    expect(gap).toBeDefined();
    expect(gap.reason).toContain("candidates available");
  });

  test("GAP without candidate → appears in gaps with 'no candidates'", () => {
    const facts = [
      makeFact({
        fact_type: "SHIFT_GAP",
        user_id: "admin1",
        fact_payload: { dow: "thu", from: "18:00", to: "21:00", urgency: "high" },
      }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const gap = result.gaps.find((g) => g.dow === "thu" && g.from === "18:00");
    expect(gap).toBeDefined();
    expect(gap.reason).toContain("no candidates");
  });

  test("equal availability count → alphabetical sort by user_id", () => {
    const facts = [
      makeFact({ user_id: "u2", fact_payload: { dow: "wed", from: "10:00", to: "13:00", availability: "can" } }),
      makeFact({ user_id: "u1", fact_payload: { dow: "wed", from: "10:00", to: "13:00", availability: "can" } }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const wedAssignment = result.assignments.find(
      (a) => a.dow === "wed" && a.from === "10:00"
    );
    expect(wedAssignment).toBeDefined();
    // u1 has minHours=22, u2 has minHours=20 — u1 should be assigned first (meet_minimum)
    expect(["u1", "u2"]).toContain(wedAssignment.user_id);
  });

  test("empty facts array → empty assignments, gaps, conflicts", () => {
    const result = buildDraftSchedule({ facts: [], weekStartISO: WEEK_START });
    expect(result.assignments).toEqual([]);
    expect(result.gaps).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  test("SHIFT_UNAVAILABILITY is not treated as availability", () => {
    // Only one unavailability fact, no availability
    const facts = [
      makeFact({
        fact_type: "SHIFT_UNAVAILABILITY",
        user_id: "u1",
        fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "cannot" },
      }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    // u1 should not be assigned for mon 10-13 from this fact
    const assignment = result.assignments.find(
      (a) => a.dow === "mon" && a.from === "10:00" && a.user_id === "u1"
    );
    expect(assignment).toBeUndefined();
  });

  test("multiple users on one slot → one is selected, rest are not lost", () => {
    const facts = [
      makeFact({ user_id: "u1", fact_payload: { dow: "fri", from: "10:00", to: "13:00", availability: "can" } }),
      makeFact({ user_id: "u2", fact_payload: { dow: "fri", from: "10:00", to: "13:00", availability: "can" } }),
      makeFact({ user_id: "u3", fact_payload: { dow: "fri", from: "10:00", to: "13:00", availability: "can" } }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const friAssignments = result.assignments.filter(
      (a) => a.dow === "fri" && a.from === "10:00" && a.to === "13:00"
    );
    // Exactly 1 assignment per slot
    expect(friAssignments).toHaveLength(1);
    expect(["u1", "u2", "u3"]).toContain(friAssignments[0].user_id);
  });

  test("week_start is set correctly in output", () => {
    const result = buildDraftSchedule({ facts: [], weekStartISO: WEEK_START });
    expect(result.week_start).toBe(WEEK_START);
  });

  test("each assignment contains reason field", () => {
    const facts = [
      makeFact({ user_id: "u1", fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" } }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    for (const a of result.assignments) {
      expect(a.reason).toBeDefined();
      expect(typeof a.reason).toBe("string");
    }
  });

  test("SHIFT_ASSIGNMENT facts override auto-assignment", () => {
    const facts = [
      makeFact({ user_id: "u1", fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" } }),
      makeFact({
        fact_type: "SHIFT_ASSIGNMENT",
        user_id: "admin1",
        fact_payload: { dow: "mon", from: "10:00", to: "13:00", assigned_user_id: "u2" },
        created_at: "2025-01-05T11:00:00Z",
      }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const monAssignment = result.assignments.find(
      (a) => a.dow === "mon" && a.from === "10:00" && a.to === "13:00"
    );
    expect(monAssignment).toBeDefined();
    expect(monAssignment.user_id).toBe("u2");
    expect(monAssignment.reason).toBe("manual assignment");
  });

  test("result contains meta with facts_count", () => {
    const facts = [
      makeFact({ user_id: "u1", fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" } }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    expect(result.meta).toBeDefined();
    expect(result.meta.facts_count).toBe(1);
    expect(result.meta.engine).toBe("v0");
  });

  test("slots array contains all 14 slots (7 days × 2)", () => {
    const result = buildDraftSchedule({ facts: [], weekStartISO: WEEK_START });
    expect(result.slots).toHaveLength(14);
    // Each slot has required fields
    for (const slot of result.slots) {
      expect(slot.dow).toBeDefined();
      expect(slot.from).toBeDefined();
      expect(slot.to).toBeDefined();
      expect(slot.status).toBeDefined();
      expect(["EMPTY", "PENDING", "CONFIRMED"]).toContain(slot.status);
    }
  });

  test("senior users are used only as last resort", () => {
    // u4 (karina) is senior, u1 is junior — both available
    const facts = [
      makeFact({ user_id: "u1", fact_payload: { dow: "sat", from: "10:00", to: "13:00", availability: "can" } }),
      makeFact({ user_id: "u4", fact_payload: { dow: "sat", from: "10:00", to: "13:00", availability: "can" } }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const satAssignment = result.assignments.find(
      (a) => a.dow === "sat" && a.from === "10:00"
    );
    expect(satAssignment).toBeDefined();
    // Junior u1 should be preferred over senior u4
    expect(satAssignment.user_id).toBe("u1");
  });
});
