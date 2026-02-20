/**
 * Week State Engine v0
 * 
 * Computes week state from facts (DRAFT, COLLECTING, PROPOSED, CONFIRMING, LOCKED, EMERGENCY)
 * Uses "latest-command-wins" logic: the most recent command determines the state.
 */

/**
 * Helper: generate slot key
 */
function slotKey(dow, from, to) {
  return `${dow}|${from}|${to}`;
}

/**
 * @param {Object} params
 * @param {Array} params.facts - Array of persisted facts from database (already filtered to week)
 * @param {string} params.weekStartISO - ISO date string for Monday of the week (YYYY-MM-DD)
 * @returns {Object} - { week_start, state, required_actions, gaps_open, last_commands }
 */
export function computeWeekState({ facts, weekStartISO }) {
  const weekFacts = (facts || []).sort((a, b) => {
    const aTime = new Date(a.created_at || 0).getTime();
    const bTime = new Date(b.created_at || 0).getTime();
    return aTime - bTime;
  });

  // Extract state-related facts
  const weekLocks = weekFacts.filter((f) => f.fact_type === "WEEK_LOCK");
  const weekOpens = weekFacts.filter((f) => f.fact_type === "WEEK_OPEN");
  const weekProposes = weekFacts.filter((f) => f.fact_type === "WEEK_PROPOSE");
  const weekConfirms = weekFacts.filter((f) => f.fact_type === "WEEK_CONFIRM");
  const gaps = weekFacts.filter((f) => f.fact_type === "SHIFT_GAP");
  const assignments = weekFacts.filter((f) => f.fact_type === "SHIFT_ASSIGNMENT");
  const approvals = weekFacts.filter((f) => f.fact_type === "OWNER_APPROVAL");

  // Find timestamps of last commands
  const lastOpenTs =
    weekOpens.length > 0
      ? new Date(weekOpens[weekOpens.length - 1].created_at || 0).getTime()
      : null;
  const lastProposeTs =
    weekProposes.length > 0
      ? new Date(weekProposes[weekProposes.length - 1].created_at || 0).getTime()
      : null;
  const lastConfirmTs =
    weekConfirms.length > 0
      ? new Date(weekConfirms[weekConfirms.length - 1].created_at || 0).getTime()
      : null;
  const lastLockTs =
    weekLocks.length > 0
      ? new Date(weekLocks[weekLocks.length - 1].created_at || 0).getTime()
      : null;

  // Find the latest command timestamp
  const commandTimestamps = [lastOpenTs, lastProposeTs, lastConfirmTs, lastLockTs].filter(
    (ts) => ts !== null,
  );
  const lastCommandTs = commandTimestamps.length > 0 ? Math.max(...commandTimestamps) : null;

  // Build gaps map: for each slot, find last GAP and last ASSIGN
  const gapsMap = new Map(); // key: slotKey, value: { dow, from, to, lastGapTs, lastAssignTs }
  for (const gap of gaps) {
    const { dow, from, to } = gap.fact_payload || {};
    if (!dow || !from || !to) continue;

    const key = slotKey(dow, from, to);
    const gapTime = new Date(gap.created_at || 0).getTime();

    if (!gapsMap.has(key)) {
      gapsMap.set(key, { dow, from, to, lastGapTs: gapTime, lastAssignTs: null });
    } else {
      const entry = gapsMap.get(key);
      if (gapTime > entry.lastGapTs) {
        entry.lastGapTs = gapTime;
      }
    }
  }

  // Find last assignment for each slot
  for (const assign of assignments) {
    const { dow, from, to } = assign.fact_payload || {};
    if (!dow || !from || !to) continue;

    const key = slotKey(dow, from, to);
    const assignTime = new Date(assign.created_at || 0).getTime();

    if (!gapsMap.has(key)) {
      gapsMap.set(key, { dow, from, to, lastGapTs: null, lastAssignTs: assignTime });
    } else {
      const entry = gapsMap.get(key);
      if (entry.lastAssignTs === null || assignTime > entry.lastAssignTs) {
        entry.lastAssignTs = assignTime;
      }
    }
  }

  // Determine open gaps: gap is open if lastGapTs exists and (lastAssignTs is null or lastAssignTs < lastGapTs)
  const gapsOpen = [];
  for (const [key, entry] of gapsMap.entries()) {
    if (
      entry.lastGapTs !== null &&
      (entry.lastAssignTs === null || entry.lastAssignTs < entry.lastGapTs)
    ) {
      gapsOpen.push({ dow: entry.dow, from: entry.from, to: entry.to });
    }
  }

  // Determine state: latest-command-wins
  // EMERGENCY (open gaps) takes priority over any command state
  let state = "DRAFT";
  if (gapsOpen.length > 0) {
    state = "EMERGENCY";
  } else if (lastLockTs !== null && lastCommandTs === lastLockTs) {
    state = "LOCKED";
  } else if (lastConfirmTs !== null && lastCommandTs === lastConfirmTs) {
    state = "CONFIRMING";
  } else if (lastProposeTs !== null && lastCommandTs === lastProposeTs) {
    state = "PROPOSED";
  } else if (lastOpenTs !== null && lastCommandTs === lastOpenTs) {
    state = "COLLECTING";
  }

  // Required actions
  const requiredActions = [];
  if (state === "EMERGENCY" && gapsOpen.length > 0) {
    requiredActions.push("senior assignment required for gaps");
  }
  if (state === "PROPOSED") {
    requiredActions.push("confirmations required");
  }
  // Check if assignments need approval
  for (const assign of assignments) {
    const { dow, from, to } = assign.fact_payload || {};
    if (!dow || !from || !to) continue;
    const assignSlot = slotKey(dow, from, to);
    const assignTime = new Date(assign.created_at || 0).getTime();

    // Check if there's an approval for this slot AFTER the assignment
    const hasApproval = approvals.some((a) => {
      const { dow: aDow, from: aFrom, to: aTo } = a.fact_payload || {};
      if (!aDow || !aFrom || !aTo) return false;
      if (slotKey(aDow, aFrom, aTo) !== assignSlot) return false;
      const approvalTime = new Date(a.created_at || 0).getTime();
      return approvalTime > assignTime;
    });

    if (!hasApproval) {
      requiredActions.push("owner approval required");
      break; // Only add once
    }
  }

  // Last commands (timestamps)
  const lastCommands = {};
  if (lastOpenTs !== null) {
    lastCommands.open = weekOpens[weekOpens.length - 1].created_at;
  }
  if (lastProposeTs !== null) {
    lastCommands.propose = weekProposes[weekProposes.length - 1].created_at;
  }
  if (lastConfirmTs !== null) {
    lastCommands.confirm = weekConfirms[weekConfirms.length - 1].created_at;
  }
  if (lastLockTs !== null) {
    lastCommands.lock = weekLocks[weekLocks.length - 1].created_at;
  }

  // Compute hasProblem flags (basic version, will be enhanced in server.js with schedule data)
  const hasGaps = gapsOpen.length > 0;
  const hasUnconfirmed = false; // Will be computed from schedule in server.js
  const hasEmergency = state === "EMERGENCY";
  const hasProblem = hasGaps || hasUnconfirmed || hasEmergency;

  return {
    week_start: weekStartISO,
    state,
    required_actions: requiredActions,
    gaps_open: gapsOpen,
    last_commands: lastCommands,
    hasGaps,
    hasUnconfirmed,
    hasEmergency,
    hasProblem,
  };
}
