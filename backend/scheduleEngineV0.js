/**
 * Schedule Engine v0
 * 
 * Builds a draft schedule from facts (SHIFT_AVAILABILITY, SHIFT_GAP, etc.)
 */

// WeekHoursTemplate: mapping day-of-week × slot(утро/вечер) -> hours
// Исторические значения из эталонной недели v1
const WeekHoursTemplate = {
  mon: { morning: 5.0, evening: 6.0 },
  tue: { morning: 5.0, evening: 6.0 },
  wed: { morning: 4.5, evening: 6.0 },
  thu: { morning: 5.0, evening: 5.5 },
  fri: { morning: 5.5, evening: 6.5 },
  sat: { morning: 6.0, evening: 6.5 },
  sun: { morning: 5.0, evening: 6.0 },
};

// Helper: get hours for a slot from template
function getSlotHours(dow, slotName) {
  const template = WeekHoursTemplate[dow];
  if (!template) return null;
  if (slotName === "Утро" || slotName === "morning") {
    return template.morning;
  }
  if (slotName === "Вечер" || slotName === "evening") {
    return template.evening;
  }
  return null;
}

import { UserDirectory } from "./userDirectory.js";

// Default slot types (fallback if none provided)
const DEFAULT_SLOT_TYPES = [
  { name: "Утро", from: "10:00", to: "13:00" },
  { name: "Вечер", from: "18:00", to: "21:00" },
];

export function buildDraftSchedule({ facts, weekStartISO, slotTypes }) {
  // Step 0: Collect SHIFT_REPLACEMENT facts (replacement overrides)
  // When someone offers to replace (e.g. "я смогу выйти в чт утро"),
  // the slot should be reassigned to the replacement user.
  const replacementBySlot = new Map(); // key: "dow|from|to", value: { replacement_user_id, created_at }

  for (const fact of facts || []) {
    if (fact.fact_type !== "SHIFT_REPLACEMENT") continue;

    const { dow, from, to } = fact.fact_payload || {};
    if (!dow || !from || !to) continue;

    const slotKey = `${dow}|${from}|${to}`;
    const replacementUserId = fact.user_id || fact.fact_payload?.user_id;
    if (!replacementUserId) continue;

    const normalizedId = UserDirectory.normalizeUserId(replacementUserId);
    const factCreatedAt = new Date(fact.created_at || 0).getTime();
    const existing = replacementBySlot.get(slotKey);
    const existingCreatedAt = existing ? new Date(existing.created_at).getTime() : 0;

    // Keep the latest replacement per slot
    if (!existing || factCreatedAt > existingCreatedAt) {
      replacementBySlot.set(slotKey, {
        replacement_user_id: normalizedId,
        created_at: fact.created_at,
      });
    }
  }

  // Step 1: Collect assignment overrides (SHIFT_ASSIGNMENT facts)
  // This is the override source - assignments take priority over everything
  const assignmentBySlot = new Map(); // key: "dow|from|to", value: { dow, from, to, user_id, created_at, reason }

  for (const fact of facts || []) {
    if (fact.fact_type !== "SHIFT_ASSIGNMENT") continue;

    const { dow, from, to } = fact.fact_payload || {};
    if (!dow || !from || !to) continue;

    const slotKey = `${dow}|${from}|${to}`;
    const user_id = fact.fact_payload?.assigned_user_id || fact.user_id;
    if (!user_id) continue;
    
    // Normalize user_id (slug -> internal id)
    const normalizedUserId = UserDirectory.normalizeUserId(user_id);

    const factCreatedAt = new Date(fact.created_at || 0).getTime();
    const existing = assignmentBySlot.get(slotKey);
    const existingCreatedAt = existing ? new Date(existing.created_at).getTime() : 0;

    // Keep the latest assignment per slot
    if (!existing || factCreatedAt > existingCreatedAt) {
      assignmentBySlot.set(slotKey, {
        dow,
        from,
        to,
        user_id: normalizedUserId, // Use normalized ID
        replaced_user_id: fact.fact_payload?.replaced_user_id
          ? UserDirectory.normalizeUserId(fact.fact_payload.replaced_user_id)
          : null,
        created_at: fact.created_at,
        reason: fact.fact_payload?.reason || "manual assignment",
      });
    }
  }

  // Step 2: Normalize slots and collect candidates (for slots without assignment override)
  const candidatesBySlot = new Map(); // key: "dow|from|to", value: Set of user_ids
  const gapSlots = new Set(); // key: "dow|from|to"
  const allSlots = new Set(); // All unique slots

  // Add all assignment slots to allSlots
  for (const slotKey of assignmentBySlot.keys()) {
    allSlots.add(slotKey);
  }

  // Process SHIFT_AVAILABILITY facts (only for slots without assignment override)
  for (const fact of facts || []) {
    if (fact.fact_type !== "SHIFT_AVAILABILITY") continue;
    if (fact.fact_payload?.availability !== "can") continue;

    const { dow, from, to } = fact.fact_payload || {};
    if (!dow || !from || !to) continue;

    const slotKey = `${dow}|${from}|${to}`;
    
    // Skip if this slot has an assignment override
    if (assignmentBySlot.has(slotKey)) continue;

    allSlots.add(slotKey);

    if (!candidatesBySlot.has(slotKey)) {
      candidatesBySlot.set(slotKey, new Set());
    }
    const userId = fact.user_id || fact.fact_payload?.user_id;
    if (userId) {
      // Normalize user_id (slug -> internal id)
      const normalizedUserId = UserDirectory.normalizeUserId(userId);
      candidatesBySlot.get(slotKey).add(normalizedUserId);
    }
  }

  // Process SHIFT_GAP facts (only for slots without assignment override)
  for (const fact of facts || []) {
    if (fact.fact_type !== "SHIFT_GAP") continue;

    const { dow, from, to } = fact.fact_payload || {};
    if (!dow || !from || !to) continue;

    const slotKey = `${dow}|${from}|${to}`;
    
    // Skip if this slot has an assignment override
    if (assignmentBySlot.has(slotKey)) continue;

    allSlots.add(slotKey);
    gapSlots.add(slotKey);
  }

  // Step 2: Define minimum hours requirements and user roles from UserDirectory
  const minHoursRequirements = new Map();
  const juniorUserIds = UserDirectory.getJuniorUserIds();
  for (const userId of juniorUserIds) {
    const minHours = UserDirectory.getMinHours(userId);
    minHoursRequirements.set(userId, minHours);
  }
  
  // Get senior users from UserDirectory
  const seniorUserIds = UserDirectory.getSeniorUserIds();
  const seniorUsers = new Set(seniorUserIds);

  // Helper: calculate hours for a slot
  function calculateSlotHours(from, to) {
    const fromParts = from.split(":");
    const toParts = to.split(":");
    const fromHours = parseFloat(fromParts[0]) + parseFloat(fromParts[1] || 0) / 60;
    const toHours = parseFloat(toParts[0]) + parseFloat(toParts[1] || 0) / 60;
    return Math.max(0, toHours - fromHours);
  }

  // Step 3: Build assignments, gaps, and conflicts
  const assignments = [];
  const gaps = [];
  const conflicts = [];

  // First, add all assignment overrides to assignments
  const assignedHoursByUser = new Map(); // user_id -> total assigned hours
  for (const assignment of assignmentBySlot.values()) {
    const hours = calculateSlotHours(assignment.from, assignment.to);
    assignedHoursByUser.set(assignment.user_id, (assignedHoursByUser.get(assignment.user_id) || 0) + hours);
    assignments.push({
      dow: assignment.dow,
      from: assignment.from,
      to: assignment.to,
      user_id: assignment.user_id,
      replaced_user_id: assignment.replaced_user_id || null,
      reason: assignment.reason,
    });
  }

  // Process gaps first (before auto-assignment)
  for (const slotKey of allSlots) {
    if (assignmentBySlot.has(slotKey)) continue; // Skip manual assignments
    if (!gapSlots.has(slotKey)) continue; // Only process gaps

    const [dow, from, to] = slotKey.split("|");
    const candidates = candidatesBySlot.get(slotKey);
    if (!candidates || candidates.size === 0) {
      gaps.push({
        dow,
        from,
        to,
        reason: "gap reported, no candidates",
      });
    } else {
      gaps.push({
        dow,
        from,
        to,
        reason: "gap reported, candidates available but not confirmed",
      });
    }
  }

  // Collect all available slots (without assignment override and without gaps)
  const availableSlots = [];
  for (const slotKey of allSlots) {
    if (assignmentBySlot.has(slotKey)) continue; // Skip manual assignments
    if (gapSlots.has(slotKey)) continue; // Skip gaps

    const [dow, from, to] = slotKey.split("|");
    const candidates = candidatesBySlot.get(slotKey);
    if (!candidates || candidates.size === 0) {
      conflicts.push({
        dow,
        from,
        to,
        reason: "no candidates",
        candidates: [],
      });
      continue;
    }

    const hours = calculateSlotHours(from, to);
    availableSlots.push({
      slotKey,
      dow,
      from,
      to,
      hours,
      candidates: Array.from(candidates),
    });
  }

  // Sort slots deterministically (by dow, then by from)
  const DOW_ORDER = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
  availableSlots.sort((a, b) => {
    const dowDiff = (DOW_ORDER[a.dow] || 999) - (DOW_ORDER[b.dow] || 999);
    if (dowDiff !== 0) return dowDiff;
    return a.from.localeCompare(b.from);
  });

  // Phase 1: Assign slots to meet minimum hours requirements
  const slotsForPhase2 = [];
  for (const slot of availableSlots) {
    let assigned = false;

    // Try to assign to users who need to meet minimum hours
    const candidatesNeedingHours = slot.candidates
      .filter((userId) => {
        if (seniorUsers.has(userId)) return false; // Skip seniors in phase 1
        const minHours = minHoursRequirements.get(userId) || 0;
        if (minHours === 0) return false; // No minimum requirement
        const currentHours = assignedHoursByUser.get(userId) || 0;
        return currentHours < minHours;
      })
      .sort((a, b) => {
        // Prioritize users who are further from their minimum
        const minA = minHoursRequirements.get(a) || 0;
        const minB = minHoursRequirements.get(b) || 0;
        const currentA = assignedHoursByUser.get(a) || 0;
        const currentB = assignedHoursByUser.get(b) || 0;
        const gapA = minA - currentA;
        const gapB = minB - currentB;
        if (gapB !== gapA) return gapB - gapA; // Larger gap = higher priority
        return a.localeCompare(b); // Deterministic tie-breaker
      });

    if (candidatesNeedingHours.length > 0) {
      const selectedUserId = candidatesNeedingHours[0];
      assignedHoursByUser.set(
        selectedUserId,
        (assignedHoursByUser.get(selectedUserId) || 0) + slot.hours,
      );
      assignments.push({
        dow: slot.dow,
        from: slot.from,
        to: slot.to,
        user_id: selectedUserId,
        reason: `meet_minimum`,
      });
      assigned = true;
    }

    if (!assigned) {
      slotsForPhase2.push(slot);
    }
  }

  // Phase 2: Distribute remaining slots evenly among junior staff (excluding seniors)
  const juniorUsers = new Set(
    Array.from(assignedHoursByUser.keys()).filter((u) => !seniorUsers.has(u)),
  );
  // Add all junior candidates who haven't been assigned yet
  for (const slot of slotsForPhase2) {
    for (const userId of slot.candidates) {
      if (!seniorUsers.has(userId)) {
        juniorUsers.add(userId);
      }
    }
  }

  for (const slot of slotsForPhase2) {
    const juniorCandidates = slot.candidates.filter((u) => !seniorUsers.has(u));
    if (juniorCandidates.length === 0) {
      // No junior candidates, will be handled in phase 3
      continue;
    }

    // Select candidate with least current hours (for even distribution)
    juniorCandidates.sort((a, b) => {
      const hoursA = assignedHoursByUser.get(a) || 0;
      const hoursB = assignedHoursByUser.get(b) || 0;
      if (hoursA !== hoursB) return hoursA - hoursB; // Less hours = higher priority
      return a.localeCompare(b); // Deterministic tie-breaker
    });

    const selectedUserId = juniorCandidates[0];
    assignedHoursByUser.set(
      selectedUserId,
      (assignedHoursByUser.get(selectedUserId) || 0) + slot.hours,
    );
    assignments.push({
      dow: slot.dow,
      from: slot.from,
      to: slot.to,
      user_id: selectedUserId,
      reason: `even_distribution`,
    });
  }

  // Phase 3: Use seniors (Karina) only for remaining empty slots
  const remainingSlots = slotsForPhase2.filter((slot) => {
    // Check if this slot was assigned in phase 2
    return !assignments.some(
      (a) => a.dow === slot.dow && a.from === slot.from && a.to === slot.to,
    );
  });

  for (const slot of remainingSlots) {
    const seniorCandidates = slot.candidates.filter((u) => seniorUsers.has(u));
    if (seniorCandidates.length > 0) {
      // Use senior as last resort
      seniorCandidates.sort((a, b) => a.localeCompare(b)); // Deterministic
      const selectedUserId = seniorCandidates[0];
      assignedHoursByUser.set(
        selectedUserId,
        (assignedHoursByUser.get(selectedUserId) || 0) + slot.hours,
      );
      assignments.push({
        dow: slot.dow,
        from: slot.from,
        to: slot.to,
        user_id: selectedUserId,
        reason: `senior_reserve`,
      });
    } else {
      // No candidates at all -> gap
      gaps.push({
        dow: slot.dow,
        from: slot.from,
        to: slot.to,
        reason: "no candidates (including seniors)",
      });
    }
  }

  // Step 3.5: Apply SHIFT_REPLACEMENT overrides
  // If a replacement fact exists for a slot, swap the assigned user to the replacement user.
  // Skip if the slot is already assigned to the replacement user (e.g. from a persisted
  // SHIFT_ASSIGNMENT created by a prior build-schedule that already applied the replacement).
  for (const [slotKey, repl] of replacementBySlot.entries()) {
    const [dow, from, to] = slotKey.split("|");
    const existingIdx = assignments.findIndex(
      (a) => a.dow === dow && a.from === from && a.to === to,
    );

    if (existingIdx >= 0) {
      const original = assignments[existingIdx];

      // Already assigned to the replacement user — skip swap
      if (original.user_id === repl.replacement_user_id) {
        continue;
      }

      const replacedName = UserDirectory.getDisplayName(original.user_id);
      const replacementName = UserDirectory.getDisplayName(repl.replacement_user_id);

      // Update hours tracking
      const hours = calculateSlotHours(from, to);
      assignedHoursByUser.set(original.user_id, (assignedHoursByUser.get(original.user_id) || 0) - hours);
      assignedHoursByUser.set(repl.replacement_user_id, (assignedHoursByUser.get(repl.replacement_user_id) || 0) + hours);

      assignments[existingIdx] = {
        dow,
        from,
        to,
        user_id: repl.replacement_user_id,
        replaced_user_id: original.user_id,
        reason: `🔄 Замена: ${replacementName} за ${replacedName}`,
      };
    } else {
      // No prior assignment — replacement is the first assignment for this slot
      const replacementName = UserDirectory.getDisplayName(repl.replacement_user_id);
      const hours = calculateSlotHours(from, to);
      assignedHoursByUser.set(repl.replacement_user_id, (assignedHoursByUser.get(repl.replacement_user_id) || 0) + hours);
      assignments.push({
        dow,
        from,
        to,
        user_id: repl.replacement_user_id,
        replaced_user_id: null,
        reason: `🔄 Замена: ${replacementName}`,
      });
    }
  }

  // Step 4: Determine shift status for each slot
  // Collect ONLY explicit confirmations: SCHEDULE_CONFIRMED (confirms all user's shifts) or WEEK_CONFIRM with slot_key
  // IMPORTANT: SHIFT_WORKED is NOT a confirmation - it's a fact about work done, not schedule confirmation
  const confirmationsBySlot = new Map(); // key: "dow|from|to", value: { created_at, user_id }
  const scheduleConfirmationsByUser = new Map(); // key: user_id, value: { created_at, week_start }
  const problemsByUser = new Map(); // key: user_id, value: { created_at, week_start, problem_message }
  
  // Track assignment timestamps to detect changes (if assignment is newer than confirmation, reset)
  const assignmentTimestampsBySlot = new Map(); // key: "dow|from|to", value: created_at of latest assignment
  
  for (const fact of facts || []) {
    if (fact.fact_type === "SCHEDULE_CONFIRMED") {
      // User confirmed all their assigned shifts for the week
      const weekStart = fact.fact_payload?.week_start;
      const userId = fact.user_id;
      if (userId && weekStart === weekStartISO) {
        const factCreatedAt = new Date(fact.created_at || 0).getTime();
        const existing = scheduleConfirmationsByUser.get(userId);
        const existingCreatedAt = existing ? new Date(existing.created_at).getTime() : 0;
        if (!existing || factCreatedAt > existingCreatedAt) {
          scheduleConfirmationsByUser.set(userId, {
            created_at: fact.created_at,
            week_start: weekStart,
          });
        }
      }
    } else if (fact.fact_type === "SCHEDULE_PROBLEM") {
      // User reported a problem
      const weekStart = fact.fact_payload?.week_start;
      const userId = fact.user_id;
      if (userId && weekStart === weekStartISO) {
        const factCreatedAt = new Date(fact.created_at || 0).getTime();
        const existing = problemsByUser.get(userId);
        const existingCreatedAt = existing ? new Date(existing.created_at).getTime() : 0;
        if (!existing || factCreatedAt > existingCreatedAt) {
          problemsByUser.set(userId, {
            created_at: fact.created_at,
            week_start: weekStart,
            problem_message: fact.fact_payload?.problem_message,
          });
        }
      }
    } else if (fact.fact_type === "SHIFT_ASSIGNMENT") {
      // Track when assignment was made (to detect changes)
      const { dow, from, to } = fact.fact_payload || {};
      if (dow && from && to) {
        const slotKey = `${dow}|${from}|${to}`;
        const factCreatedAt = new Date(fact.created_at || 0).getTime();
        const existing = assignmentTimestampsBySlot.get(slotKey);
        const existingCreatedAt = existing ? new Date(existing).getTime() : 0;
        if (!existing || factCreatedAt > existingCreatedAt) {
          assignmentTimestampsBySlot.set(slotKey, fact.created_at);
        }
      }
    } else if (fact.fact_type === "WEEK_CONFIRM") {
      // Legacy: specific slot confirmation
      const slotKey = fact.fact_payload?.slot_key;
      if (slotKey) {
        const factCreatedAt = new Date(fact.created_at || 0).getTime();
        const existing = confirmationsBySlot.get(slotKey);
        const existingCreatedAt = existing ? new Date(existing.created_at).getTime() : 0;
        if (!existing || factCreatedAt > existingCreatedAt) {
          confirmationsBySlot.set(slotKey, {
            created_at: fact.created_at,
            user_id: fact.user_id,
          });
        }
      }
    }
    // NOTE: SHIFT_WORKED is intentionally NOT treated as confirmation
    // SHIFT_WORKED is a fact about work done, not a schedule confirmation
  }

  // Build slots with status
  const slots = [];
  const assignmentsBySlotKey = new Map(); // key: "dow|from|to", value: assignment
  for (const assignment of assignments) {
    // Normalize time format (ensure HH:MM format)
    const fromTime = assignment.from.includes(":") ? assignment.from : `${assignment.from}:00`;
    const toTime = assignment.to.includes(":") ? assignment.to : `${assignment.to}:00`;
    const slotKey = `${assignment.dow}|${fromTime}|${toTime}`;
    assignmentsBySlotKey.set(slotKey, assignment);
    
    // IMPORTANT: Also populate assignmentTimestampsBySlot from assignmentBySlot (which has created_at from facts)
    // This ensures that assignments created via build-schedule (which become facts) are tracked
    const assignmentFromSlot = assignmentBySlot.get(slotKey);
    if (assignmentFromSlot && assignmentFromSlot.created_at) {
      const factCreatedAt = new Date(assignmentFromSlot.created_at || 0).getTime();
      const existing = assignmentTimestampsBySlot.get(slotKey);
      const existingCreatedAt = existing ? new Date(existing).getTime() : 0;
      if (!existing || factCreatedAt > existingCreatedAt) {
        assignmentTimestampsBySlot.set(slotKey, assignmentFromSlot.created_at);
      }
    }
  }

  // Generate all possible slots for the week (configurable or default 2 slots)
  const DOW_LIST = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const SLOT_TYPES = (slotTypes && slotTypes.length > 0) ? slotTypes : DEFAULT_SLOT_TYPES;

  for (const dow of DOW_LIST) {
    for (const slotType of SLOT_TYPES) {
      const slotKey = `${dow}|${slotType.from}|${slotType.to}`;
      const assignment = assignmentsBySlotKey.get(slotKey);
      const confirmation = confirmationsBySlot.get(slotKey);

      let status = "EMPTY";
      let user_id = null;
      let hours = null;
      let hasProblem = false; // Initialize to false (fail-safe)

      if (assignment) {
        user_id = assignment.user_id;
        // Normalize user_id to ensure consistency
        user_id = UserDirectory.normalizeUserId(user_id);
        // Get hours from WeekHoursTemplate (not from time range)
        hours = getSlotHours(dow, slotType.name);
        if (hours === null) {
          // If template doesn't have hours, log warning but don't fail
          console.warn(`[SCHEDULE] Missing hours template for ${dow} ${slotType.name}`);
          hours = null; // Will show as "—" in UI
        }

        // Check for confirmation: either slot-specific (confirmationsBySlot) or user-wide (scheduleConfirmationsByUser)
        const slotConfirmation = confirmation && confirmation.user_id === user_id;
        const userScheduleConfirmation = scheduleConfirmationsByUser.get(user_id);
        const isUserConfirmed = userScheduleConfirmation && userScheduleConfirmation.week_start === weekStartISO;
        
        // STRICT STATUS LOGIC:
        // - EMPTY: no assignment (already handled above)
        // - PENDING: assignment exists, but NO explicit confirmation
        // - CONFIRMED: assignment exists AND explicit confirmation exists AND confirmation is AFTER assignment
        // 
        // Rules:
        // 1. Assignment must exist (we're in this if block)
        // 2. Confirmation must exist (slot-specific WEEK_CONFIRM or user-wide SCHEDULE_CONFIRMED)
        // 3. Assignment time must be valid (assignTime > 0) - meaning assignment was saved as fact
        // 4. Confirmation must be AFTER assignment (confirmationTime > assignTime)
        // 
        // If any of these conditions fail -> PENDING
        const assignmentTime = assignmentTimestampsBySlot.get(slotKey);
        const confirmationTime = slotConfirmation 
          ? new Date(confirmation.created_at).getTime()
          : isUserConfirmed 
            ? new Date(userScheduleConfirmation.created_at).getTime()
            : 0;
        const assignTime = assignmentTime ? new Date(assignmentTime).getTime() : 0;
        
        const hasConfirmation = slotConfirmation || isUserConfirmed;
        const hasValidAssignmentTime = assignTime > 0;
        const confirmationIsAfterAssignment = hasConfirmation && hasValidAssignmentTime && confirmationTime > assignTime;
        
        if (hasConfirmation && hasValidAssignmentTime && confirmationIsAfterAssignment) {
          status = "CONFIRMED";
        } else {
          // Default: PENDING
          // This includes ALL cases where:
          // - No confirmation exists (hasConfirmation = false)
          // - Assignment time is not available (assignTime = 0, newly created, not yet saved as fact)
          // - Confirmation exists but predates the assignment (confirmationTime <= assignTime)
          status = "PENDING";
        }
      }

      // Determine if shift is problematic
      let isProblematic = false;
      let problemReasons = [];
      
      // hasProblem: check if user reported a problem (for this slot's user)
      if (assignment && user_id) {
        const userProblem = problemsByUser.get(user_id);
        if (userProblem && userProblem.week_start === weekStartISO) {
          hasProblem = true;
        }
      }

      // Check if shift was marked as problematic
      for (const fact of facts || []) {
        if (fact.fact_type === "SHIFT_MARKED_PROBLEM") {
          const factSlotKey = `${fact.fact_payload?.dow}|${fact.fact_payload?.from}|${fact.fact_payload?.to}`;
          if (factSlotKey === slotKey) {
            isProblematic = true;
            problemReasons.push("marked_by_admin");
          }
        } else if (fact.fact_type === "SCHEDULE_PROBLEM") {
          if (fact.fact_payload?.week_start === weekStartISO && fact.user_id === user_id) {
            isProblematic = true;
            problemReasons.push("reported_by_employee");
          }
        }
      }

      // Check if shift was a replacement (from gap that was closed)
      if (assignment) {
        // Check if there was a gap before this assignment
        for (const fact of facts || []) {
          if (fact.fact_type === "SHIFT_GAP") {
            const gapSlotKey = `${fact.fact_payload?.dow}|${fact.fact_payload?.from}|${fact.fact_payload?.to}`;
            if (gapSlotKey === slotKey) {
              const gapTime = new Date(fact.created_at || 0).getTime();
              const assignTime = assignmentTimestampsBySlot.get(slotKey) 
                ? new Date(assignmentTimestampsBySlot.get(slotKey)).getTime() 
                : 0;
              // If assignment was made after gap, it's a replacement
              if (assignTime > gapTime) {
                isProblematic = true;
                problemReasons.push("replacement_after_gap");
              }
            }
          }
        }
        // Check if assignment reason indicates replacement
        if (assignment.reason === "senior_reserve" || assignment.reason === "manual assignment") {
          // Check if it was a last-minute assignment (within 24 hours of shift)
          // For v1, we'll mark senior_reserve as potentially problematic
          if (assignment.reason === "senior_reserve") {
            isProblematic = true;
            problemReasons.push("last_minute_senior");
          }
        }
      }

      slots.push({
        dow,
        slot_name: slotType.name,
        from: slotType.from,
        to: slotType.to,
        user_id,
        replaced_user_id: assignment?.replaced_user_id || null,
        hours,
        status,
        has_problem: hasProblem,
        is_problematic: isProblematic,
        problem_reasons: problemReasons,
      });
    }
  }

  // Collect all unique candidate user_ids from candidatesBySlot
  const allCandidateUserIds = new Set();
  for (const candidateSet of candidatesBySlot.values()) {
    for (const userId of candidateSet) {
      allCandidateUserIds.add(userId);
    }
  }

  return {
    week_start: weekStartISO,
    assignments,
    gaps,
    conflicts,
    slots, // New: all slots with status
    meta: {
      facts_count: facts?.length || 0,
      slots_count: allSlots.size,
      candidates_count: allCandidateUserIds.size, // Count of unique candidate user_ids
      assigned_slots_count: assignmentBySlot.size, // Count of slots with manual assignments
      engine: "v0",
    },
  };
}
