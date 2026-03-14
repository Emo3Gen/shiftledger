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
function getSlotHours(dow, slotName, template) {
  const dayTemplate = (template || WeekHoursTemplate)[dow];
  if (!dayTemplate) return null;
  if (slotName === "Утро" || slotName === "morning") {
    return dayTemplate.morning;
  }
  if (slotName === "Вечер" || slotName === "evening") {
    return dayTemplate.evening;
  }
  return null;
}

import { UserDirectory } from "./userDirectory.js";

// Default slot types (fallback if none provided)
const DEFAULT_SLOT_TYPES = [
  { name: "Утро", from: "10:00", to: "13:00" },
  { name: "Вечер", from: "18:00", to: "21:00" },
];

export function buildDraftSchedule({ facts, weekStartISO, slotTypes, settings }) {
  // Allow overriding WeekHoursTemplate from settings
  const hoursTemplate = settings?.["schedule.week_hours_template"] || WeekHoursTemplate;
  const seniorReserveEnabled = settings?.["schedule.senior_reserve_enabled"] ?? true;
  const slotSkillReqs = settings?.["schedule.slot_skill_requirements"] || {}; // "dow|morning" → skill_level
  const SKILL_ORDER = { beginner: 0, experienced: 1, guru: 2 };

  // Pre-filter: only use facts that belong to the requested week
  // Facts without week_start are included (backwards compatibility)
  const filteredFacts = (facts || []).filter(f => {
    const ws = f.fact_payload?.week_start;
    if (!ws) return true; // No week_start — include (legacy facts)
    return ws === weekStartISO;
  });

  // Step 0: Collect SHIFT_REPLACEMENT facts (replacement overrides)
  // When someone offers to replace (e.g. "я смогу выйти в чт утро"),
  // the slot should be reassigned to the replacement user.
  const replacementBySlot = new Map(); // key: "dow|from|to", value: { replacement_user_id, created_at }

  for (const fact of filteredFacts) {
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

  for (const fact of filteredFacts) {
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

  // Step 1.1: Process SHIFT_UNASSIGNMENT — explicitly empty a slot
  // If an unassignment is newer than the assignment for a slot, remove the assignment
  // and mark the slot as intentionally empty (skip auto-assignment)
  const unassignedSlots = new Set(); // slots that should remain empty
  for (const fact of filteredFacts) {
    if (fact.fact_type !== "SHIFT_UNASSIGNMENT") continue;

    const { dow, from, to } = fact.fact_payload || {};
    if (!dow || !from || !to) continue;

    const slotKey = `${dow}|${from}|${to}`;
    const factCreatedAt = new Date(fact.created_at || 0).getTime();
    const existing = assignmentBySlot.get(slotKey);
    const existingCreatedAt = existing ? new Date(existing.created_at).getTime() : 0;

    // Unassignment wins if it's newer than any assignment
    if (factCreatedAt > existingCreatedAt) {
      assignmentBySlot.delete(slotKey);
      unassignedSlots.add(slotKey);
    }
  }

  // Step 1.5: Process SHIFT_UNAVAILABILITY — mark assignments as needing replacement
  // MUST run BEFORE SHIFT_AVAILABILITY so that freed-up slots collect candidates
  const unavailableBySlot = new Map(); // key: "dow|from|to", value: Set of user_ids who can't work
  const needsReplacementBySlot = new Map(); // key: "dow|from|to", value: { original_user_id, unavail_created_at }
  const debugSkipped = []; // Debug: track why employees were skipped
  for (const fact of filteredFacts) {
    if (fact.fact_type !== "SHIFT_UNAVAILABILITY") continue;

    const { dow, from, to } = fact.fact_payload || {};
    if (!dow || !from || !to) continue;

    const slotKey = `${dow}|${from}|${to}`;
    const userId = fact.user_id || fact.fact_payload?.user_id;
    if (!userId) continue;

    const normalizedUserId = UserDirectory.normalizeUserId(userId);

    // Track unavailable users per slot (used later to filter candidates)
    if (!unavailableBySlot.has(slotKey)) {
      unavailableBySlot.set(slotKey, new Set());
    }
    unavailableBySlot.get(slotKey).add(normalizedUserId);

    // Instead of deleting the assignment, mark the slot as NEEDS_REPLACEMENT
    // The assignment stays so that auto-assign phases skip this slot
    const existingAssignment = assignmentBySlot.get(slotKey);
    if (existingAssignment && existingAssignment.user_id === normalizedUserId) {
      const unavailCreatedAt = new Date(fact.created_at || 0).getTime();
      const assignCreatedAt = new Date(existingAssignment.created_at || 0).getTime();
      if (unavailCreatedAt > assignCreatedAt) {
        needsReplacementBySlot.set(slotKey, {
          original_user_id: normalizedUserId,
          unavail_created_at: fact.created_at,
        });
      }
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

  // Track ALL available candidates per slot (including assigned slots) — used for UI
  const allAvailableBySlot = new Map(); // key: "dow|from|to", value: Set of user_ids

  // Process SHIFT_AVAILABILITY facts (only for slots without assignment override)
  for (const fact of filteredFacts) {
    if (fact.fact_type !== "SHIFT_AVAILABILITY") continue;
    if (fact.fact_payload?.availability !== "can") continue;

    const { dow, from, to } = fact.fact_payload || {};
    if (!dow || !from || !to) continue;

    const slotKey = `${dow}|${from}|${to}`;

    // Track in allAvailableBySlot (for UI, regardless of assignment)
    const userId = fact.user_id || fact.fact_payload?.user_id;
    if (userId) {
      const normalizedUserId = UserDirectory.normalizeUserId(userId);
      const unavailUsers = unavailableBySlot.get(slotKey);
      if (unavailUsers && unavailUsers.has(normalizedUserId)) {
        debugSkipped.push({
          user_id: normalizedUserId,
          user_name: UserDirectory.getDisplayName(normalizedUserId),
          slot: slotKey,
          reason: "UNAVAILABLE fact exists for this slot",
        });
      } else {
        if (!allAvailableBySlot.has(slotKey)) {
          allAvailableBySlot.set(slotKey, new Set());
        }
        allAvailableBySlot.get(slotKey).add(normalizedUserId);
      }
    }

    // Skip if this slot has an assignment override (for auto-assignment only)
    if (assignmentBySlot.has(slotKey)) continue;

    allSlots.add(slotKey);

    if (!candidatesBySlot.has(slotKey)) {
      candidatesBySlot.set(slotKey, new Set());
    }
    if (userId) {
      const normalizedUserId = UserDirectory.normalizeUserId(userId);
      const unavailUsers = unavailableBySlot.get(slotKey);
      if (unavailUsers && unavailUsers.has(normalizedUserId)) continue;
      candidatesBySlot.get(slotKey).add(normalizedUserId);
    }
  }

  // Process SHIFT_GAP facts (only for slots without assignment override)
  for (const fact of filteredFacts) {
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
  const juniorUserIds = UserDirectory.getJuniorUserIds()
    .filter(uid => UserDirectory.isAutoSchedule(uid));
  for (const userId of juniorUserIds) {
    const minHours = UserDirectory.getMinHours(userId);
    minHoursRequirements.set(userId, minHours);
  }

  // Get senior users from UserDirectory
  const seniorUserIds = UserDirectory.getSeniorUserIds()
    .filter(uid => UserDirectory.isAutoSchedule(uid));
  const seniorUsers = new Set(seniorUserIds);

  // Helper: calculate hours for a slot
  function calculateSlotHours(from, to) {
    const fromParts = from.split(":");
    const toParts = to.split(":");
    const fromHours = parseFloat(fromParts[0]) + parseFloat(fromParts[1] || 0) / 60;
    const toHours = parseFloat(toParts[0]) + parseFloat(toParts[1] || 0) / 60;
    return Math.max(0, toHours - fromHours);
  }

  // Helper: get required skill level for a slot
  function getSlotSkillReq(dow, from) {
    const fromHour = parseInt(from.split(":")[0], 10);
    const slotType = fromHour < 14 ? "morning" : "evening";
    return slotSkillReqs[`${dow}|${slotType}`] || null;
  }

  // Helper: check if user's skill level meets the requirement
  function meetsSkillReq(userId, requiredLevel) {
    if (!requiredLevel) return true;
    const userLevel = UserDirectory.getSkillLevel?.(userId) || "beginner";
    return (SKILL_ORDER[userLevel] || 0) >= (SKILL_ORDER[requiredLevel] || 0);
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

  // Collect all available slots (without assignment override, gaps, or explicit unassignments)
  const availableSlots = [];
  for (const slotKey of allSlots) {
    if (assignmentBySlot.has(slotKey)) continue; // Skip manual assignments
    if (unassignedSlots.has(slotKey)) continue; // Skip explicitly emptied slots
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

  // Count how many total slots each user is available for (used as tiebreaker)
  const availableSlotsCountByUser = new Map();
  for (const slot of availableSlots) {
    for (const userId of slot.candidates) {
      availableSlotsCountByUser.set(userId, (availableSlotsCountByUser.get(userId) || 0) + 1);
    }
  }

  // Sort slots: narrowest first (fewest candidates), then by dow, then by from
  const DOW_ORDER = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
  availableSlots.sort((a, b) => {
    const candDiff = a.candidates.length - b.candidates.length;
    if (candDiff !== 0) return candDiff; // Fewer candidates = higher priority
    const dowDiff = (DOW_ORDER[a.dow] || 999) - (DOW_ORDER[b.dow] || 999);
    if (dowDiff !== 0) return dowDiff;
    return a.from.localeCompare(b.from);
  });

  // Unified assignment: assign all slots to junior staff with balanced distribution
  // Slots are already sorted narrowest-first (fewest candidates).
  // For each slot, pick the junior candidate with the fewest hours, using
  // gap-to-minimum and availability scarcity as tiebreakers.
  const slotsForSeniors = [];
  for (const slot of availableSlots) {
    // Safety: filter out any UNAVAILABLE users that may have slipped through
    const unavailForSlot = unavailableBySlot.get(slot.slotKey);
    const safeCandidates = unavailForSlot
      ? slot.candidates.filter((u) => {
          if (unavailForSlot.has(u)) {
            debugSkipped.push({
              user_id: u,
              user_name: UserDirectory.getDisplayName(u),
              slot: slot.slotKey,
              reason: "UNAVAILABLE safety check (auto-assign)",
            });
            return false;
          }
          return true;
        })
      : slot.candidates;
    const juniorCandidates = safeCandidates.filter((u) => !seniorUsers.has(u));
    if (juniorCandidates.length === 0) {
      slotsForSeniors.push(slot);
      continue;
    }

    const requiredSkill = getSlotSkillReq(slot.dow, slot.from);
    juniorCandidates.sort((a, b) => {
      // 0. Skill level match: matching candidates first
      if (requiredSkill) {
        const matchA = meetsSkillReq(a, requiredSkill) ? 0 : 1;
        const matchB = meetsSkillReq(b, requiredSkill) ? 0 : 1;
        if (matchA !== matchB) return matchA - matchB;
      }
      const hoursA = assignedHoursByUser.get(a) || 0;
      const hoursB = assignedHoursByUser.get(b) || 0;
      // 1. Fewer assigned hours = higher priority
      if (hoursA !== hoursB) return hoursA - hoursB;
      // 2. Larger gap to minimum = higher priority
      const minA = minHoursRequirements.get(a) || 0;
      const minB = minHoursRequirements.get(b) || 0;
      const gapA = minA - hoursA;
      const gapB = minB - hoursB;
      if (gapB !== gapA) return gapB - gapA;
      // 3. Fewer available slots = harder to place later
      const slotsA = availableSlotsCountByUser.get(a) || 999;
      const slotsB = availableSlotsCountByUser.get(b) || 999;
      if (slotsA !== slotsB) return slotsA - slotsB;
      return a.localeCompare(b);
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
      reason: "balanced",
    });
  }

  // Phase 2.5: Rebalance to meet min_hours_per_week
  // Only swap if the employee needing more hours has FEWER total hours than the
  // current assignee (prevents stealing from less-loaded employees).
  const employeesNeedingMore = [...minHoursRequirements.entries()]
    .filter(([userId, minHours]) => {
      if (minHours <= 0) return false;
      const current = assignedHoursByUser.get(userId) || 0;
      return current < minHours;
    })
    .sort((a, b) => {
      const deficitA = a[1] - (assignedHoursByUser.get(a[0]) || 0);
      const deficitB = b[1] - (assignedHoursByUser.get(b[0]) || 0);
      return deficitB - deficitA;
    });

  for (const [empId, minHours] of employeesNeedingMore) {
    let currentHours = assignedHoursByUser.get(empId) || 0;
    if (currentHours >= minHours) continue;

    for (const slot of availableSlots) {
      if (currentHours >= minHours) break;
      if (!slot.candidates.includes(empId)) continue;

      const assignIdx = assignments.findIndex(
        (a) => a.dow === slot.dow && a.from === slot.from && a.to === slot.to
      );
      if (assignIdx === -1) continue;

      const currentAssignee = assignments[assignIdx].user_id;
      if (currentAssignee === empId) continue;

      const assigneeHours = assignedHoursByUser.get(currentAssignee) || 0;
      const assigneeMin = minHoursRequirements.get(currentAssignee) || 0;

      // Only swap if:
      // 1. Current assignee stays above their minimum after swap
      // 2. The employee needing hours has fewer hours than the assignee (fairness)
      if (assigneeHours - slot.hours >= assigneeMin && currentHours < assigneeHours) {
        assignments[assignIdx].user_id = empId;
        assignments[assignIdx].reason = "rebalance_min_hours";
        assignedHoursByUser.set(currentAssignee, assigneeHours - slot.hours);
        assignedHoursByUser.set(empId, currentHours + slot.hours);
        currentHours += slot.hours;
      }
    }
  }

  // Phase 3: Use seniors only for remaining empty slots (if enabled)
  const remainingSlots = slotsForSeniors.filter((slot) => {
    return !assignments.some(
      (a) => a.dow === slot.dow && a.from === slot.from && a.to === slot.to,
    );
  });

  for (const slot of remainingSlots) {
    // Safety: filter out UNAVAILABLE users for senior candidates too
    const unavailForSeniorSlot = unavailableBySlot.get(slot.slotKey);
    const seniorCandidates = seniorReserveEnabled
      ? slot.candidates.filter((u) => {
          if (unavailForSeniorSlot && unavailForSeniorSlot.has(u)) return false;
          return seniorUsers.has(u);
        })
      : [];
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

  // Track PROBLEM_SHIFT facts by slot key
  const problemShiftsBySlot = new Map(); // key: "dow|from|to", value: { user_id, reason, created_at }
  
  for (const fact of filteredFacts) {
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

    if (fact.fact_type === "PROBLEM_SHIFT") {
      const { dow, from, to, user_id: targetUserId, reason } = fact.fact_payload || {};
      if (dow && from && to) {
        const slotKey = `${dow}|${from}|${to}`;
        const factCreatedAt = new Date(fact.created_at || 0).getTime();
        const existing = problemShiftsBySlot.get(slotKey);
        const existingCreatedAt = existing ? new Date(existing.created_at).getTime() : 0;
        if (!existing || factCreatedAt > existingCreatedAt) {
          problemShiftsBySlot.set(slotKey, {
            user_id: targetUserId ? UserDirectory.normalizeUserId(targetUserId) : null,
            reason: reason || null,
            created_at: fact.created_at,
          });
        }
      }
    }
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

  // Compute locked status and today_dow based on weekStartISO
  const DOW_OFFSET = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();

  // Determine today_dow: which dow is "today" (or null if outside this week)
  let today_dow = null;
  if (weekStartISO) {
    const wsDate = new Date(weekStartISO + "T00:00:00");
    for (const d of DOW_LIST) {
      const slotDate = new Date(wsDate);
      slotDate.setDate(slotDate.getDate() + DOW_OFFSET[d]);
      slotDate.setHours(0, 0, 0, 0);
      if (slotDate.getTime() === todayTime) {
        today_dow = d;
        break;
      }
    }
  }

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
        // Get hours from template (configurable via settings)
        hours = getSlotHours(dow, slotType.name, hoursTemplate);
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

      // Override status to NEEDS_REPLACEMENT if slot is marked and not yet resolved by SHIFT_REPLACEMENT
      if (status !== "EMPTY" && needsReplacementBySlot.has(slotKey)) {
        if (!assignment?.replaced_user_id) {
          status = "NEEDS_REPLACEMENT";
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
      for (const fact of filteredFacts) {
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

      // Check PROBLEM_SHIFT facts for this slot
      const problemShift = problemShiftsBySlot.get(slotKey);
      if (problemShift && (!problemShift.user_id || problemShift.user_id === user_id)) {
        isProblematic = true;
        if (!problemReasons.includes("marked_by_admin")) {
          problemReasons.push("marked_by_admin");
        }
      }

      // Check if shift was a replacement (from gap that was closed)
      if (assignment) {
        // Check if there was a gap before this assignment
        for (const fact of filteredFacts) {
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

      // Get needs_replacement_for info if applicable
      const needsReplacement = needsReplacementBySlot.get(slotKey);

      // Check skill level mismatch
      let skillMismatch = null;
      if (user_id && status !== "EMPTY") {
        const reqSkill = getSlotSkillReq(dow, slotType.from);
        if (reqSkill && !meetsSkillReq(user_id, reqSkill)) {
          const userSkill = UserDirectory.getSkillLevel?.(user_id) || "beginner";
          skillMismatch = { required: reqSkill, actual: userSkill };
        }
      }

      // Compute locked: slot date < today
      let locked = false;
      if (weekStartISO) {
        const wsDate = new Date(weekStartISO + "T00:00:00");
        const slotDate = new Date(wsDate);
        slotDate.setDate(slotDate.getDate() + DOW_OFFSET[dow]);
        slotDate.setHours(0, 0, 0, 0);
        locked = slotDate.getTime() < todayTime;
      }

      slots.push({
        dow,
        slot_name: slotType.name,
        from: slotType.from,
        to: slotType.to,
        user_id,
        replaced_user_id: assignment?.replaced_user_id || null,
        needs_replacement_for: (status === "NEEDS_REPLACEMENT" && needsReplacement)
          ? needsReplacement.original_user_id
          : null,
        hours,
        status,
        locked,
        has_problem: hasProblem,
        is_problematic: isProblematic,
        is_problem: !!problemShift,
        problem_reason: problemShift?.reason || null,
        problem_reasons: problemReasons,
        skill_mismatch: skillMismatch,
        available_user_ids: Array.from(allAvailableBySlot.get(`${dow}|${slotType.from}|${slotType.to}`) || []),
        unavailable_user_ids: Array.from(unavailableBySlot.get(`${dow}|${slotType.from}|${slotType.to}`) || []),
      });
    }
  }

  // Build cleaning assignments: by default, evening shift user cleans
  const cleaningAssignments = [];
  const cleaningSwapByDow = new Map(); // dow -> { original_user_id, replacement_user_id }
  const cleaningHelpByDow = new Map(); // dow -> { user_id, created_at } — who needs help

  // Helper: check if a fact's date falls within the current week
  // Used to prevent cross-week bleeding of CLEANING_SWAP / CLEANING_HELP_REQUEST facts
  function isFactInWeek(fact) {
    if (!weekStartISO) return true; // no week context → include all
    const factDate = fact.fact_payload?.date;
    if (!factDate) return true; // no date → include (backward compat)
    const ws = new Date(weekStartISO + "T00:00:00");
    const we = new Date(ws);
    we.setDate(we.getDate() + 6);
    const fd = new Date(factDate + "T00:00:00");
    return fd >= ws && fd <= we;
  }

  // Collect CLEANING_SWAP facts (only for the current week)
  // Deduplication: group by dow, keep only the LATEST fact per day
  // (by created_at, with fallback to fact.id for deterministic ordering)
  for (const fact of filteredFacts) {
    if (fact.fact_type === "CLEANING_SWAP") {
      const { dow, original_user_id, replacement_user_id } = fact.fact_payload || {};
      if (!dow) continue;
      // Filter: only include facts whose date belongs to this week
      if (!isFactInWeek(fact)) continue;
      const factCreatedAt = new Date(fact.created_at || 0).getTime();
      const factId = fact.id || 0;
      const existing = cleaningSwapByDow.get(dow);
      const existingCreatedAt = existing ? new Date(existing.created_at || 0).getTime() : 0;
      const existingId = existing?.fact_id || 0;
      // Keep latest: compare by created_at first, then by id as tiebreaker
      const isNewer = factCreatedAt > existingCreatedAt ||
        (factCreatedAt === existingCreatedAt && factId > existingId);
      if (!existing || isNewer) {
        cleaningSwapByDow.set(dow, {
          // original_user_id: who was supposed to clean (null = default evening user)
          original_user_id: original_user_id ? UserDirectory.normalizeUserId(original_user_id) : null,
          // replacement_user_id: who will clean instead (falls back to fact.user_id for volunteer offers)
          replacement_user_id: replacement_user_id ? UserDirectory.normalizeUserId(replacement_user_id) : (fact.user_id ? UserDirectory.normalizeUserId(fact.user_id) : null),
          created_at: fact.created_at,
          fact_id: factId,
        });
      }
    } else if (fact.fact_type === "CLEANING_HELP_REQUEST") {
      const { dow } = fact.fact_payload || {};
      if (!dow) continue;
      // Filter: only include facts whose date belongs to this week
      if (!isFactInWeek(fact)) continue;
      const factCreatedAt = new Date(fact.created_at || 0).getTime();
      const existing = cleaningHelpByDow.get(dow);
      const existingCreatedAt = existing ? new Date(existing.created_at || 0).getTime() : 0;
      if (!existing || factCreatedAt > existingCreatedAt) {
        cleaningHelpByDow.set(dow, {
          user_id: UserDirectory.normalizeUserId(fact.user_id),
          created_at: fact.created_at,
        });
      }
    }
  }

  // Determine evening slot times from configured slot types (not hardcoded)
  const eveningSlotType = SLOT_TYPES.find(st => st.name === "Вечер");
  const eveningFrom = eveningSlotType ? eveningSlotType.from : "18:00";
  const eveningTo = eveningSlotType ? eveningSlotType.to : "21:00";

  // Load cleaning_schedule from settings (which days/slots have scheduled cleaning)
  const cleaningSchedule = settings?.["cleaning_schedule"] || {
    mon: { morning: false, evening: true },
    tue: { morning: false, evening: true },
    wed: { morning: false, evening: true },
    thu: { morning: false, evening: true },
    fri: { morning: false, evening: true },
    sat: { morning: false, evening: true },
    sun: { morning: false, evening: false },
  };

  // For each day, find the evening assignment and create cleaning assignment
  const DOW_ALL = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  for (const dow of DOW_ALL) {
    // Check if evening cleaning is scheduled for this day
    const isCleaningScheduled = cleaningSchedule[dow]?.evening !== false;
    const swap = cleaningSwapByDow.get(dow);
    const helpRequest = cleaningHelpByDow.get(dow);

    // If not scheduled AND no facts exist for this day → skip
    if (!isCleaningScheduled && !swap && !helpRequest) continue;

    const eveningAssignment = assignments.find(
      (a) => a.dow === dow && a.from === eveningFrom && a.to === eveningTo
    );

    // For unscheduled days without an evening assignment, we still process if facts exist
    const defaultUserId = eveningAssignment?.user_id || null;
    let cleaningUserId = defaultUserId;
    let isReplacement = false;
    let cleaningStatus = isCleaningScheduled ? "ASSIGNED" : "UNSCHEDULED";
    let cleaningOriginalUserId = null;
    let cleaningReplacementUserId = null;
    let cleaningUnscheduled = !isCleaningScheduled;

    if (swap && swap.replacement_user_id) {
      // Check if swap resolves a help request (replacement differs from default)
      cleaningUserId = swap.replacement_user_id;
      isReplacement = true;
      cleaningOriginalUserId = swap.original_user_id || defaultUserId;
      cleaningReplacementUserId = swap.replacement_user_id;
      cleaningStatus = cleaningUnscheduled ? "UNSCHEDULED_REPLACED" : "REPLACED";
    } else if (helpRequest && helpRequest.user_id === defaultUserId) {
      // Default cleaner asked for help, no swap yet → NEEDS_REPLACEMENT
      cleaningStatus = "NEEDS_REPLACEMENT";
      cleaningOriginalUserId = defaultUserId;
    }

    cleaningAssignments.push({
      dow,
      user_id: cleaningUserId,
      default_user_id: defaultUserId,
      is_replacement: isReplacement,
      cleaning_status: cleaningStatus,
      cleaning_original_user_id: cleaningOriginalUserId,
      cleaning_replacement_user_id: cleaningReplacementUserId,
      cleaning_unscheduled: cleaningUnscheduled,
    });
  }

  // Also set cleaning fields on ALL evening slots (even empty ones)
  for (const slot of slots) {
    if (slot.slot_name === "Вечер") {
      const isScheduled = cleaningSchedule[slot.dow]?.evening !== false;
      const ca = cleaningAssignments.find((c) => c.dow === slot.dow);
      if (ca) {
        slot.cleaning_user_id = ca.user_id;
        slot.cleaning_is_replacement = ca.is_replacement;
        slot.cleaning_status = ca.cleaning_status;
        slot.cleaning_original_user_id = ca.cleaning_original_user_id;
        slot.cleaning_replacement_user_id = ca.cleaning_replacement_user_id;
        slot.cleaning_scheduled = !ca.cleaning_unscheduled;
        slot.cleaning_unscheduled = ca.cleaning_unscheduled || false;
      } else if (!isScheduled || !slot.user_id) {
        // Cleaning not scheduled for this day, or no evening user assigned
        slot.cleaning_user_id = null;
        slot.cleaning_is_replacement = false;
        slot.cleaning_status = isScheduled ? "UNASSIGNED" : "NOT_SCHEDULED";
        slot.cleaning_original_user_id = null;
        slot.cleaning_replacement_user_id = null;
        slot.cleaning_scheduled = isScheduled;
        slot.cleaning_unscheduled = false;
      } else {
        // Scheduled + has evening user = default assignment
        slot.cleaning_user_id = slot.user_id;
        slot.cleaning_is_replacement = false;
        slot.cleaning_status = "ASSIGNED";
        slot.cleaning_original_user_id = null;
        slot.cleaning_replacement_user_id = null;
        slot.cleaning_scheduled = true;
        slot.cleaning_unscheduled = false;
      }
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
    today_dow,
    assignments,
    gaps,
    conflicts,
    slots,
    cleaning_assignments: cleaningAssignments,
    debug: {
      skipped: debugSkipped,
    },
    meta: {
      facts_count: filteredFacts.length,
      slots_count: allSlots.size,
      candidates_count: allCandidateUserIds.size,
      assigned_slots_count: assignmentBySlot.size,
      engine: "v0",
    },
  };
}
