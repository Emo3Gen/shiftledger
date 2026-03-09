/**
 * Employee Service
 *
 * CRUD operations for employees table.
 * Falls back to in-memory userDirectory if Supabase is unavailable.
 */

import { supabase } from "./supabaseClient.js";
import { UserDirectory } from "./userDirectory.js";
import logger from "./logger.js";

/**
 * Convert UserDirectory entry to employee format (for fallback).
 */
function userToEmployee(id, user) {
  return {
    id: user.id,
    name: user.displayName,
    role: user.role,
    rate_per_hour: user.ratePerHour,
    min_hours_per_week: user.minHours || 0,
    max_hours_per_week: 40,
    is_active: true,
    auto_schedule: user.autoSchedule !== false,
    branch: user.branch || "Архангельск",
    meta: {},
    created_at: null,
    updated_at: null,
  };
}

/**
 * Expose skill_level from meta as a top-level field.
 */
function enrichEmployee(row) {
  if (!row) return row;
  return {
    ...row,
    skill_level: row.meta?.skill_level || "beginner",
  };
}

/**
 * Get all active employees.
 */
export async function getAll() {
  try {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("is_active", true)
      .order("id");

    if (error) throw error;
    return data.map(enrichEmployee);
  } catch (err) {
    logger.warn({ err }, "employeeService getAll fallback to UserDirectory");
    // Fallback: return from UserDirectory (only canonical entries u1-u4)
    const result = [];
    const seen = new Set();
    for (const [key, user] of UserDirectory.users.entries()) {
      if (user.id.startsWith("u") && !seen.has(user.id)) {
        seen.add(user.id);
        result.push(userToEmployee(key, user));
      }
    }
    return result;
  }
}

/**
 * Get employee by ID.
 */
export async function getById(id) {
  try {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw error;
    return enrichEmployee(data);
  } catch (err) {
    logger.warn({ err }, "employeeService getById fallback");
    const user = UserDirectory.getUser(id);
    if (!user) return null;
    return userToEmployee(id, user);
  }
}

/**
 * Create a new employee.
 */
export async function create(employee) {
  const meta = { ...(employee.meta || {}) };
  if (employee.skill_level) meta.skill_level = employee.skill_level;
  const row = {
    id: employee.id,
    name: employee.name,
    role: employee.role || "staff",
    rate_per_hour: employee.rate_per_hour || 0,
    min_hours_per_week: employee.min_hours_per_week || 0,
    max_hours_per_week: employee.max_hours_per_week || 40,
    is_active: true,
    auto_schedule: employee.auto_schedule ?? true,
    branch: employee.branch ?? "Архангельск",
    meta,
  };
  if (employee.telegram_user_id) row.telegram_user_id = employee.telegram_user_id;
  if (employee.telegram_username) row.telegram_username = employee.telegram_username;
  if (employee.phone) row.phone = employee.phone;

  const { data, error } = await supabase
    .from("employees")
    .insert(row)
    .select("*")
    .single();

  if (error) throw error;

  // Sync new employee into in-memory UserDirectory
  UserDirectory.resyncEmployee(data);

  return enrichEmployee(data);
}

/**
 * Update an employee.
 * Saves to Supabase (source of truth), then syncs in-memory cache.
 */
export async function update(id, fields) {
  const updateData = { ...fields, updated_at: new Date().toISOString() };
  // Don't allow changing id
  delete updateData.id;

  // Store skill_level in meta JSONB (no column migration needed)
  if (updateData.skill_level !== undefined) {
    // First read current meta to merge
    const { data: current } = await supabase
      .from("employees")
      .select("meta")
      .eq("id", id)
      .single();
    const currentMeta = current?.meta || {};
    updateData.meta = { ...currentMeta, ...(updateData.meta || {}), skill_level: updateData.skill_level };
    delete updateData.skill_level;
  }

  const { data, error } = await supabase
    .from("employees")
    .update(updateData)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  // Sync updated employee into in-memory UserDirectory
  UserDirectory.resyncEmployee(data);

  return enrichEmployee(data);
}

/**
 * Find employee by Telegram user ID.
 * @param {string} telegramUserId - Telegram numeric user ID
 * @returns {Object|null} - Employee or null
 */
export async function getByTelegramUserId(telegramUserId) {
  if (!telegramUserId) return null;
  try {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("telegram_user_id", String(telegramUserId))
      .eq("is_active", true)
      .single();

    if (error && error.code === "PGRST116") return null; // Not found
    if (error) throw error;
    return data;
  } catch (err) {
    logger.warn({ err, telegramUserId }, "employeeService getByTelegramUserId error");
    return null;
  }
}

/**
 * Link a Telegram user to an employee.
 * @param {string} employeeId - Internal employee ID (e.g. "u1")
 * @param {string} telegramUserId - Telegram numeric user ID
 * @param {string} [telegramUsername] - Telegram @username
 * @returns {Object} - Updated employee
 */
export async function linkTelegram(employeeId, telegramUserId, telegramUsername) {
  const updateData = {
    telegram_user_id: String(telegramUserId),
    updated_at: new Date().toISOString(),
  };
  if (telegramUsername) {
    updateData.telegram_username = telegramUsername.replace(/^@/, "");
  }

  const { data, error } = await supabase
    .from("employees")
    .update(updateData)
    .eq("id", employeeId)
    .select("*")
    .single();

  if (error) throw error;

  // Sync into in-memory cache
  UserDirectory.resyncEmployee(data);

  return data;
}

/**
 * Soft-delete (deactivate) an employee.
 */
export async function deactivate(id) {
  const { data, error } = await supabase
    .from("employees")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  // Remove deactivated employee from in-memory cache
  UserDirectory.users.delete(id);

  return data;
}
