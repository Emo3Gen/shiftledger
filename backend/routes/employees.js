/**
 * CRUD routes for /api/employees
 */

import { Router } from "express";
import { z } from "zod";
import { validateBody, validateParams } from "../middleware/validate.js";
import * as employeeService from "../employeeService.js";

const router = Router();

// --- Zod schemas ---

const EmployeeIdParamsSchema = z.object({
  id: z.string().min(1).max(100),
});

const CreateEmployeeSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  role: z.string().min(1).max(50).default("staff"),
  rate_per_hour: z.number().min(0).default(0),
  min_hours_per_week: z.number().min(0).default(0),
  max_hours_per_week: z.number().min(0).default(40),
  meta: z.record(z.unknown()).optional(),
});

const UpdateEmployeeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  role: z.string().min(1).max(50).optional(),
  rate_per_hour: z.number().min(0).optional(),
  min_hours_per_week: z.number().min(0).optional(),
  max_hours_per_week: z.number().min(0).optional(),
  is_active: z.boolean().optional(),
  meta: z.record(z.unknown()).optional(),
});

// --- Routes ---

// GET /api/employees — list active employees
router.get("/", async (req, res) => {
  try {
    const employees = await employeeService.getAll();
    res.json({ ok: true, employees });
  } catch (err) {
    console.error("[EMPLOYEES] getAll error:", err);
    res.status(500).json({ ok: false, error: "failed to load employees" });
  }
});

// GET /api/employees/:id — get one employee
router.get("/:id", validateParams(EmployeeIdParamsSchema), async (req, res) => {
  try {
    const employee = await employeeService.getById(req.params.id);
    if (!employee) {
      return res.status(404).json({ ok: false, error: "employee not found" });
    }
    res.json({ ok: true, employee });
  } catch (err) {
    console.error("[EMPLOYEES] getById error:", err);
    res.status(500).json({ ok: false, error: "failed to load employee" });
  }
});

// POST /api/employees — create employee
router.post("/", validateBody(CreateEmployeeSchema), async (req, res) => {
  try {
    const employee = await employeeService.create(req.body);
    res.status(201).json({ ok: true, employee });
  } catch (err) {
    console.error("[EMPLOYEES] create error:", err);
    if (err.message?.includes("duplicate") || err.code === "23505") {
      return res.status(409).json({ ok: false, error: "employee with this id already exists" });
    }
    res.status(500).json({ ok: false, error: "failed to create employee" });
  }
});

// PUT /api/employees/:id — update employee
router.put("/:id", validateParams(EmployeeIdParamsSchema), validateBody(UpdateEmployeeSchema), async (req, res) => {
  try {
    const employee = await employeeService.update(req.params.id, req.body);
    res.json({ ok: true, employee });
  } catch (err) {
    console.error("[EMPLOYEES] update error:", err);
    res.status(500).json({ ok: false, error: "failed to update employee" });
  }
});

// DELETE /api/employees/:id — soft delete (deactivate)
router.delete("/:id", validateParams(EmployeeIdParamsSchema), async (req, res) => {
  try {
    const employee = await employeeService.deactivate(req.params.id);
    res.json({ ok: true, employee });
  } catch (err) {
    console.error("[EMPLOYEES] deactivate error:", err);
    res.status(500).json({ ok: false, error: "failed to deactivate employee" });
  }
});

export default router;
