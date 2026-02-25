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
    meta: {},
    created_at: null,
    updated_at: null,
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
    return data;
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
    return data;
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
  const row = {
    id: employee.id,
    name: employee.name,
    role: employee.role || "staff",
    rate_per_hour: employee.rate_per_hour || 0,
    min_hours_per_week: employee.min_hours_per_week || 0,
    max_hours_per_week: employee.max_hours_per_week || 40,
    is_active: true,
    meta: employee.meta || {},
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
  return data;
}

/**
 * Update an employee.
 */
export async function update(id, fields) {
  const updateData = { ...fields, updated_at: new Date().toISOString() };
  // Don't allow changing id
  delete updateData.id;

  const { data, error } = await supabase
    .from("employees")
    .update(updateData)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
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
  return data;
}
