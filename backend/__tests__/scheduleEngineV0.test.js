import { buildDraftSchedule } from "../scheduleEngineV0.js";

const WEEK_START = "2025-01-06";

function makeFact(overrides) {
  const { fact_payload, ...rest } = overrides || {};
  return {
    fact_type: "SHIFT_AVAILABILITY",
    user_id: "u1",
    fact_payload: {
      week_start: WEEK_START,
      dow: "mon",
      from: "10:00",
      to: "13:00",
      availability: "can",
      ...fact_payload,
    },
    created_at: "2025-01-05T10:00:00Z",
    ...rest,
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
    // senior1 is senior, u1 is junior — both available
    const facts = [
      makeFact({ user_id: "u1", fact_payload: { dow: "sat", from: "10:00", to: "13:00", availability: "can" } }),
      makeFact({ user_id: "senior1", fact_payload: { dow: "sat", from: "10:00", to: "13:00", availability: "can" } }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const satAssignment = result.assignments.find(
      (a) => a.dow === "sat" && a.from === "10:00"
    );
    expect(satAssignment).toBeDefined();
    // Junior u1 should be preferred over senior
    expect(satAssignment.user_id).toBe("u1");
  });

  test("Karina (u4) gets min 20 hours priority", () => {
    // u4 (karina) has minHours=20, should be prioritized in phase 1
    const facts = [
      makeFact({ user_id: "u4", fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" } }),
      makeFact({ user_id: "u3", fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" } }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const monAssignment = result.assignments.find(
      (a) => a.dow === "mon" && a.from === "10:00"
    );
    expect(monAssignment).toBeDefined();
    // u4 has minHours=20 > u3 minHours=0, so u4 should be assigned
    expect(monAssignment.user_id).toBe("u4");
  });

  test("SHIFT_REPLACEMENT overrides existing assignment for the slot", () => {
    const facts = [
      // u1 is available for thu morning
      makeFact({ user_id: "u1", fact_payload: { dow: "thu", from: "10:00", to: "13:00", availability: "can" } }),
      // u3 offers to replace on thu morning
      makeFact({
        fact_type: "SHIFT_REPLACEMENT",
        user_id: "u3",
        fact_payload: { dow: "thu", from: "10:00", to: "13:00" },
        created_at: "2025-01-05T12:00:00Z",
      }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const thuMorning = result.assignments.find(
      (a) => a.dow === "thu" && a.from === "10:00" && a.to === "13:00"
    );
    expect(thuMorning).toBeDefined();
    expect(thuMorning.user_id).toBe("u3");
    expect(thuMorning.replaced_user_id).toBe("u1");
    expect(thuMorning.reason).toContain("Замена");
    expect(thuMorning.reason).toContain("Ксюша");
    expect(thuMorning.reason).toContain("Иса");
  });

  test("SHIFT_REPLACEMENT reason contains emoji and both names", () => {
    const facts = [
      makeFact({ user_id: "u2", fact_payload: { dow: "wed", from: "18:00", to: "21:00", availability: "can" } }),
      makeFact({
        fact_type: "SHIFT_REPLACEMENT",
        user_id: "u4",
        fact_payload: { dow: "wed", from: "18:00", to: "21:00" },
        created_at: "2025-01-05T14:00:00Z",
      }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const wedEvening = result.assignments.find(
      (a) => a.dow === "wed" && a.from === "18:00" && a.to === "21:00"
    );
    expect(wedEvening.reason).toBe("🔄 Замена: Карина за Дарина");
  });

  test("SHIFT_REPLACEMENT populates replaced_user_id in slots array", () => {
    const facts = [
      makeFact({ user_id: "u1", fact_payload: { dow: "thu", from: "10:00", to: "13:00", availability: "can" } }),
      makeFact({
        fact_type: "SHIFT_REPLACEMENT",
        user_id: "u3",
        fact_payload: { dow: "thu", from: "10:00", to: "13:00" },
        created_at: "2025-01-05T12:00:00Z",
      }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const thuSlot = result.slots.find(
      (s) => s.dow === "thu" && s.slot_name === "Утро"
    );
    expect(thuSlot).toBeDefined();
    expect(thuSlot.user_id).toBe("u3");
    expect(thuSlot.replaced_user_id).toBe("u1");
  });

  test("SHIFT_REPLACEMENT without prior assignment creates new assignment", () => {
    const facts = [
      // No availability for fri morning — only a replacement offer
      makeFact({
        fact_type: "SHIFT_REPLACEMENT",
        user_id: "u3",
        fact_payload: { dow: "fri", from: "10:00", to: "13:00" },
        created_at: "2025-01-05T12:00:00Z",
      }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const friMorning = result.assignments.find(
      (a) => a.dow === "fri" && a.from === "10:00" && a.to === "13:00"
    );
    expect(friMorning).toBeDefined();
    expect(friMorning.user_id).toBe("u3");
    expect(friMorning.replaced_user_id).toBeNull();
    expect(friMorning.reason).toContain("Замена");
  });

  test("SHIFT_REPLACEMENT skips swap when SHIFT_ASSIGNMENT already assigns replacement user (recalc scenario)", () => {
    // Simulates recalculation after build-schedule: SHIFT_ASSIGNMENT with assigned_user_id=u3
    // already exists, and SHIFT_REPLACEMENT also says u3 should work this slot.
    // The engine must NOT produce "Ксюша за Ксюша".
    const facts = [
      // Persisted SHIFT_ASSIGNMENT from prior build (replacement result)
      makeFact({
        fact_type: "SHIFT_ASSIGNMENT",
        user_id: "admin1",
        fact_payload: {
          dow: "thu",
          from: "10:00",
          to: "13:00",
          assigned_user_id: "u3",
          replaced_user_id: "u1",
          reason: "🔄 Замена: Ксюша за Иса",
        },
        created_at: "2025-01-05T13:00:00Z",
      }),
      // Original SHIFT_REPLACEMENT fact still present
      makeFact({
        fact_type: "SHIFT_REPLACEMENT",
        user_id: "u3",
        fact_payload: { dow: "thu", from: "10:00", to: "13:00" },
        created_at: "2025-01-05T12:00:00Z",
      }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const thuMorning = result.assignments.find(
      (a) => a.dow === "thu" && a.from === "10:00" && a.to === "13:00"
    );
    expect(thuMorning).toBeDefined();
    expect(thuMorning.user_id).toBe("u3");
    // Must NOT have replaced_user_id === user_id (the "X за X" bug)
    expect(thuMorning.replaced_user_id).not.toBe("u3");
  });

  test("SHIFT_ASSIGNMENT preserves replaced_user_id and reason from fact_payload", () => {
    const facts = [
      makeFact({
        fact_type: "SHIFT_ASSIGNMENT",
        user_id: "admin1",
        fact_payload: {
          dow: "mon",
          from: "10:00",
          to: "13:00",
          assigned_user_id: "u3",
          replaced_user_id: "u1",
          reason: "🔄 Замена: Ксюша за Иса",
        },
        created_at: "2025-01-05T11:00:00Z",
      }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const monMorning = result.assignments.find(
      (a) => a.dow === "mon" && a.from === "10:00" && a.to === "13:00"
    );
    expect(monMorning).toBeDefined();
    expect(monMorning.user_id).toBe("u3");
    expect(monMorning.replaced_user_id).toBe("u1");
    expect(monMorning.reason).toContain("Замена");
  });

  test("SHIFT_REPLACEMENT still applies when SHIFT_ASSIGNMENT has different user", () => {
    // SHIFT_ASSIGNMENT assigns u1, but SHIFT_REPLACEMENT says u3 should replace.
    // Replacement should still override.
    const facts = [
      makeFact({
        fact_type: "SHIFT_ASSIGNMENT",
        user_id: "admin1",
        fact_payload: {
          dow: "wed",
          from: "18:00",
          to: "21:00",
          assigned_user_id: "u1",
        },
        created_at: "2025-01-05T10:00:00Z",
      }),
      makeFact({
        fact_type: "SHIFT_REPLACEMENT",
        user_id: "u3",
        fact_payload: { dow: "wed", from: "18:00", to: "21:00" },
        created_at: "2025-01-05T12:00:00Z",
      }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const wedEvening = result.assignments.find(
      (a) => a.dow === "wed" && a.from === "18:00" && a.to === "21:00"
    );
    expect(wedEvening).toBeDefined();
    expect(wedEvening.user_id).toBe("u3");
    expect(wedEvening.replaced_user_id).toBe("u1");
    expect(wedEvening.reason).toContain("Замена");
    expect(wedEvening.reason).toContain("Ксюша");
    expect(wedEvening.reason).toContain("Иса");
  });

  describe("stress tests", () => {
    test("all employees unavailable → no assignments, no crash", () => {
      // All 4 employees (u1–u4) send SHIFT_UNAVAILABILITY for every slot of the week
      const dows = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
      const slots = [
        { from: "10:00", to: "13:00" },
        { from: "18:00", to: "21:00" },
      ];
      const users = ["u1", "u2", "u3", "u4"];
      const facts = [];
      for (const user_id of users) {
        for (const dow of dows) {
          for (const { from, to } of slots) {
            facts.push(
              makeFact({
                fact_type: "SHIFT_UNAVAILABILITY",
                user_id,
                fact_payload: { dow, from, to, availability: "cannot" },
              })
            );
          }
        }
      }
      let result;
      expect(() => {
        result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
      }).not.toThrow();
      expect(result.assignments).toEqual([]);
    });

    test("availability then unavailability for same slot → user not assigned", () => {
      // u1 first says available, then says unavailable for mon morning
      const facts = [
        makeFact({
          user_id: "u1",
          fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" },
          created_at: "2025-01-05T09:00:00Z",
        }),
        makeFact({
          fact_type: "SHIFT_UNAVAILABILITY",
          user_id: "u1",
          fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "cannot" },
          created_at: "2025-01-05T11:00:00Z", // Later timestamp — takes priority
        }),
      ];
      const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
      const monMorningU1 = result.assignments.find(
        (a) => a.dow === "mon" && a.from === "10:00" && a.user_id === "u1"
      );
      expect(monMorningU1).toBeUndefined();
    });

    test("edge case: zero-length slot (from === to)", () => {
      // A slot where from and to are the same — engine must not crash
      const facts = [
        makeFact({
          user_id: "u1",
          fact_payload: { dow: "mon", from: "10:00", to: "10:00", availability: "can" },
        }),
      ];
      let result;
      expect(() => {
        result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
      }).not.toThrow();
      // Result must be a valid object
      expect(result).toBeDefined();
      expect(Array.isArray(result.assignments)).toBe(true);
    });

    test("edge case: overnight slot (from > to across midnight)", () => {
      // A slot spanning midnight (22:00 to 02:00) — engine must not crash
      // Document the actual behavior: it may or may not produce an assignment
      const facts = [
        makeFact({
          user_id: "u1",
          fact_payload: { dow: "mon", from: "22:00", to: "02:00", availability: "can" },
        }),
      ];
      let result;
      expect(() => {
        result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
      }).not.toThrow();
      expect(result).toBeDefined();
      expect(Array.isArray(result.assignments)).toBe(true);
    });

    test("edge case: invalid time format in slot", () => {
      // Fact has non-time strings for from/to — engine must not crash
      const facts = [
        makeFact({
          user_id: "u1",
          fact_payload: { dow: "mon", from: "abc", to: "xyz", availability: "can" },
        }),
      ];
      let result;
      expect(() => {
        result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
      }).not.toThrow();
      expect(result).toBeDefined();
      expect(Array.isArray(result.assignments)).toBe(true);
    });

    test("100 facts from 10 users → completes within 100ms", () => {
      // 10 virtual employees, each available for all 14 standard slots (7 days × 2)
      const dows = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
      const slots = [
        { from: "10:00", to: "13:00" },
        { from: "18:00", to: "21:00" },
      ];
      const facts = [];
      for (let i = 1; i <= 10; i++) {
        for (const dow of dows) {
          for (const { from, to } of slots) {
            facts.push(
              makeFact({
                user_id: `stress_user_${i}`,
                fact_payload: { dow, from, to, availability: "can" },
              })
            );
          }
        }
      }
      // Total: 10 users × 7 days × 2 slots = 140 facts (>100)
      expect(facts.length).toBeGreaterThanOrEqual(100);

      const start = Date.now();
      const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
      expect(result).toBeDefined();
      expect(Array.isArray(result.assignments)).toBe(true);
    });

    test("duplicate availability facts → single assignment per slot", () => {
      // u1 sends the exact same availability for mon morning 5 times
      const facts = Array.from({ length: 5 }, (_, i) =>
        makeFact({
          user_id: "u1",
          fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" },
          created_at: `2025-01-05T10:0${i}:00Z`,
        })
      );
      const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
      const monMorningAssignments = result.assignments.filter(
        (a) => a.dow === "mon" && a.from === "10:00" && a.to === "13:00"
      );
      // Must be exactly 1 assignment for the slot, not 5
      expect(monMorningAssignments).toHaveLength(1);
      expect(monMorningAssignments[0].user_id).toBe("u1");
    });
  });

  test("rebalance does not assign unavailable user to slot", () => {
    // u1 and u4 are both available for mon morning and tue morning.
    // u4 also marks itself unavailable for tue morning.
    // u4 has minHours=20, so rebalance may try to push u4 into tue morning —
    // but it must NOT because u4 is unavailable for that slot.
    const facts = [
      // u1 available mon morning
      makeFact({ user_id: "u1", fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" } }),
      // u4 available mon morning
      makeFact({ user_id: "u4", fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" } }),
      // u1 available tue morning
      makeFact({ user_id: "u1", fact_payload: { dow: "tue", from: "10:00", to: "13:00", availability: "can" } }),
      // u4 available tue morning (SHIFT_AVAILABILITY first, then overridden by unavailability)
      makeFact({ user_id: "u4", fact_payload: { dow: "tue", from: "10:00", to: "13:00", availability: "can" } }),
      // u4 marks unavailability for tue morning (later timestamp → takes priority)
      makeFact({
        fact_type: "SHIFT_UNAVAILABILITY",
        user_id: "u4",
        fact_payload: { dow: "tue", from: "10:00", to: "13:00", availability: "cannot" },
        created_at: "2025-01-05T12:00:00Z",
      }),
    ];
    const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
    const tueMorningAssignment = result.assignments.find(
      (a) => a.dow === "tue" && a.from === "10:00" && a.to === "13:00"
    );
    // u4 must NOT be assigned to tue morning — they are unavailable
    if (tueMorningAssignment) {
      expect(tueMorningAssignment.user_id).not.toBe("u4");
    }
  });

  // SL-034: Timestamp-aware AVAIL/UNAVAIL resolution
  describe("SL-034 — AVAIL/UNAVAIL conflict resolution", () => {
    test("newer AVAILABILITY overrides older UNAVAILABILITY for same user+slot", () => {
      const facts = [
        // u1: first says unavailable for sun morning (older)
        makeFact({
          fact_type: "SHIFT_UNAVAILABILITY",
          user_id: "u1",
          fact_payload: { dow: "sun", from: "10:00", to: "13:00", availability: "cannot" },
          created_at: "2025-01-05T08:00:00Z",
        }),
        // u1: then says available for sun morning (newer)
        makeFact({
          user_id: "u1",
          fact_payload: { dow: "sun", from: "10:00", to: "13:00", availability: "can" },
          created_at: "2025-01-05T12:00:00Z",
        }),
      ];
      const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
      const sunMorning = result.assignments.find(
        (a) => a.dow === "sun" && a.from === "10:00" && a.to === "13:00"
      );
      expect(sunMorning).toBeDefined();
      expect(sunMorning.user_id).toBe("u1");
    });

    test("newer UNAVAILABILITY overrides older AVAILABILITY for same user+slot", () => {
      const facts = [
        // u1: first says available (older)
        makeFact({
          user_id: "u1",
          fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" },
          created_at: "2025-01-05T08:00:00Z",
        }),
        // u1: then says unavailable (newer)
        makeFact({
          fact_type: "SHIFT_UNAVAILABILITY",
          user_id: "u1",
          fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "cannot" },
          created_at: "2025-01-05T12:00:00Z",
        }),
      ];
      const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
      const monMorning = result.assignments.find(
        (a) => a.dow === "mon" && a.from === "10:00" && a.user_id === "u1"
      );
      expect(monMorning).toBeUndefined();
    });

    test("unavailability blocks assignment in balanced phase", () => {
      const facts = [
        makeFact({
          user_id: "u1",
          fact_payload: { dow: "sun", from: "10:00", to: "13:00", availability: "can" },
        }),
        makeFact({
          fact_type: "SHIFT_UNAVAILABILITY",
          user_id: "u2",
          fact_payload: { dow: "sun", from: "18:00", to: "21:00", availability: "cannot" },
        }),
      ];
      const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
      const sunEvening = result.assignments.find(
        (a) => a.dow === "sun" && a.from === "18:00"
      );
      // u2 unavailable — must NOT be assigned
      if (sunEvening) {
        expect(sunEvening.user_id).not.toBe("u2");
      }
    });

    test("sunday morning gets assigned when candidate is available", () => {
      const facts = [
        makeFact({
          user_id: "u1",
          fact_payload: { dow: "sun", from: "10:00", to: "13:00", availability: "can" },
        }),
      ];
      const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
      const sunMorning = result.assignments.find(
        (a) => a.dow === "sun" && a.from === "10:00"
      );
      expect(sunMorning).toBeDefined();
      expect(sunMorning.user_id).toBe("u1");
    });
  });

  // SL-035: Double-shift avoidance
  describe("SL-035 — double-shift avoidance", () => {
    test("prefer rested candidate over double-shift when alternative exists", () => {
      const facts = [
        // u1 available mon morning + evening
        makeFact({ user_id: "u1", fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" } }),
        makeFact({ user_id: "u1", fact_payload: { dow: "mon", from: "18:00", to: "21:00", availability: "can" } }),
        // u2 available only mon evening
        makeFact({ user_id: "u2", fact_payload: { dow: "mon", from: "18:00", to: "21:00", availability: "can" } }),
      ];
      const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
      const monMorning = result.assignments.find(
        (a) => a.dow === "mon" && a.from === "10:00"
      );
      const monEvening = result.assignments.find(
        (a) => a.dow === "mon" && a.from === "18:00"
      );
      expect(monMorning).toBeDefined();
      expect(monEvening).toBeDefined();
      // u1 morning, u2 evening (no double shift for u1)
      // OR if u1 gets evening first due to narrowest-first sort (both have 1 candidate for morning,
      // 2 for evening → morning assigned first), then u1 gets morning, u2 gets evening
      // Either way u1 should NOT have both slots
      expect(monMorning.user_id !== monEvening.user_id || monEvening.user_id === "u1").toBe(true);
      // More precisely: since mon morning has only u1 (1 candidate = narrowest), it's assigned first
      // Then mon evening has u1+u2, but u1 already has a shift → prefer u2
      expect(monMorning.user_id).toBe("u1");
      expect(monEvening.user_id).toBe("u2");
    });

    test("allow double-shift when no alternatives exist", () => {
      const facts = [
        // Only u1 available for both mon slots
        makeFact({ user_id: "u1", fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" } }),
        makeFact({ user_id: "u1", fact_payload: { dow: "mon", from: "18:00", to: "21:00", availability: "can" } }),
      ];
      const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
      const monMorning = result.assignments.find(
        (a) => a.dow === "mon" && a.from === "10:00"
      );
      const monEvening = result.assignments.find(
        (a) => a.dow === "mon" && a.from === "18:00"
      );
      expect(monMorning).toBeDefined();
      expect(monEvening).toBeDefined();
      expect(monMorning.user_id).toBe("u1");
      expect(monEvening.user_id).toBe("u1");
    });

    test("rebalance does not create double shift", () => {
      // u4 (minHours=20) available for mon morning only
      // u1 available for mon morning + evening
      // u2 available for mon evening only
      // After assignment: u4 gets morning (higher min), u2 gets evening
      // Rebalance should NOT swap u4 into evening (double shift)
      const facts = [
        makeFact({ user_id: "u4", fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" } }),
        makeFact({ user_id: "u1", fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" } }),
        makeFact({ user_id: "u1", fact_payload: { dow: "mon", from: "18:00", to: "21:00", availability: "can" } }),
        makeFact({ user_id: "u4", fact_payload: { dow: "mon", from: "18:00", to: "21:00", availability: "can" } }),
      ];
      const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
      const monMorning = result.assignments.find(
        (a) => a.dow === "mon" && a.from === "10:00"
      );
      const monEvening = result.assignments.find(
        (a) => a.dow === "mon" && a.from === "18:00"
      );
      expect(monMorning).toBeDefined();
      expect(monEvening).toBeDefined();
      // Should not be same user for both slots when alternatives exist
      expect(monMorning.user_id).not.toBe(monEvening.user_id);
    });
  });

  // SL-035b: Slot-type scarcity (specificity)
  describe("SL-035b — slot-type scarcity", () => {
    test("candidate with fewer evening options gets priority for evening slot", () => {
      // u1: available for tue morning + evening (2 slots: 1 morning, 1 evening)
      // u4: available for tue morning + evening + wed morning + wed evening (4 slots: 2 mornings, 2 evenings)
      // For tue evening, u1 has fewer evening options (1 vs 2) → u1 should get tue evening
      // For tue morning, u1 has fewer morning options (1 vs 2) → u1 should get tue morning
      // But double-shift rule prevents u1 from getting both → u1 gets evening (scarcer), u4 gets morning
      const facts = [
        makeFact({ user_id: "u1", fact_payload: { dow: "tue", from: "10:00", to: "13:00", availability: "can" } }),
        makeFact({ user_id: "u1", fact_payload: { dow: "tue", from: "18:00", to: "21:00", availability: "can" } }),
        makeFact({ user_id: "u4", fact_payload: { dow: "tue", from: "10:00", to: "13:00", availability: "can" } }),
        makeFact({ user_id: "u4", fact_payload: { dow: "tue", from: "18:00", to: "21:00", availability: "can" } }),
        makeFact({ user_id: "u4", fact_payload: { dow: "wed", from: "10:00", to: "13:00", availability: "can" } }),
        makeFact({ user_id: "u4", fact_payload: { dow: "wed", from: "18:00", to: "21:00", availability: "can" } }),
      ];
      const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
      const tueMorning = result.assignments.find(a => a.dow === "tue" && a.from === "10:00");
      const tueEvening = result.assignments.find(a => a.dow === "tue" && a.from === "18:00");
      expect(tueMorning).toBeDefined();
      expect(tueEvening).toBeDefined();
      // u1 and u4 should not share a double shift on Tue
      expect(tueMorning.user_id).not.toBe(tueEvening.user_id);
    });

    test("flexible candidate fills remaining slots after specific candidates placed", () => {
      // u2 (specific): available only tue morning
      // u4 (flexible): available tue morning + tue evening + wed morning + wed evening
      // u1 (specific evenings): available tue evening only
      // Expected: u2 gets tue morning (specific), u1 gets tue evening (specific),
      //           u4 gets wed morning + evening (flexible fills rest)
      const facts = [
        makeFact({ user_id: "u2", fact_payload: { dow: "tue", from: "10:00", to: "13:00", availability: "can" } }),
        makeFact({ user_id: "u4", fact_payload: { dow: "tue", from: "10:00", to: "13:00", availability: "can" } }),
        makeFact({ user_id: "u4", fact_payload: { dow: "tue", from: "18:00", to: "21:00", availability: "can" } }),
        makeFact({ user_id: "u1", fact_payload: { dow: "tue", from: "18:00", to: "21:00", availability: "can" } }),
        makeFact({ user_id: "u4", fact_payload: { dow: "wed", from: "10:00", to: "13:00", availability: "can" } }),
        makeFact({ user_id: "u4", fact_payload: { dow: "wed", from: "18:00", to: "21:00", availability: "can" } }),
      ];
      const result = buildDraftSchedule({ facts, weekStartISO: WEEK_START });
      const tueMorning = result.assignments.find(a => a.dow === "tue" && a.from === "10:00");
      const tueEvening = result.assignments.find(a => a.dow === "tue" && a.from === "18:00");
      const wedMorning = result.assignments.find(a => a.dow === "wed" && a.from === "10:00");
      const wedEvening = result.assignments.find(a => a.dow === "wed" && a.from === "18:00");
      // Specific candidates get their slots
      expect(tueMorning.user_id).toBe("u2"); // u2 has only 1 morning option
      expect(tueEvening.user_id).toBe("u1"); // u1 has only 1 evening option
      // Flexible candidate fills remaining
      expect(wedMorning.user_id).toBe("u4");
      expect(wedEvening.user_id).toBe("u4");
    });
  });
});
