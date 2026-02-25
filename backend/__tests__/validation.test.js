import {
  IngestSchema,
  DebugSendSchema,
  ScheduleQuerySchema,
  FactsQuerySchema,
  EventsQuerySchema,
  ParseEventParamsSchema,
} from "../validation/schemas.js";
import { validateBody, validateQuery, validateParams } from "../middleware/validate.js";

describe("Zod validation schemas", () => {
  describe("IngestSchema", () => {
    test("valid payload passes", () => {
      const result = IngestSchema.safeParse({
        chat_id: "chat_123",
        user_id: "u1",
        text: "AVAIL mon 10-13",
      });
      expect(result.success).toBe(true);
    });

    test("empty text → validation error", () => {
      const result = IngestSchema.safeParse({
        chat_id: "chat_123",
        user_id: "u1",
        text: "",
      });
      expect(result.success).toBe(false);
    });

    test("invalid ts is not checked (ts is optional string)", () => {
      const result = IngestSchema.safeParse({
        chat_id: "chat_123",
        user_id: "u1",
        text: "hello",
        ts: "not-an-iso-date",
      });
      // ts is just z.string().optional(), so any string passes
      expect(result.success).toBe(true);
    });

    test("too long text (>5000) → validation error", () => {
      const result = IngestSchema.safeParse({
        chat_id: "chat_123",
        user_id: "u1",
        text: "x".repeat(5001),
      });
      expect(result.success).toBe(false);
    });

    test("missing required field chat_id → validation error", () => {
      const result = IngestSchema.safeParse({
        user_id: "u1",
        text: "hello",
      });
      expect(result.success).toBe(false);
    });

    test("missing required field user_id → validation error", () => {
      const result = IngestSchema.safeParse({
        chat_id: "chat_123",
        text: "hello",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ScheduleQuerySchema", () => {
    test("valid query passes", () => {
      const result = ScheduleQuerySchema.safeParse({
        chat_id: "chat_123",
        week_start: "2025-01-06",
      });
      expect(result.success).toBe(true);
    });

    test("invalid week_start format → error", () => {
      const result = ScheduleQuerySchema.safeParse({
        chat_id: "chat_123",
        week_start: "2025/01/06",
      });
      expect(result.success).toBe(false);
    });

    test("missing chat_id → error", () => {
      const result = ScheduleQuerySchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("validateBody middleware", () => {
    function mockReqRes(body) {
      const req = { body };
      const res = {
        _status: null,
        _json: null,
        status(code) { this._status = code; return this; },
        json(data) { this._json = data; return this; },
      };
      return { req, res };
    }

    test("valid body → calls next()", () => {
      const middleware = validateBody(IngestSchema);
      const { req, res } = mockReqRes({ chat_id: "c1", user_id: "u1", text: "hello" });
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    });

    test("invalid body → returns 400", () => {
      const middleware = validateBody(IngestSchema);
      const { req, res } = mockReqRes({ chat_id: "c1" }); // missing user_id, text
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(false);
      expect(res._status).toBe(400);
      expect(res._json.error).toBe("Validation error");
    });
  });

  describe("validateQuery middleware", () => {
    test("valid query → calls next()", () => {
      const middleware = validateQuery(ScheduleQuerySchema);
      const req = { query: { chat_id: "c1" } };
      const res = { status() { return this; }, json() { return this; } };
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    });

    test("invalid query → returns 400", () => {
      const middleware = validateQuery(ScheduleQuerySchema);
      const req = { query: {} }; // missing chat_id
      const res = {
        _status: null,
        _json: null,
        status(code) { this._status = code; return this; },
        json(data) { this._json = data; return this; },
      };
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(false);
      expect(res._status).toBe(400);
    });
  });

  describe("validateParams middleware", () => {
    test("valid params → calls next()", () => {
      // ParseEventParamsSchema imported at top
      const middleware = validateParams(ParseEventParamsSchema);
      const req = { params: { eventId: "42" } };
      const res = { status() { return this; }, json() { return this; } };
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    });

    test("invalid params → returns 400", () => {
      // ParseEventParamsSchema imported at top
      const middleware = validateParams(ParseEventParamsSchema);
      const req = { params: { eventId: "not-a-number" } };
      const res = {
        _status: null,
        _json: null,
        status(code) { this._status = code; return this; },
        json(data) { this._json = data; return this; },
      };
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(false);
      expect(res._status).toBe(400);
    });
  });
});
