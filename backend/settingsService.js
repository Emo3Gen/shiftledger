/**
 * Settings Service
 *
 * Key-value tenant settings backed by Supabase tenant_settings table.
 * Falls back to in-memory defaults if DB is unavailable.
 */

import { supabase } from "./supabaseClient.js";
import logger from "./logger.js";

const DEFAULTS = {
  "shifts.morning.from": "10:00",
  "shifts.morning.to": "13:00",
  "shifts.morning.name": "Утро",
  "shifts.evening.from": "18:00",
  "shifts.evening.to": "21:00",
  "shifts.evening.name": "Вечер",
  "pay.default_rate": 280,
  "pay.cleaning_rate": 500,
  "pay.extra_class_base": 500,
  "pay.extra_class_threshold": 8,
  "pay.extra_class_per_kid": 100,
  "pay.problem_deduction_hours": 1,
  "pay.rounding_step": 100,
  "pay.inter_branch_extra_hours": 0,
  "extra_work_catalog": [
    { id: "gen_cleaning", name: "Генеральная уборка", price: 1000 },
    { id: "reel", name: "Рилс с монтажом", price: 500 },
    { id: "shelf_sort", name: "Разбор шкафов", price: 600 },
    { id: "inventory", name: "Инвентаризация", price: 800 },
  ],
  "branches": ["Архангельск", "Северодвинск"],
  "schedule.default_branch": "Архангельск",
  "schedule.days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  "schedule.min_candidates_per_slot": 1,
  "schedule.auto_assign_cleaning": true,
  "schedule.senior_reserve_enabled": true,
  "schedule.auto_collect_day": "fri",
  "schedule.auto_collect_enabled": false,
  "cleaning_schedule": {
    mon: { morning: false, evening: true },
    tue: { morning: false, evening: true },
    wed: { morning: false, evening: true },
    thu: { morning: false, evening: true },
    fri: { morning: false, evening: true },
    sat: { morning: false, evening: true },
    sun: { morning: false, evening: false },
  },
  "schedule.week_hours_template": {
    mon: { morning: 5, evening: 6 },
    tue: { morning: 5, evening: 6 },
    wed: { morning: 4.5, evening: 6 },
    thu: { morning: 5, evening: 5.5 },
    fri: { morning: 5.5, evening: 6.5 },
    sat: { morning: 6, evening: 6.5 },
    sun: { morning: 5, evening: 6 },
  },
};

/**
 * Get all settings for a tenant.
 * @param {string} tenantId
 * @returns {Promise<Object>} - { key: value, ... }
 */
export async function getAll(tenantId = "dev") {
  try {
    const { data, error } = await supabase
      .from("tenant_settings")
      .select("key, value, description")
      .eq("tenant_id", tenantId)
      .order("key");

    if (error) throw error;

    const result = { ...DEFAULTS };
    for (const row of data || []) {
      result[row.key] = row.value;
    }
    return result;
  } catch (err) {
    logger.warn({ err }, "settingsService getAll fallback to defaults");
    return { ...DEFAULTS };
  }
}

/**
 * Get a single setting value.
 * @param {string} tenantId
 * @param {string} key
 * @returns {Promise<*>} - The setting value, or the default
 */
export async function get(tenantId = "dev", key) {
  try {
    const { data, error } = await supabase
      .from("tenant_settings")
      .select("value")
      .eq("tenant_id", tenantId)
      .eq("key", key)
      .single();

    if (error && error.code === "PGRST116") {
      // Not found — return default
      return DEFAULTS[key] ?? null;
    }
    if (error) throw error;
    return data.value;
  } catch (err) {
    logger.warn({ err, key }, "settingsService get fallback to default");
    return DEFAULTS[key] ?? null;
  }
}

/**
 * Set (upsert) a setting value.
 * @param {string} tenantId
 * @param {string} key
 * @param {*} value
 * @param {string} [description]
 * @returns {Promise<Object>} - The upserted row
 */
export async function set(tenantId = "dev", key, value, description) {
  const row = {
    tenant_id: tenantId,
    key,
    value: JSON.parse(JSON.stringify(value)),
    updated_at: new Date().toISOString(),
  };
  if (description !== undefined) {
    row.description = description;
  }

  const { data, error } = await supabase
    .from("tenant_settings")
    .upsert(row, { onConflict: "tenant_id,key" })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get all settings matching a key prefix.
 * e.g. getGroup("dev", "pay.") => { "pay.default_rate": 280, "pay.cleaning_rate": 500, ... }
 * @param {string} tenantId
 * @param {string} prefix
 * @returns {Promise<Object>}
 */
export async function getGroup(tenantId = "dev", prefix) {
  try {
    const { data, error } = await supabase
      .from("tenant_settings")
      .select("key, value")
      .eq("tenant_id", tenantId)
      .like("key", `${prefix}%`)
      .order("key");

    if (error) throw error;

    // Start with defaults matching prefix
    const result = {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
      if (k.startsWith(prefix)) {
        result[k] = v;
      }
    }
    // Override with DB values
    for (const row of data || []) {
      result[row.key] = row.value;
    }
    return result;
  } catch (err) {
    logger.warn({ err, prefix }, "settingsService getGroup fallback to defaults");
    const result = {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
      if (k.startsWith(prefix)) {
        result[k] = v;
      }
    }
    return result;
  }
}

/**
 * Bulk set multiple settings at once.
 * @param {string} tenantId
 * @param {Array<{key: string, value: *, description?: string}>} settings
 * @returns {Promise<Array>}
 */
export async function bulkSet(tenantId = "dev", settings) {
  const rows = settings.map((s) => ({
    tenant_id: tenantId,
    key: s.key,
    value: JSON.parse(JSON.stringify(s.value)),
    description: s.description || null,
    updated_at: new Date().toISOString(),
  }));

  const { data, error } = await supabase
    .from("tenant_settings")
    .upsert(rows, { onConflict: "tenant_id,key" })
    .select("*");

  if (error) throw error;
  return data;
}

/** Exported defaults for use in engines as fallback */
export { DEFAULTS };
