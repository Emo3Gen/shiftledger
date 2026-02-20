import { parseEventToFacts } from "../factsParserV0.js";

// Fixed receivedAt for deterministic date calculations
const RECEIVED_AT = "2025-01-06T12:00:00Z"; // Monday

describe("factsParserV0", () => {
  // --- DSL Commands ---

  describe("DSL: AVAIL command", () => {
    test("AVAIL mon 10-13 → SHIFT_AVAILABILITY with dow=mon, from=10:00, to=13:00, availability=can", () => {
      const facts = parseEventToFacts({ text: "AVAIL mon 10-13", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("SHIFT_AVAILABILITY");
      expect(facts[0].fact_payload.dow).toBe("mon");
      expect(facts[0].fact_payload.from).toBe("10:00");
      expect(facts[0].fact_payload.to).toBe("13:00");
      expect(facts[0].fact_payload.availability).toBe("can");
      expect(facts[0].confidence).toBe(1.0);
    });

    test("AVAIL fri 18-21 → correct day and time", () => {
      const facts = parseEventToFacts({ text: "AVAIL fri 18-21", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_payload.dow).toBe("fri");
      expect(facts[0].fact_payload.from).toBe("18:00");
      expect(facts[0].fact_payload.to).toBe("21:00");
    });
  });

  describe("DSL: CANT command", () => {
    test("CANT thu 18-21 → SHIFT_UNAVAILABILITY", () => {
      const facts = parseEventToFacts({ text: "CANT thu 18-21", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("SHIFT_UNAVAILABILITY");
      expect(facts[0].fact_payload.dow).toBe("thu");
      expect(facts[0].fact_payload.from).toBe("18:00");
      expect(facts[0].fact_payload.to).toBe("21:00");
      expect(facts[0].fact_payload.availability).toBe("cannot");
    });
  });

  describe("DSL: SWAP command", () => {
    test("SWAP mon 10-13 WITH isa → SHIFT_SWAP_REQUEST with target_user_id=isa", () => {
      const facts = parseEventToFacts({ text: "SWAP mon 10-13 WITH isa", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("SHIFT_SWAP_REQUEST");
      expect(facts[0].fact_payload.target_user_id).toBe("isa");
      expect(facts[0].fact_payload.from.dow).toBe("mon");
      expect(facts[0].fact_payload.from.from).toBe("10:00");
      expect(facts[0].fact_payload.from.to).toBe("13:00");
    });
  });

  describe("DSL: GAP command", () => {
    test("GAP thu 18-21 → SHIFT_GAP", () => {
      const facts = parseEventToFacts({ text: "GAP thu 18-21", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("SHIFT_GAP");
      expect(facts[0].fact_payload.dow).toBe("thu");
      expect(facts[0].fact_payload.from).toBe("18:00");
      expect(facts[0].fact_payload.to).toBe("21:00");
    });
  });

  describe("DSL: LOCK command", () => {
    test("LOCK → WEEK_LOCK", () => {
      const facts = parseEventToFacts({ text: "LOCK", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("WEEK_LOCK");
    });

    test("LOCK 2025-01-06 → WEEK_LOCK with week_start", () => {
      const facts = parseEventToFacts({ text: "LOCK 2025-01-06", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("WEEK_LOCK");
      expect(facts[0].fact_payload.week_start).toBe("2025-01-06");
    });
  });

  describe("DSL: ASSIGN command", () => {
    test("ASSIGN mon 10-13 isa → SHIFT_ASSIGNMENT", () => {
      const facts = parseEventToFacts({ text: "ASSIGN mon 10-13 isa", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("SHIFT_ASSIGNMENT");
      expect(facts[0].fact_payload.dow).toBe("mon");
      expect(facts[0].fact_payload.from).toBe("10:00");
      expect(facts[0].fact_payload.to).toBe("13:00");
      expect(facts[0].fact_payload.assigned_user_id).toBe("isa");
    });
  });

  describe("DSL: CONFIRM command", () => {
    test("CONFIRM → WEEK_CONFIRM", () => {
      const facts = parseEventToFacts({ text: "CONFIRM", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("WEEK_CONFIRM");
    });
  });

  describe("DSL: invalid and empty input", () => {
    test("invalid command AVAIL xyz 99-100 → empty array", () => {
      const facts = parseEventToFacts({ text: "AVAIL xyz 99-100", received_at: RECEIVED_AT });
      expect(facts).toEqual([]);
    });

    test("empty string → empty array", () => {
      const facts = parseEventToFacts({ text: "", received_at: RECEIVED_AT });
      expect(facts).toEqual([]);
    });

    test("whitespace only → empty array", () => {
      const facts = parseEventToFacts({ text: "   ", received_at: RECEIVED_AT });
      expect(facts).toEqual([]);
    });
  });

  // --- NL Russian parsing ---

  describe("NL: Russian availability", () => {
    test("'Могу утро' with day context → SHIFT_AVAILABILITY can", () => {
      const facts = parseEventToFacts({ text: "Пн утро могу", received_at: RECEIVED_AT });
      // Should detect "могу" + "утро"
      const avail = facts.find((f) => f.fact_type === "SHIFT_AVAILABILITY");
      expect(avail).toBeDefined();
      expect(avail.fact_payload.availability).toBe("can");
      expect(avail.fact_payload.shift).toBe("morning");
    });

    test("'В четверг вечером не смогу' → SHIFT_AVAILABILITY cannot", () => {
      const facts = parseEventToFacts({
        text: "В четверг вечером не могу",
        received_at: RECEIVED_AT,
      });
      const avail = facts.find((f) => f.fact_type === "SHIFT_AVAILABILITY");
      expect(avail).toBeDefined();
      expect(avail.fact_payload.availability).toBe("cannot");
      expect(avail.fact_payload.shift).toBe("evening");
    });

    test("'Могу в среду с 14 до 17' → SHIFT_AVAILABILITY with time_window", () => {
      const facts = parseEventToFacts({
        text: "Могу в среду утро с 14 до 17",
        received_at: RECEIVED_AT,
      });
      const avail = facts.find((f) => f.fact_type === "SHIFT_AVAILABILITY");
      expect(avail).toBeDefined();
      expect(avail.fact_payload.availability).toBe("can");
      expect(avail.fact_payload.time_window).toEqual({ from: "14:00", to: "17:00" });
    });

    test("'Не могу в пятницу вечер' → SHIFT_AVAILABILITY cannot", () => {
      const facts = parseEventToFacts({
        text: "Не могу в пятницу вечер",
        received_at: RECEIVED_AT,
      });
      const avail = facts.find((f) => f.fact_type === "SHIFT_AVAILABILITY");
      expect(avail).toBeDefined();
      expect(avail.fact_payload.availability).toBe("cannot");
    });

    test("non-scheduling text 'Привет, как дела?' → empty array", () => {
      const facts = parseEventToFacts({
        text: "Привет, как дела?",
        received_at: RECEIVED_AT,
      });
      expect(facts).toEqual([]);
    });
  });

  // --- fact_hash determinism ---

  describe("fact_hash / determinism", () => {
    test("same input → same result (deterministic)", () => {
      const event = { text: "AVAIL mon 10-13", received_at: RECEIVED_AT };
      const facts1 = parseEventToFacts(event);
      const facts2 = parseEventToFacts(event);
      expect(facts1).toEqual(facts2);
    });

    test("different input → different result", () => {
      const facts1 = parseEventToFacts({ text: "AVAIL mon 10-13", received_at: RECEIVED_AT });
      const facts2 = parseEventToFacts({ text: "AVAIL tue 18-21", received_at: RECEIVED_AT });
      expect(facts1).not.toEqual(facts2);
      expect(facts1[0].fact_payload.dow).not.toBe(facts2[0].fact_payload.dow);
    });
  });

  // --- Additional DSL commands ---

  describe("DSL: WORKED command", () => {
    test("WORKED 2025-01-06 mon 10-13 → SHIFT_WORKED", () => {
      const facts = parseEventToFacts({ text: "WORKED 2025-01-06 mon 10-13", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("SHIFT_WORKED");
      expect(facts[0].fact_payload.week_start).toBe("2025-01-06");
      expect(facts[0].fact_payload.dow).toBe("mon");
    });
  });

  describe("DSL: NO_SHOW command", () => {
    test("NO_SHOW mon 10-13 → SHIFT_NO_SHOW", () => {
      const facts = parseEventToFacts({ text: "NO_SHOW mon 10-13", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("SHIFT_NO_SHOW");
      expect(facts[0].fact_payload.dow).toBe("mon");
    });

    test("NO_SHOW with week_start → includes week_start", () => {
      const facts = parseEventToFacts({ text: "NO_SHOW 2025-01-06 tue 18-21", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("SHIFT_NO_SHOW");
      expect(facts[0].fact_payload.week_start).toBe("2025-01-06");
    });
  });

  describe("DSL: CONFIRM_SCHEDULE command", () => {
    test("CONFIRM_SCHEDULE → SCHEDULE_CONFIRMED", () => {
      const facts = parseEventToFacts({ text: "CONFIRM_SCHEDULE", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("SCHEDULE_CONFIRMED");
    });

    test("CONFIRM_SCHEDULE 2025-01-06 → with week_start", () => {
      const facts = parseEventToFacts({ text: "CONFIRM_SCHEDULE 2025-01-06", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_payload.week_start).toBe("2025-01-06");
    });
  });

  describe("DSL: REPORT_PROBLEM command", () => {
    test("REPORT_PROBLEM 2025-01-06 some issue → SCHEDULE_PROBLEM", () => {
      const facts = parseEventToFacts({ text: "REPORT_PROBLEM 2025-01-06 some issue", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("SCHEDULE_PROBLEM");
      expect(facts[0].fact_payload.week_start).toBe("2025-01-06");
      // message is uppercased because regex runs on upper string
      expect(facts[0].fact_payload.problem_message).toBe("SOME ISSUE");
    });
  });

  describe("DSL: MARK_SHIFT_PROBLEM command", () => {
    test("MARK_SHIFT_PROBLEM 2025-01-06 mon 10-13 → SHIFT_MARKED_PROBLEM", () => {
      const facts = parseEventToFacts({ text: "MARK_SHIFT_PROBLEM 2025-01-06 mon 10-13", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("SHIFT_MARKED_PROBLEM");
      expect(facts[0].fact_payload.dow).toBe("mon");
      expect(facts[0].fact_payload.week_start).toBe("2025-01-06");
    });
  });

  describe("DSL: CONFIRM_SHIFT_FACT command", () => {
    test("CONFIRM_SHIFT_FACT 2025-01-06 mon 10-13 ok → SHIFT_FACT_CONFIRMED status=ok", () => {
      const facts = parseEventToFacts({ text: "CONFIRM_SHIFT_FACT 2025-01-06 mon 10-13 ok", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("SHIFT_FACT_CONFIRMED");
      expect(facts[0].fact_payload.status).toBe("ok");
    });

    test("CONFIRM_SHIFT_FACT mon 10-13 problem late → status=problem, reason=late", () => {
      const facts = parseEventToFacts({ text: "CONFIRM_SHIFT_FACT mon 10-13 problem late", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_payload.status).toBe("problem");
      expect(facts[0].fact_payload.reason).toBe("late");
    });
  });

  describe("DSL: OPEN_WEEK command", () => {
    test("OPEN_WEEK 2025-01-06 → WEEK_OPEN", () => {
      const facts = parseEventToFacts({ text: "OPEN_WEEK 2025-01-06", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("WEEK_OPEN");
      expect(facts[0].fact_payload.week_start).toBe("2025-01-06");
    });
  });

  describe("DSL: PROPOSE command", () => {
    test("PROPOSE → WEEK_PROPOSE", () => {
      const facts = parseEventToFacts({ text: "PROPOSE", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("WEEK_PROPOSE");
    });
  });

  describe("DSL: DECLARE_GAP command", () => {
    test("DECLARE_GAP 2025-01-06 mon 10-13 → SHIFT_GAP with week_start", () => {
      const facts = parseEventToFacts({ text: "DECLARE_GAP 2025-01-06 mon 10-13", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("SHIFT_GAP");
      expect(facts[0].fact_payload.week_start).toBe("2025-01-06");
    });

    test("DECLARE_GAP mon 10-13 (no week_start) → SHIFT_GAP", () => {
      const facts = parseEventToFacts({ text: "DECLARE_GAP mon 10-13", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("SHIFT_GAP");
    });
  });

  describe("DSL: ASSIGN with week_start", () => {
    test("ASSIGN 2025-01-06 mon 10-13 isa → SHIFT_ASSIGNMENT with week_start", () => {
      const facts = parseEventToFacts({ text: "ASSIGN 2025-01-06 mon 10-13 isa", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("SHIFT_ASSIGNMENT");
      expect(facts[0].fact_payload.week_start).toBe("2025-01-06");
      expect(facts[0].fact_payload.assigned_user_id).toBe("isa");
    });
  });

  describe("DSL: APPROVE_OVERTIME command", () => {
    test("APPROVE_OVERTIME mon 10-13 → OWNER_APPROVAL", () => {
      const facts = parseEventToFacts({ text: "APPROVE_OVERTIME mon 10-13", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("OWNER_APPROVAL");
      expect(facts[0].fact_payload.type).toBe("overtime");
    });

    test("APPROVE_OVERTIME 2025-01-06 tue 18-21 → with week_start", () => {
      const facts = parseEventToFacts({ text: "APPROVE_OVERTIME 2025-01-06 tue 18-21", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_payload.week_start).toBe("2025-01-06");
    });
  });

  describe("DSL: CONFIRM_TIMESHEET command", () => {
    test("CONFIRM_TIMESHEET 2025-01-06 → TIMESHEET_CONFIRMED", () => {
      const facts = parseEventToFacts({ text: "CONFIRM_TIMESHEET 2025-01-06", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("TIMESHEET_CONFIRMED");
      expect(facts[0].fact_payload.week_start).toBe("2025-01-06");
    });
  });

  describe("NL: cleaning done", () => {
    test("'уборку сделала' → CLEANING_DONE", () => {
      const facts = parseEventToFacts({ text: "уборку сделала", received_at: RECEIVED_AT });
      const cleaning = facts.find((f) => f.fact_type === "CLEANING_DONE");
      expect(cleaning).toBeDefined();
    });
  });

  describe("NL: swap request", () => {
    test("'поменяй пн утро на ср вечер' → SHIFT_SWAP_REQUEST", () => {
      const facts = parseEventToFacts({ text: "поменяй пн утро на ср вечер", received_at: RECEIVED_AT });
      const swap = facts.find((f) => f.fact_type === "SHIFT_SWAP_REQUEST");
      expect(swap).toBeDefined();
      expect(swap.fact_payload.from.shift).toBe("morning");
      expect(swap.fact_payload.to.shift).toBe("evening");
    });
  });

  describe("DSL: WORKED without week_start", () => {
    test("WORKED mon 10-13 → SHIFT_WORKED without week_start", () => {
      const facts = parseEventToFacts({ text: "WORKED mon 10-13", received_at: RECEIVED_AT });
      expect(facts).toHaveLength(1);
      expect(facts[0].fact_type).toBe("SHIFT_WORKED");
      expect(facts[0].fact_payload.week_start).toBeNull();
    });
  });
});
