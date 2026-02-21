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
  test("initial state with no facts = COLLECTING", () => {
    const result = computeWeekState({ facts: [], weekStartISO: WEEK_START });
    expect(result.state).toBe("COLLECTING");
    expect(result.week_start).toBe(WEEK_START);
  });

  test("WEEK_OPEN → COLLECTING", () => {
    const facts = [makeFact("WEEK_OPEN", {}, "2025-01-05T10:00:00Z")];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.state).toBe("COLLECTING");
  });

  test("WEEK_PROPOSE (schedule built) → ACTIVE", () => {
    const facts = [
      makeFact("WEEK_OPEN", {}, "2025-01-05T10:00:00Z"),
      makeFact("WEEK_PROPOSE", {}, "2025-01-05T11:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.state).toBe("ACTIVE");
  });

  test("SCHEDULE_BUILT → ACTIVE", () => {
    const facts = [
      makeFact("WEEK_OPEN", {}, "2025-01-05T10:00:00Z"),
      makeFact("SCHEDULE_BUILT", {}, "2025-01-05T11:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.state).toBe("ACTIVE");
  });

  test("WEEK_LOCK → CLOSED", () => {
    const facts = [
      makeFact("WEEK_OPEN", {}, "2025-01-05T10:00:00Z"),
      makeFact("WEEK_PROPOSE", {}, "2025-01-05T11:00:00Z"),
      makeFact("WEEK_LOCK", {}, "2025-01-05T13:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.state).toBe("CLOSED");
  });

  test("WEEK_CLOSE → CLOSED", () => {
    const facts = [
      makeFact("WEEK_OPEN", {}, "2025-01-05T10:00:00Z"),
      makeFact("WEEK_CLOSE", {}, "2025-01-05T13:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.state).toBe("CLOSED");
  });

  test("re-open after ACTIVE → COLLECTING", () => {
    const facts = [
      makeFact("WEEK_OPEN", {}, "2025-01-05T10:00:00Z"),
      makeFact("WEEK_PROPOSE", {}, "2025-01-05T11:00:00Z"),
      makeFact("WEEK_OPEN", {}, "2025-01-05T14:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.state).toBe("COLLECTING");
  });

  test("re-open after CLOSED → COLLECTING", () => {
    const facts = [
      makeFact("WEEK_LOCK", {}, "2025-01-05T10:00:00Z"),
      makeFact("SHIFT_GAP", { dow: "mon", from: "10:00", to: "13:00" }, "2025-01-05T11:00:00Z"),
      makeFact("WEEK_OPEN", {}, "2025-01-05T12:00:00Z"),
      makeFact("SHIFT_ASSIGNMENT", { dow: "mon", from: "10:00", to: "13:00", assigned_user_id: "u1" }, "2025-01-05T13:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.state).toBe("COLLECTING");
  });

  test("latest command wins (LOCK directly → CLOSED)", () => {
    const facts = [makeFact("WEEK_LOCK", {}, "2025-01-05T10:00:00Z")];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.state).toBe("CLOSED");
  });

  test("last_commands tracks timestamps", () => {
    const facts = [
      makeFact("WEEK_OPEN", {}, "2025-01-05T10:00:00Z"),
      makeFact("WEEK_PROPOSE", {}, "2025-01-05T11:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.last_commands.open).toBe("2025-01-05T10:00:00Z");
    expect(result.last_commands.built).toBe("2025-01-05T11:00:00Z");
  });

  test("full lifecycle: COLLECTING → ACTIVE → CLOSED → re-open", () => {
    const facts = [
      makeFact("WEEK_OPEN", {}, "2025-01-05T10:00:00Z"),
      makeFact("WEEK_PROPOSE", {}, "2025-01-05T11:00:00Z"),
      makeFact("WEEK_LOCK", {}, "2025-01-05T13:00:00Z"),
      makeFact("WEEK_OPEN", {}, "2025-01-05T14:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.state).toBe("COLLECTING");
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

  test("open gaps produce required_actions and hasProblem", () => {
    const facts = [
      makeFact("SHIFT_GAP", { dow: "mon", from: "10:00", to: "13:00" }, "2025-01-05T10:00:00Z"),
    ];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.hasGaps).toBe(true);
    expect(result.hasProblem).toBe(true);
    expect(result.required_actions).toContain("uncovered shifts — replacement needed");
  });

  test("no gaps → hasProblem false", () => {
    const facts = [makeFact("WEEK_OPEN", {}, "2025-01-05T10:00:00Z")];
    const result = computeWeekState({ facts, weekStartISO: WEEK_START });
    expect(result.hasGaps).toBe(false);
    expect(result.hasProblem).toBe(false);
  });
});
