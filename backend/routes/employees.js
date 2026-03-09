/**
 * CRUD routes for /api/employees
 */

import { Router } from "express";
import { z } from "zod";
import { validateBody, validateParams } from "../middleware/validate.js";
import * as employeeService from "../employeeService.js";
import logger from "../logger.js";

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
  telegram_user_id: z.string().max(50).optional(),
  telegram_username: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  auto_schedule: z.boolean().default(true).optional(),
  branch: z.string().max(100).default("Архангельск").optional(),
  skill_level: z.enum(["beginner", "experienced", "guru"]).default("beginner").optional(),
  meta: z.record(z.unknown()).optional(),
});

const UpdateEmployeeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  role: z.string().min(1).max(50).optional(),
  rate_per_hour: z.number().min(0).optional(),
  min_hours_per_week: z.number().min(0).optional(),
  max_hours_per_week: z.number().min(0).optional(),
  is_active: z.boolean().optional(),
  telegram_user_id: z.string().max(50).nullable().optional(),
  telegram_username: z.string().max(100).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  auto_schedule: z.boolean().optional(),
  branch: z.string().max(100).nullable().optional(),
  skill_level: z.enum(["beginner", "experienced", "guru"]).nullable().optional(),
  meta: z.record(z.unknown()).nullable().optional(),
});

// --- Routes ---

/**
 * @openapi
 * /api/employees:
 *   get:
 *     summary: List active employees
 *     tags: [Employees]
 *     responses:
 *       200:
 *         description: Array of active employees
 */
router.get("/", async (req, res) => {
  try {
    const employees = await employeeService.getAll();
    res.json({ ok: true, employees });
  } catch (err) {
    logger.error({ err }, "EMPLOYEES getAll error");
    res.status(500).json({ ok: false, error: "failed to load employees" });
  }
});

/**
 * @openapi
 * /api/employees/{id}:
 *   get:
 *     summary: Get employee by ID
 *     tags: [Employees]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Employee object
 *       404:
 *         description: Not found
 */
router.get("/:id", validateParams(EmployeeIdParamsSchema), async (req, res) => {
  try {
    const employee = await employeeService.getById(req.params.id);
    if (!employee) {
      return res.status(404).json({ ok: false, error: "employee not found" });
    }
    res.json({ ok: true, employee });
  } catch (err) {
    logger.error({ err }, "EMPLOYEES getById error");
    res.status(500).json({ ok: false, error: "failed to load employee" });
  }
});

/**
 * @openapi
 * /api/employees:
 *   post:
 *     summary: Create a new employee
 *     tags: [Employees]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, name]
 *             properties:
 *               id: { type: string }
 *               name: { type: string }
 *               role: { type: string, default: staff }
 *               rate_per_hour: { type: number, default: 0 }
 *               min_hours_per_week: { type: number, default: 0 }
 *               max_hours_per_week: { type: number, default: 40 }
 *     responses:
 *       201:
 *         description: Employee created
 *       409:
 *         description: Duplicate ID
 */
router.post("/", validateBody(CreateEmployeeSchema), async (req, res) => {
  try {
    const employee = await employeeService.create(req.body);
    res.status(201).json({ ok: true, employee });
  } catch (err) {
    logger.error({ err }, "EMPLOYEES create error");
    if (err.message?.includes("duplicate") || err.code === "23505") {
      return res.status(409).json({ ok: false, error: "employee with this id already exists" });
    }
    res.status(500).json({ ok: false, error: "failed to create employee" });
  }
});

/**
 * @openapi
 * /api/employees/{id}:
 *   put:
 *     summary: Update an employee
 *     tags: [Employees]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               role: { type: string }
 *               rate_per_hour: { type: number }
 *               is_active: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated employee
 */
router.put("/:id", validateParams(EmployeeIdParamsSchema), validateBody(UpdateEmployeeSchema), async (req, res) => {
  try {
    const employee = await employeeService.update(req.params.id, req.body);
    res.json({ ok: true, employee });
  } catch (err) {
    logger.error({ err }, "EMPLOYEES update error");
    res.status(500).json({ ok: false, error: "failed to update employee" });
  }
});

/**
 * @openapi
 * /api/employees/{id}:
 *   delete:
 *     summary: Deactivate (soft-delete) an employee
 *     tags: [Employees]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deactivated employee
 */
router.delete("/:id", validateParams(EmployeeIdParamsSchema), async (req, res) => {
  try {
    const employee = await employeeService.deactivate(req.params.id);
    res.json({ ok: true, employee });
  } catch (err) {
    logger.error({ err }, "EMPLOYEES deactivate error");
    res.status(500).json({ ok: false, error: "failed to deactivate employee" });
  }
});

export default router;
