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

describe("timesheetV0 — plan=fact", () => {
  test("basic: assignment → correct shift_hours, effective_hours, total_pay (rounded)", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const hourlyRates = { u1: 280 };
    const result = buildTimesheet({ facts: [], weekStartISO: WEEK_START, hourlyRates, schedule });

    expect(result.employees).toHaveLength(1);
    const emp = result.employees[0];
    expect(emp.user_id).toBe("u1");
    expect(emp.shift_hours).toBe(3);
    expect(emp.problem_shifts).toBe(0);
    expect(emp.problem_deduction_hours).toBe(0);
    expect(emp.effective_hours).toBe(3);
    expect(emp.shift_pay).toBe(840);
    expect(emp.total_before_rounding).toBe(840);
    expect(emp.total_pay).toBe(900); // ceil(840/100)*100
  });

  test("problem shift: 1h deduction per SHIFT_MARKED_PROBLEM", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const facts = [
      makeFact("SHIFT_MARKED_PROBLEM", "admin1", { dow: "mon", from: "10:00", to: "13:00" }),
    ];
    const hourlyRates = { u1: 280 };
    const result = buildTimesheet({ facts, weekStartISO: WEEK_START, hourlyRates, schedule });

    const emp = result.employees.find((e) => e.user_id === "u1");
    expect(emp.shift_hours).toBe(3);
    expect(emp.problem_shifts).toBe(1);
    expect(emp.problem_deduction_hours).toBe(1);
    expect(emp.effective_hours).toBe(2);
    expect(emp.shift_pay).toBe(560); // 2 * 280
    expect(emp.total_pay).toBe(600); // ceil(560/100)*100
  });

  test("problem shift: PROBLEM_SHIFT with user_id in payload", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const facts = [
      makeFact("PROBLEM_SHIFT", "admin1", { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "late" }),
    ];
    const hourlyRates = { u1: 280 };
    const result = buildTimesheet({ facts, weekStartISO: WEEK_START, hourlyRates, schedule });

    const emp = result.employees.find((e) => e.user_id === "u1");
    expect(emp.problem_shifts).toBe(1);
    expect(emp.effective_hours).toBe(2);
    expect(emp.shift_pay).toBe(560);
  });

  test("multiple problem shifts: each deducts 1h", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
      { dow: "tue", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const facts = [
      makeFact("SHIFT_MARKED_PROBLEM", "admin1", { dow: "mon", from: "10:00", to: "13:00" }),
      makeFact("SHIFT_MARKED_PROBLEM", "admin1", { dow: "tue", from: "10:00", to: "13:00" }),
    ];
    const hourlyRates = { u1: 280 };
    const result = buildTimesheet({ facts, weekStartISO: WEEK_START, hourlyRates, schedule });

    const emp = result.employees.find((e) => e.user_id === "u1");
    expect(emp.shift_hours).toBe(6);
    expect(emp.problem_shifts).toBe(2);
    expect(emp.problem_deduction_hours).toBe(2);
    expect(emp.effective_hours).toBe(4);
  });

  test("problem deduction does not go below 0", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "11:00", user_id: "u1", reason: "auto" }, // 1h
    ]);
    const facts = [
      makeFact("SHIFT_MARKED_PROBLEM", "admin1", { dow: "mon", from: "10:00", to: "11:00" }),
      // Extra PROBLEM_SHIFT would push below 0
      makeFact("PROBLEM_SHIFT", "admin1", { dow: "mon", from: "10:00", to: "11:00", user_id: "u1" }),
    ];
    const hourlyRates = { u1: 280 };
    const result = buildTimesheet({ facts, weekStartISO: WEEK_START, hourlyRates, schedule });

    const emp = result.employees.find((e) => e.user_id === "u1");
    expect(emp.effective_hours).toBe(0); // not negative
    expect(emp.shift_pay).toBe(0);
  });

  test("cleaning: counted and paid at 500₽ each", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const facts = [
      makeFact("CLEANING_DONE", "u1", { dow: "mon" }),
      makeFact("CLEANING_DONE", "u1", { dow: "wed" }),
    ];
    const hourlyRates = { u1: 280 };
    const result = buildTimesheet({ facts, weekStartISO: WEEK_START, hourlyRates, schedule });

    const emp = result.employees.find((e) => e.user_id === "u1");
    expect(emp.cleaning_count).toBe(2);
    expect(emp.cleaning_pay).toBe(1000);
    expect(emp.total_before_rounding).toBe(840 + 1000); // 1840
    expect(emp.total_pay).toBe(1900); // ceil(1840/100)*100
  });

  test("extra classes: counted with hours and paid at 300₽/h", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const facts = [
      makeFact("EXTRA_CLASS", "u1", { dow: "mon", from: "14:00", to: "16:00" }),
    ];
    const hourlyRates = { u1: 280 };
    const result = buildTimesheet({ facts, weekStartISO: WEEK_START, hourlyRates, schedule });

    const emp = result.employees.find((e) => e.user_id === "u1");
    expect(emp.extra_classes).toBe(1);
    expect(emp.extra_hours).toBe(2);
    expect(emp.extra_pay).toBe(600); // 2 * 300
    expect(emp.total_before_rounding).toBe(840 + 600); // 1440
    expect(emp.total_pay).toBe(1500); // ceil(1440/100)*100
  });

  test("combined: shift + cleaning + extras → rounded total", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const facts = [
      makeFact("CLEANING_DONE", "u1", { dow: "mon" }),
      makeFact("EXTRA_CLASS", "u1", { dow: "tue", from: "14:00", to: "15:00" }),
    ];
    const hourlyRates = { u1: 280 };
    const result = buildTimesheet({ facts, weekStartISO: WEEK_START, hourlyRates, schedule });

    const emp = result.employees.find((e) => e.user_id === "u1");
    // shift: 3 * 280 = 840, cleaning: 500, extra: 1 * 300 = 300
    expect(emp.total_before_rounding).toBe(840 + 500 + 300); // 1640
    expect(emp.total_pay).toBe(1700); // ceil(1640/100)*100
  });

  test("empty input → zero timesheet", () => {
    const result = buildTimesheet({
      facts: [],
      weekStartISO: WEEK_START,
      hourlyRates: {},
      schedule: makeSchedule([]),
    });
    expect(result.employees).toEqual([]);
    expect(result.totals.total_hours).toBe(0);
    expect(result.totals.total_pay).toBe(0);
  });

  test("multiple employees → each gets own row, sorted by user_id", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "18:00", to: "21:00", user_id: "u2", reason: "auto" },
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const hourlyRates = { u1: 280, u2: 280 };
    const result = buildTimesheet({ facts: [], weekStartISO: WEEK_START, hourlyRates, schedule });
    expect(result.employees).toHaveLength(2);
    expect(result.employees[0].user_id).toBe("u1");
    expect(result.employees[1].user_id).toBe("u2");
  });

  test("rounding: exact multiple stays, non-exact rounds up", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "15:00", user_id: "u1", reason: "auto" }, // 5h
    ]);
    const hourlyRates = { u1: 200 };
    const result = buildTimesheet({ facts: [], weekStartISO: WEEK_START, hourlyRates, schedule });

    const emp = result.employees.find((e) => e.user_id === "u1");
    // 5 * 200 = 1000 → exact → 1000
    expect(emp.total_pay).toBe(1000);
  });

  test("rounding: non-exact rounds up to next hundred", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "12:00", user_id: "u1", reason: "auto" }, // 2h
    ]);
    const hourlyRates = { u1: 280 };
    const result = buildTimesheet({ facts: [], weekStartISO: WEEK_START, hourlyRates, schedule });

    const emp = result.employees.find((e) => e.user_id === "u1");
    // 2 * 280 = 560 → ceil(5.6)*100 = 600
    expect(emp.total_pay).toBe(600);
  });

  test("totals: sum of employee values", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
      { dow: "mon", from: "18:00", to: "21:00", user_id: "u2", reason: "auto" },
    ]);
    const facts = [makeFact("CLEANING_DONE", "u1", { dow: "mon" })];
    const hourlyRates = { u1: 280, u2: 280 };
    const result = buildTimesheet({ facts, weekStartISO: WEEK_START, hourlyRates, schedule });

    const expectedTotalHours = result.employees.reduce((s, e) => s + e.effective_hours, 0);
    const expectedTotalPay = result.employees.reduce((s, e) => s + e.total_pay, 0);
    const expectedTotalCleanings = result.employees.reduce((s, e) => s + e.cleaning_count, 0);
    expect(result.totals.total_hours).toBe(expectedTotalHours);
    expect(result.totals.total_pay).toBe(expectedTotalPay);
    expect(result.totals.total_cleanings).toBe(expectedTotalCleanings);
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

  test("user with only cleaning facts appears in timesheet", () => {
    const schedule = makeSchedule([]);
    const facts = [makeFact("CLEANING_DONE", "u3", { dow: "fri" })];
    const hourlyRates = {};
    const result = buildTimesheet({ facts, weekStartISO: WEEK_START, hourlyRates, schedule });
    const emp = result.employees.find((e) => e.user_id === "u3");
    expect(emp).toBeDefined();
    expect(emp.cleaning_count).toBe(1);
    expect(emp.cleaning_pay).toBe(500);
    expect(emp.shift_hours).toBe(0);
    expect(emp.total_pay).toBe(500); // exact multiple
  });

  test("rate from hourlyRates is correctly applied", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const hourlyRates = { u1: 350 };
    const result = buildTimesheet({ facts: [], weekStartISO: WEEK_START, hourlyRates, schedule });
    const emp = result.employees.find((e) => e.user_id === "u1");
    expect(emp.rate).toBe(350);
    expect(emp.shift_pay).toBe(3 * 350); // 1050
    expect(emp.total_pay).toBe(1100); // ceil(1050/100)*100
  });

  test("employee name is included from UserDirectory", () => {
    const schedule = makeSchedule([
      { dow: "mon", from: "10:00", to: "13:00", user_id: "u1", reason: "auto" },
    ]);
    const hourlyRates = { u1: 280 };
    const result = buildTimesheet({ facts: [], weekStartISO: WEEK_START, hourlyRates, schedule });
    const emp = result.employees.find((e) => e.user_id === "u1");
    expect(emp.name).toBe("Иса");
  });
});
