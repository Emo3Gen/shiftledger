import { computeWeekState } from "../weekStateV0.js";

const WEEK_START = "2025-01-06";

function makeFact(factType, payload, createdAt) {
  return {
    fact_type: factType,
    fact_payload: { week_start: WEEK_START, ...payload },
    created_at: createdAt || "2025-01-05T10:00:00Z",
    user_id: "admin1",
  };
}

describe("weekStateV0", () => {
  test("initial state with no facts = DRAFT", () => {
    const result = computeWeekState({ facts: [], weekStartISO: WEEK_START });
    expect(result.state).toBe("DRAFT");
    expect(result.week_start).toBe(WEEK_START);
  });

  test("DRAFT → COLLECTING: WEEK_OPEN transitions to COLLECTING", () => {
    const facts = [makeFact("WEEK_OPEN", {}, "2025-01-05T10:00:00Z")];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.state).toBe("COLLECTING");
  });

  test("COLLECTING → PROPOSED: WEEK_PROPOSE transitions", () => {
    const facts = [
      makeFact("WEEK_OPEN", {}, "2025-01-05T10:00:00Z"),
      makeFact("WEEK_PROPOSE", {}, "2025-01-05T11:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.state).toBe("PROPOSED");
  });

  test("PROPOSED → CONFIRMING: WEEK_CONFIRM transitions", () => {
    const facts = [
      makeFact("WEEK_OPEN", {}, "2025-01-05T10:00:00Z"),
      makeFact("WEEK_PROPOSE", {}, "2025-01-05T11:00:00Z"),
      makeFact("WEEK_CONFIRM", {}, "2025-01-05T12:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.state).toBe("CONFIRMING");
  });

  test("CONFIRMING → LOCKED: WEEK_LOCK transitions", () => {
    const facts = [
      makeFact("WEEK_OPEN", {}, "2025-01-05T10:00:00Z"),
      makeFact("WEEK_PROPOSE", {}, "2025-01-05T11:00:00Z"),
      makeFact("WEEK_CONFIRM", {}, "2025-01-05T12:00:00Z"),
      makeFact("WEEK_LOCK", {}, "2025-01-05T13:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.state).toBe("LOCKED");
  });

  test("LOCKED → EMERGENCY: open gap after lock → EMERGENCY", () => {
    const facts = [
      makeFact("WEEK_LOCK", {}, "2025-01-05T10:00:00Z"),
      makeFact("SHIFT_GAP", { dow: "mon", from: "10:00", to: "13:00" }, "2025-01-05T11:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.state).toBe("EMERGENCY");
    expect(result.gaps_open.length).toBeGreaterThan(0);
  });

  test("EMERGENCY → COLLECTING: re-open after emergency", () => {
    const facts = [
      makeFact("WEEK_LOCK", {}, "2025-01-05T10:00:00Z"),
      makeFact("SHIFT_GAP", { dow: "mon", from: "10:00", to: "13:00" }, "2025-01-05T11:00:00Z"),
      // Re-open week to go back to collecting
      makeFact("WEEK_OPEN", {}, "2025-01-05T12:00:00Z"),
      // Close the gap with assignment
      makeFact("SHIFT_ASSIGNMENT", { dow: "mon", from: "10:00", to: "13:00", assigned_user_id: "u1" }, "2025-01-05T13:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.state).toBe("COLLECTING");
  });

  test("invalid transition: latest command wins (DRAFT → LOCK directly)", () => {
    // In latest-command-wins model, any command can be the latest
    const facts = [makeFact("WEEK_LOCK", {}, "2025-01-05T10:00:00Z")];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.state).toBe("LOCKED");
  });

  test("each transition is logged in last_commands", () => {
    const facts = [
      makeFact("WEEK_OPEN", {}, "2025-01-05T10:00:00Z"),
      makeFact("WEEK_PROPOSE", {}, "2025-01-05T11:00:00Z"),
      makeFact("WEEK_CONFIRM", {}, "2025-01-05T12:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.last_commands.open).toBe("2025-01-05T10:00:00Z");
    expect(result.last_commands.propose).toBe("2025-01-05T11:00:00Z");
    expect(result.last_commands.confirm).toBe("2025-01-05T12:00:00Z");
  });

  test("current state is correct after series of transitions", () => {
    const facts = [
      makeFact("WEEK_OPEN", {}, "2025-01-05T10:00:00Z"),
      makeFact("WEEK_PROPOSE", {}, "2025-01-05T11:00:00Z"),
      makeFact("WEEK_CONFIRM", {}, "2025-01-05T12:00:00Z"),
      makeFact("WEEK_LOCK", {}, "2025-01-05T13:00:00Z"),
      // Re-open
      makeFact("WEEK_OPEN", {}, "2025-01-05T14:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.state).toBe("COLLECTING");
  });

  test("required_actions includes 'confirmations required' when PROPOSED", () => {
    const facts = [
      makeFact("WEEK_OPEN", {}, "2025-01-05T10:00:00Z"),
      makeFact("WEEK_PROPOSE", {}, "2025-01-05T11:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.required_actions).toContain("confirmations required");
  });

  test("gaps_open correctly tracks open and closed gaps", () => {
    const facts = [
      makeFact("SHIFT_GAP", { dow: "mon", from: "10:00", to: "13:00" }, "2025-01-05T10:00:00Z"),
      makeFact("SHIFT_GAP", { dow: "tue", from: "18:00", to: "21:00" }, "2025-01-05T10:00:00Z"),
      // Close the mon gap
      makeFact("SHIFT_ASSIGNMENT", { dow: "mon", from: "10:00", to: "13:00", assigned_user_id: "u1" }, "2025-01-05T11:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.gaps_open).toHaveLength(1);
    expect(result.gaps_open[0].dow).toBe("tue");
  });
});
