/**
 * Week State Engine v0
 *
 * Simplified state machine aligned with real business process:
 *   COLLECTING — bot collects availability from employees
 *   ACTIVE     — schedule is built and live (replacements handled automatically)
 *   CLOSED     — week is over, data ready for salary calculation
 *
 * Transitions:
 *   (none)     → COLLECTING : WEEK_OPEN command
 *   COLLECTING → ACTIVE     : schedule built (SCHEDULE_BUILT fact or BUILD_SCHEDULE command)
 *   ACTIVE     → ACTIVE     : replacements, corrections (don't change state)
 *   ACTIVE     → CLOSED     : WEEK_CLOSE command or automatic when week passes
 *   any        → COLLECTING : WEEK_OPEN re-opens collection
 */

function slotKey(dow, from, to) {
  return `${dow}|${from}|${to}`;
}

/**
 * @param {Object} params
 * @param {Array} params.facts - Array of persisted facts from database (already filtered to week)
 * @param {string} params.weekStartISO - ISO date string for Monday of the week (YYYY-MM-DD)
 * @returns {Object} - { week_start, state, required_actions, gaps_open, last_commands, ... }
 */
export function computeWeekState({ facts, weekStartISO }) {
  const weekFacts = (facts || []).sort((a, b) => {
    const aTime = new Date(a.created_at || 0).getTime();
    const bTime = new Date(b.created_at || 0).getTime();
    return aTime - bTime;
  });

  // Extract state-related facts
  const weekOpens = weekFacts.filter((f) => f.fact_type === "WEEK_OPEN");
  const scheduleBuilts = weekFacts.filter(
    (f) => f.fact_type === "SCHEDULE_BUILT" || f.fact_type === "WEEK_PROPOSE",
  );
  const weekCloses = weekFacts.filter(
    (f) => f.fact_type === "WEEK_CLOSE" || f.fact_type === "WEEK_LOCK",
  );
  const gaps = weekFacts.filter((f) => f.fact_type === "SHIFT_GAP");
  const assignments = weekFacts.filter((f) => f.fact_type === "SHIFT_ASSIGNMENT");

  // Find timestamps of last commands
  const lastOpenTs =
    weekOpens.length > 0
      ? new Date(weekOpens[weekOpens.length - 1].created_at || 0).getTime()
      : null;
  const lastBuiltTs =
    scheduleBuilts.length > 0
      ? new Date(scheduleBuilts[scheduleBuilts.length - 1].created_at || 0).getTime()
      : null;
  const lastCloseTs =
    weekCloses.length > 0
      ? new Date(weekCloses[weekCloses.length - 1].created_at || 0).getTime()
      : null;

  // Find the latest command timestamp
  const commandTimestamps = [lastOpenTs, lastBuiltTs, lastCloseTs].filter(
    (ts) => ts !== null,
  );
  const lastCommandTs = commandTimestamps.length > 0 ? Math.max(...commandTimestamps) : null;

  // Build gaps map: for each slot, find last GAP and last ASSIGN
  const gapsMap = new Map();
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

  // Determine open gaps
  const gapsOpen = [];
  for (const [, entry] of gapsMap.entries()) {
    if (
      entry.lastGapTs !== null &&
      (entry.lastAssignTs === null || entry.lastAssignTs < entry.lastGapTs)
    ) {
      gapsOpen.push({ dow: entry.dow, from: entry.from, to: entry.to });
    }
  }

  // Determine state: latest-command-wins with 3 states
  let state = "COLLECTING"; // Default: always collecting until schedule is built
  if (lastCloseTs !== null && lastCommandTs === lastCloseTs) {
    state = "CLOSED";
  } else if (lastBuiltTs !== null && lastCommandTs === lastBuiltTs) {
    state = "ACTIVE";
  } else if (lastOpenTs !== null && lastCommandTs === lastOpenTs) {
    state = "COLLECTING";
  }

  // Required actions
  const requiredActions = [];
  if (gapsOpen.length > 0) {
    requiredActions.push("uncovered shifts — replacement needed");
  }

  // Last commands (timestamps)
  const lastCommands = {};
  if (lastOpenTs !== null) {
    lastCommands.open = weekOpens[weekOpens.length - 1].created_at;
  }
  if (lastBuiltTs !== null) {
    lastCommands.built = scheduleBuilts[scheduleBuilts.length - 1].created_at;
  }
  if (lastCloseTs !== null) {
    lastCommands.close = weekCloses[weekCloses.length - 1].created_at;
  }

  // Problem flags
  const hasGaps = gapsOpen.length > 0;
  const hasProblem = hasGaps;

  return {
    week_start: weekStartISO,
    state,
    required_actions: requiredActions,
    gaps_open: gapsOpen,
    last_commands: lastCommands,
    hasGaps,
    hasProblem,
  };
}
