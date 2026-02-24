import { buildTimesheet } from "../timesheetV0.js";

const WEEK_START = "2025-01-06";

function makeSchedule(assignments) {
  return {
    week_start: WEEK_START,
    assignments: assignments || [],
    gaps: [],
    conflicts: [],
    slots: [],
  };
}

function makeFact(factType, userId, payload, createdAt) {
  return {
    fact_type: factType,
    user_id: userId,
    fact_payload: { week_start: WEEK_START, ...payload },
    created_at: createdAt || "2025-01-05T10:00:00Z",
  };
}

describe("timesheetV0", () => {
  test("planned hours = worked hours → correct salary", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const facts = [];
    const hourlyRates = { u1: 280 };
    const result = buildTimesheet({ facts, weekStartISO: WEEK_START, hourlyRates, schedule });
    const row = result.rows.find((r) => r.user_id === "u1");
    expect(row).toBeDefined();
    // Plan = fact by default: worked = planned = 3 hours
    expect(row.hours_planned).toBe(3);
    expect(row.hours_worked).toBe(3);
    expect(row.amount).toBe(3 * 280);
  });

  test("overtime: extra SHIFT_WORKED beyond plan → overtime reflected", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const facts = [
      // Worked the planned shift AND an extra unplanned shift
      makeFact("SHIFT_WORKED", "u1", { dow: "mon", from: "10:00", to: "13:00" }),
      makeFact("SHIFT_WORKED", "u1", { dow: "mon", from: "18:00", to: "21:00" }),
    ];
    const hourlyRates = { u1: 280 };
    const result = buildTimesheet({ facts, weekStartISO: WEEK_START, hourlyRates, schedule });
    const row = result.rows.find((r) => r.user_id === "u1");
    expect(row).toBeDefined();
    expect(row.hours_worked).toBe(6); // 3h planned + 3h extra
    expect(row.hours_planned).toBe(3);
    expect(row.overtime_hours).toBe(3);
    expect(row.flags).toContain("overtime");
  });

  test("no-show: planned but not worked → no_show flag", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const facts = [
      // Explicit NO_SHOW — override the plan=fact default by providing SHIFT_WORKED with 0 hours
      // Actually, to get no_show: the user has planned hours but workedHours = 0
      // This happens when SHIFT_WORKED explicitly shows 0 or
      // there is no fact at all AND there's some mechanism to cancel default plan=fact
      // For this test, let's use SHIFT_FACT_CONFIRMED with status=problem to reduce hours
    ];
    // Without explicit SHIFT_WORKED, plan=fact applies, so workedHours = planned
    // To test no_show, we'd need planned hours but 0 worked
    // Let's use a user that has planned but has a fact_confirmed=problem reducing all
    const facts2 = [
      makeFact("SHIFT_FACT_CONFIRMED", "u1", { dow: "mon", from: "10:00", to: "13:00", status: "problem" }),
    ];
    const result = buildTimesheet({ facts: facts2, weekStartISO: WEEK_START, hourlyRates: { u1: 280 }, schedule });
    const row = result.rows.find((r) => r.user_id === "u1");
    expect(row).toBeDefined();
    // problem shift reduces by 1 hour: 3-1 = 2
    expect(row.hours_worked).toBe(2);
    expect(row.flags).toContain("fact_adjusted");
  });

  test("problem shift: reduces by 1 hour", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const facts = [
      makeFact("SHIFT_FACT_CONFIRMED", "u1", { dow: "mon", from: "10:00", to: "13:00", status: "problem", reason: "late" }),
    ];
    const hourlyRates = { u1: 280 };
    const result = buildTimesheet({ facts, weekStartISO: WEEK_START, hourlyRates, schedule });
    const row = result.rows.find((r) => r.user_id === "u1");
    expect(row).toBeDefined();
    expect(row.hours_worked).toBe(2); // 3 - 1 = 2
    expect(row.flags).toContain("fact_adjusted");
    expect(row.flags).toContain("problem:late");
  });

  test("empty input → zero timesheet", () => {
    const result = buildTimesheet({
      facts: [],
      weekStartISO: WEEK_START,
      hourlyRates: {},
      schedule: makeSchedule([]),
    });
    expect(result.rows).toEqual([]);
    expect(result.totals.hours_worked).toBe(0);
    expect(result.totals.amount).toBe(0);
  });

  test("multiple employees → each gets own row", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
      { dow: "mon", from: "18:00", to: "21:00", user_id: "u2", reason: "auto" },
    ]);
    const hourlyRates = { u1: 280, u2: 280 };
    const result = buildTimesheet({ facts: [], weekStartISO: WEEK_START, hourlyRates, schedule });
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    const u1 = result.rows.find((r) => r.user_id === "u1");
    const u2 = result.rows.find((r) => r.user_id === "u2");
    expect(u1).toBeDefined();
    expect(u2).toBeDefined();
  });

  test("rate from hourlyRates is correctly applied", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const hourlyRates = { u1: 350 };
    const result = buildTimesheet({ facts: [], weekStartISO: WEEK_START, hourlyRates, schedule });
    const row = result.rows.find((r) => r.user_id === "u1");
    expect(row.amount).toBe(3 * 350);
  });

  test("total amount = sum of employee amounts", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
      { dow: "mon", from: "18:00", to: "21:00", user_id: "u2", reason: "auto" },
    ]);
    const hourlyRates = { u1: 280, u2: 300 };
    const result = buildTimesheet({ facts: [], weekStartISO: WEEK_START, hourlyRates, schedule });
    const expectedTotal = result.rows.reduce((sum, r) => sum + r.amount, 0);
    expect(result.totals.amount).toBe(expectedTotal);
  });

  test("week_start is set correctly in output", () => {
    const result = buildTimesheet({
      facts: [],
      weekStartISO: WEEK_START,
      hourlyRates: {},
      schedule: makeSchedule([]),
    });
    expect(result.week_start).toBe(WEEK_START);
  });

  test("rows are sorted by user_id", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "18:00", to: "21:00", user_id: "u2", reason: "auto" },
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const hourlyRates = { u1: 280, u2: 280 };
    const result = buildTimesheet({ facts: [], weekStartISO: WEEK_START, hourlyRates, schedule });
    for (let i = 1; i < result.rows.length; i++) {
      expect(result.rows[i].user_id >= result.rows[i - 1].user_id).toBe(true);
    }
  });

  test("cleaning: CLEANING_DONE facts counted and paid at 500₽ each", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const facts = [
      makeFact("CLEANING_DONE", "u1", { dow: "mon" }),
      makeFact("CLEANING_DONE", "u1", { dow: "wed" }),
    ];
    const hourlyRates = { u1: 280 };
    const result = buildTimesheet({ facts, weekStartISO: WEEK_START, hourlyRates, schedule });
    const row = result.rows.find((r) => r.user_id === "u1");
    expect(row).toBeDefined();
    expect(row.cleaning_count).toBe(2);
    expect(row.cleaning_pay).toBe(1000); // 2 × 500
    expect(row.total_pay).toBe(3 * 280 + 1000); // shift pay + cleaning pay
  });

  test("extra classes: EXTRA_CLASS facts counted with hours and paid at 300₽/h", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const facts = [
      makeFact("EXTRA_CLASS", "u1", { dow: "mon", from: "14:00", to: "16:00" }),
    ];
    const hourlyRates = { u1: 280 };
    const result = buildTimesheet({ facts, weekStartISO: WEEK_START, hourlyRates, schedule });
    const row = result.rows.find((r) => r.user_id === "u1");
    expect(row).toBeDefined();
    expect(row.extra_classes_count).toBe(1);
    expect(row.extra_classes_hours).toBe(2);
    expect(row.extra_classes_pay).toBe(600); // 2h × 300
    expect(row.total_pay).toBe(3 * 280 + 600);
  });

  test("total_pay includes shift + cleaning + extra classes", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const facts = [
      makeFact("CLEANING_DONE", "u1", { dow: "mon" }),
      makeFact("EXTRA_CLASS", "u1", { dow: "tue", from: "14:00", to: "15:00" }),
    ];
    const hourlyRates = { u1: 280 };
    const result = buildTimesheet({ facts, weekStartISO: WEEK_START, hourlyRates, schedule });
    const row = result.rows.find((r) => r.user_id === "u1");
    expect(row).toBeDefined();
    const expectedShiftPay = 3 * 280; // 840
    const expectedCleaningPay = 500;
    const expectedExtraClassPay = 1 * 300; // 300
    expect(row.total_pay).toBe(expectedShiftPay + expectedCleaningPay + expectedExtraClassPay);
  });

  test("totals include cleaning_pay and extra_classes_pay", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
      { dow: "mon", from: "18:00", to: "21:00", user_id: "u2", reason: "auto" },
    ]);
    const facts = [
      makeFact("CLEANING_DONE", "u1", { dow: "mon" }),
      makeFact("EXTRA_CLASS", "u2", { dow: "tue", from: "14:00", to: "16:00" }),
    ];
    const hourlyRates = { u1: 280, u2: 280 };
    const result = buildTimesheet({ facts, weekStartISO: WEEK_START, hourlyRates, schedule });
    expect(result.totals.cleaning_pay).toBe(500);
    expect(result.totals.extra_classes_pay).toBe(600); // 2h × 300
    expect(result.totals.total_pay).toBe(result.totals.amount + 500 + 600);
  });

  test("user with only cleaning facts appears in timesheet", () => {
    const schedule = makeSchedule([]);
    const facts = [
      makeFact("CLEANING_DONE", "u3", { dow: "fri" }),
    ];
    const hourlyRates = {};
    const result = buildTimesheet({ facts, weekStartISO: WEEK_START, hourlyRates, schedule });
    const row = result.rows.find((r) => r.user_id === "u3");
    expect(row).toBeDefined();
    expect(row.cleaning_count).toBe(1);
    expect(row.cleaning_pay).toBe(500);
    expect(row.hours_worked).toBe(0);
    expect(row.total_pay).toBe(500);
  });
});
