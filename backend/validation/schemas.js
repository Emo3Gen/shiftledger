/**
 * Zod validation schemas for all API endpoints.
 */

import { z } from "zod";

// --- POST /ingest ---
export const IngestSchema = z.object({
  source: z.string().min(1).max(50).optional(),
  tenant_id: z.string().min(1).max(100).optional(),
  channel: z.string().min(1).max(50).optional(),
  chat_id: z.string().min(1).max(200),
  user_id: z.string().min(1).max(200),
  message_id: z.string().optional(),
  ts: z.string().optional(),
  text: z.string().min(1).max(5000),
  meta: z.record(z.unknown()).optional(),
});

// --- POST /debug/send ---
export const DebugSendSchema = z.object({
  tenant_id: z.string().min(1).max(100).optional(),
  source: z.string().min(1).max(50).default("emu"),
  channel: z.string().min(1).max(50).optional(),
  chat_id: z.string().min(1).max(200),
  user_id: z.string().min(1).max(200),
  message_id: z.string().optional(),
  trace_id: z.string().optional(),
  ts: z.string().optional(),
  text: z.string().min(1).max(5000),
  meta: z.record(z.unknown()).optional(),
});

// --- POST /parse/:eventId ---
export const ParseEventParamsSchema = z.object({
  eventId: z.coerce.number().int().positive(),
});

// --- GET /debug/schedule, /debug/week_state, /debug/timesheet ---
export const ScheduleQuerySchema = z.object({
  tenant_id: z.string().min(1).optional(),
  chat_id: z.string().min(1),
  week_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
    .optional(),
});

// --- POST /debug/build-schedule ---
export const BuildScheduleSchema = z.object({
  chat_id: z.string().min(1).max(200),
  user_id: z.string().min(1).max(200),
  week_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
    .optional(),
});

// --- POST /api/week/:weekStartISO/confirm-user ---
export const ConfirmUserParamsSchema = z.object({
  weekStartISO: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
});

export const ConfirmUserBodySchema = z.object({
  user_id: z.string().min(1).max(200),
  chat_id: z.string().min(1).max(200),
});

// --- GET /facts ---
export const FactsQuerySchema = z.object({
  chat_id: z.string().min(1).optional(),
  user_id: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// --- GET /events ---
export const EventsQuerySchema = z.object({
  chat_id: z.string().min(1).optional(),
  trace_id: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// --- GET /debug/dialogs ---
export const DialogsQuerySchema = z.object({
  tenant_id: z.string().min(1).optional(),
});

// --- GET /debug/dialog/:chat_id ---
export const DialogParamsSchema = z.object({
  chat_id: z.string().min(1),
});

export const DialogQuerySchema = z.object({
  tenant_id: z.string().min(1).optional(),
});
