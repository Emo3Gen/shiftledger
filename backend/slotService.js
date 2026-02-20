/**
 * Slot Template Service
 *
 * CRUD for configurable time slots per tenant.
 * Falls back to default hardcoded slots if DB is unavailable.
 */

import { supabase } from "./supabaseClient.js";
import logger from "./logger.js";

const DEFAULT_SLOTS = [
  {
    id: 1,
    tenant_id: "dev",
    name: "Утро",
    dow: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    from_time: "10:00:00",
    to_time: "13:00:00",
    is_active: true,
    meta: {},
  },
  {
    id: 2,
    tenant_id: "dev",
    name: "Вечер",
    dow: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    from_time: "18:00:00",
    to_time: "21:00:00",
    is_active: true,
    meta: {},
  },
];

/**
 * Normalize time from DB format (HH:MM:SS) to HH:MM.
 */
function normalizeTime(t) {
  if (!t) return t;
  // "10:00:00" → "10:00"
  const parts = t.split(":");
  return `${parts[0]}:${parts[1]}`;
}

/**
 * Normalize a slot template for consistent output.
 */
function normalizeSlot(slot) {
  return {
    ...slot,
    from_time: normalizeTime(slot.from_time),
    to_time: normalizeTime(slot.to_time),
  };
}

/**
 * Get active slot templates for a tenant.
 */
export async function getByTenant(tenantId = "dev") {
  try {
    const { data, error } = await supabase
      .from("slot_templates")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("from_time");

    if (error) throw error;
    return (data || []).map(normalizeSlot);
  } catch (err) {
    logger.warn({ err }, "slotService getByTenant fallback to defaults");
    return DEFAULT_SLOTS.map(normalizeSlot);
  }
}

/**
 * Create a new slot template.
 */
export async function create(slot) {
  const { data, error } = await supabase
    .from("slot_templates")
    .insert({
      tenant_id: slot.tenant_id || "dev",
      name: slot.name,
      dow: slot.dow || ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      from_time: slot.from_time,
      to_time: slot.to_time,
      is_active: true,
      meta: slot.meta || {},
    })
    .select("*")
    .single();

  if (error) throw error;
  return normalizeSlot(data);
}

/**
 * Update a slot template.
 */
export async function update(id, fields) {
  const updateData = { ...fields };
  delete updateData.id;
  delete updateData.created_at;

  const { data, error } = await supabase
    .from("slot_templates")
    .update(updateData)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return normalizeSlot(data);
}

/**
 * Soft-delete (deactivate) a slot template.
 */
export async function deactivate(id) {
  const { data, error } = await supabase
    .from("slot_templates")
    .update({ is_active: false })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return normalizeSlot(data);
}

/**
 * Get default slots (for fallback / sync).
 */
export function getDefaults() {
  return DEFAULT_SLOTS.map(normalizeSlot);
}
