// v0 deterministic parser for chat events -> structured facts.
// No LLM, only regex / rule-based parsing.

import { UserDirectory } from "./userDirectory.js";

// Helper: get local date in Europe/Berlin as YYYY-MM-DD
function getBerlinDateFromIso(isoString) {
  const date = new Date(isoString);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date); // YYYY-MM-DD
}

// Helper: add days in Europe/Berlin
function addDaysBerlin(isoString, days) {
  const date = new Date(isoString);
  date.setUTCDate(date.getUTCDate() + days);
  return getBerlinDateFromIso(date.toISOString());
}

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

function nextWeekdayBerlin(isoString, targetIndex) {
  const date = new Date(isoString);
  let day = date.getUTCDay(); // 0..6, Sunday=0
  if (day === 0) day = 7; // make Monday=1..Sunday=7
  let diff = targetIndex + 1 - day;
  if (diff <= 0) diff += 7;
  return addDaysBerlin(isoString, diff);
}

// Resolve day-of-week to the same Mon–Sun week as receivedAt.
// Used for reporting facts (CLEANING_DONE, EXTRA_CLASS) where the user
// references a day within the current work week, even if it's in the past.
function sameWeekdayBerlin(isoString, targetIndex) {
  const date = new Date(isoString);
  let day = date.getUTCDay(); // 0..6, Sunday=0
  if (day === 0) day = 7; // Monday=1..Sunday=7
  const diff = (targetIndex + 1) - day; // range: -6..+6
  return addDaysBerlin(isoString, diff);
}

function parseTimeWindow(text) {
  const re = /с\s*(\d{1,2})(?:[:\.](\d{2}))?\s*до\s*(\d{1,2})(?:[:\.](\d{2}))?/i;
  const m = text.match(re);
  if (!m) return null;
  const h1 = m[1].padStart(2, "0");
  const m1 = (m[2] || "00").padStart(2, "0");
  const h2 = m[3].padStart(2, "0");
  const m2 = (m[4] || "00").padStart(2, "0");
  return { from: `${h1}:${m1}`, to: `${h2}:${m2}` };
}

function resolveDate(text, receivedAt) {
  const lower = text.toLowerCase();
  const baseIso = receivedAt;

  if (lower.includes("сегодня")) {
    return getBerlinDateFromIso(baseIso);
  }
  if (lower.includes("завтра")) {
    return addDaysBerlin(baseIso, 1);
  }
  if (lower.includes("послезавтра")) {
    return addDaysBerlin(baseIso, 2);
  }

  for (let i = 0; i < WEEKDAYS.length; i += 1) {
    const token = WEEKDAYS[i];
    if (lower.includes(token)) {
      return nextWeekdayBerlin(baseIso, i);
    }
  }

  return getBerlinDateFromIso(baseIso);
}

function detectShift(text) {
  const lower = text.toLowerCase();
  if (lower.includes("утро")) return "morning";
  if (lower.includes("вечер")) return "evening";
  if (lower.includes("день") || lower.includes("днём") || lower.includes("днем")) return "day";
  return null;
}

// Map weekday abbreviations to indices (0=Monday, 6=Sunday)
const DOW_MAP = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

function parseCommandFormat(text, receivedAt) {
  const results = [];
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();

  // AVAIL [YYYY-MM-DD?] <dow> <from>-<to>
  // Example: "AVAIL mon 10-13" or "AVAIL 2026-02-23 mon 10-13" -> SHIFT_AVAILABILITY
  const availMatch1 = upper.match(/^AVAIL\s+(\d{4}-\d{2}-\d{2})\s+(mon|tue|wed|thu|fri|sat|sun)\s+(\d{1,2})-(\d{1,2})$/i);
  const availMatch2 = upper.match(/^AVAIL\s+(mon|tue|wed|thu|fri|sat|sun)\s+(\d{1,2})-(\d{1,2})$/i);
  const availMatchAny = availMatch1 || availMatch2;
  if (availMatchAny) {
    let weekStart, dow, fromHour, toHour;
    if (availMatch1) {
      weekStart = availMatch1[1];
      dow = availMatch1[2].toLowerCase();
      fromHour = availMatch1[3].padStart(2, "0");
      toHour = availMatch1[4].padStart(2, "0");
    } else {
      weekStart = null;
      dow = availMatch2[1].toLowerCase();
      fromHour = availMatch2[2].padStart(2, "0");
      toHour = availMatch2[3].padStart(2, "0");
    }
    let date;
    if (weekStart) {
      date = addDaysBerlin(weekStart + "T00:00:00Z", DOW_MAP[dow]);
    } else {
      date = nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
    }
    results.push({
      fact_type: "SHIFT_AVAILABILITY",
      fact_payload: {
        week_start: weekStart,
        date,
        dow,
        from: `${fromHour}:00`,
        to: `${toHour}:00`,
        availability: "can",
        notes: text,
      },
      confidence: 1.0,
    });
    return results; // Command format takes priority
  }

  // CANT [YYYY-MM-DD?] <dow> <from>-<to>
  // Example: "CANT thu 18-21" or "CANT 2026-02-23 thu 18-21" -> SHIFT_UNAVAILABILITY
  const cantMatch1 = upper.match(/^CANT\s+(\d{4}-\d{2}-\d{2})\s+(\w+)\s+(\d{1,2})-(\d{1,2})$/);
  const cantMatch2 = upper.match(/^CANT\s+(\w+)\s+(\d{1,2})-(\d{1,2})$/);
  const cantMatchAny = cantMatch1 || cantMatch2;
  if (cantMatchAny) {
    let weekStart, dow, fromHour, toHour;
    if (cantMatch1) {
      weekStart = cantMatch1[1];
      dow = cantMatch1[2].toLowerCase();
      fromHour = cantMatch1[3].padStart(2, "0");
      toHour = cantMatch1[4].padStart(2, "0");
    } else {
      weekStart = null;
      dow = cantMatch2[1].toLowerCase();
      fromHour = cantMatch2[2].padStart(2, "0");
      toHour = cantMatch2[3].padStart(2, "0");
    }
    if (DOW_MAP[dow] !== undefined) {
      let date;
      if (weekStart) {
        date = addDaysBerlin(weekStart + "T00:00:00Z", DOW_MAP[dow]);
      } else {
        date = nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
      }
      results.push({
        fact_type: "SHIFT_UNAVAILABILITY",
        fact_payload: {
          week_start: weekStart,
          date,
          dow,
          from: `${fromHour}:00`,
          to: `${toHour}:00`,
          availability: "cannot",
          notes: text,
        },
        confidence: 0.95,
      });
    }
    return results;
  }

  // SWAP <dow> <from>-<to> WITH <user_id>
  // Example: "SWAP mon 10-13 WITH isa" -> SHIFT_SWAP_REQUEST
  const swapMatch = upper.match(/^SWAP\s+(\w+)\s+(\d{1,2})-(\d{1,2})\s+WITH\s+(\w+)$/);
  if (swapMatch) {
    const dow = swapMatch[1].toLowerCase();
    const fromHour = swapMatch[2].padStart(2, "0");
    const toHour = swapMatch[3].padStart(2, "0");
    const targetUserId = swapMatch[4].toLowerCase();
    if (DOW_MAP[dow] !== undefined) {
      const date = nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
      results.push({
        fact_type: "SHIFT_SWAP_REQUEST",
        fact_payload: {
          from: { date, dow, from: `${fromHour}:00`, to: `${toHour}:00` },
          target_user_id: targetUserId,
          status: "requested",
          notes: text,
        },
        confidence: 0.95,
      });
    }
    return results;
  }

  // GAP <dow> <from>-<to>
  // Example: "GAP thu 18-21" -> SHIFT_GAP
  const gapMatch = upper.match(/^GAP\s+(mon|tue|wed|thu|fri|sat|sun)\s+(\d{1,2})-(\d{1,2})$/i);
  if (gapMatch) {
    const dow = gapMatch[1].toLowerCase();
    const fromHour = gapMatch[2].padStart(2, "0");
    const toHour = gapMatch[3].padStart(2, "0");
    const date = nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
    results.push({
      fact_type: "SHIFT_GAP",
      fact_payload: {
        date,
        dow,
        from: `${fromHour}:00`,
        to: `${toHour}:00`,
        urgency: "high",
        notes: text,
      },
      confidence: 1.0,
    });
    return results;
  }

  // CONFIRM [YYYY-MM-DD?] - general confirmation (legacy)
  const confirmMatch = upper.match(/^CONFIRM(?:\s+(\d{4}-\d{2}-\d{2}))?$/);
  if (confirmMatch) {
    const weekStart = confirmMatch[1] || null;
    results.push({
      fact_type: "WEEK_CONFIRM",
      fact_payload: { week_start: weekStart, notes: text },
      confidence: 1.0,
    });
    return results;
  }

  // CONFIRM_SCHEDULE [YYYY-MM-DD?] - confirm all assigned shifts for the user
  const confirmScheduleMatch = upper.match(/^CONFIRM_SCHEDULE(?:\s+(\d{4}-\d{2}-\d{2}))?$/);
  if (confirmScheduleMatch) {
    const weekStart = confirmScheduleMatch[1] || null;
    results.push({
      fact_type: "SCHEDULE_CONFIRMED",
      fact_payload: { week_start: weekStart, notes: text },
      confidence: 1.0,
    });
    return results;
  }

  // REPORT_PROBLEM [YYYY-MM-DD?] [message?] - report problem with schedule
  const reportProblemMatch = upper.match(/^REPORT_PROBLEM(?:\s+(\d{4}-\d{2}-\d{2}))?(?:\s+(.+))?$/);
  if (reportProblemMatch) {
    const weekStart = reportProblemMatch[1] || null;
    const message = reportProblemMatch[2] || null;
    results.push({
      fact_type: "SCHEDULE_PROBLEM",
      fact_payload: { week_start: weekStart, problem_message: message, notes: text },
      confidence: 1.0,
    });
    return results;
  }

  // MARK_SHIFT_PROBLEM [YYYY-MM-DD?] <dow> <from>-<to> - admin marks a shift as problematic
  const markShiftProblemMatch = upper.match(/^MARK_SHIFT_PROBLEM(?:\s+(\d{4}-\d{2}-\d{2}))?\s+(\w+)\s+(\d{1,2})-(\d{1,2})$/);
  if (markShiftProblemMatch) {
    const weekStart = markShiftProblemMatch[1] || null;
    const dow = markShiftProblemMatch[2].toLowerCase();
    const fromHour = markShiftProblemMatch[3].padStart(2, "0");
    const toHour = markShiftProblemMatch[4].padStart(2, "0");
    if (DOW_MAP[dow] !== undefined) {
      let date;
      if (weekStart) {
        date = addDaysBerlin(weekStart + "T00:00:00Z", DOW_MAP[dow]);
      } else {
        date = nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
      }
      results.push({
        fact_type: "SHIFT_MARKED_PROBLEM",
        fact_payload: {
          week_start: weekStart,
          date,
          dow,
          from: `${fromHour}:00`,
          to: `${toHour}:00`,
          notes: text,
        },
        confidence: 1.0,
      });
      return results;
    }
  }

  // PROBLEM [YYYY-MM-DD?] <dow> <from>-<to> <user_id> [reason]
  // Example: "PROBLEM mon 10-13 u1 late" -> PROBLEM_SHIFT
  const problemMatch1 = upper.match(/^PROBLEM\s+(\d{4}-\d{2}-\d{2})\s+(\w+)\s+(\d{1,2})-(\d{1,2})\s+(\w+)(?:\s+(.+))?$/);
  const problemMatch2 = upper.match(/^PROBLEM\s+(\w+)\s+(\d{1,2})-(\d{1,2})\s+(\w+)(?:\s+(.+))?$/);
  const problemMatch = problemMatch1 || problemMatch2;
  if (problemMatch) {
    let weekStart, dow, fromHour, toHour, userId, reason;
    if (problemMatch1) {
      weekStart = problemMatch1[1];
      dow = problemMatch1[2].toLowerCase();
      fromHour = problemMatch1[3].padStart(2, "0");
      toHour = problemMatch1[4].padStart(2, "0");
      userId = problemMatch1[5].toLowerCase();
      reason = problemMatch1[6] || null;
    } else {
      weekStart = null;
      dow = problemMatch2[1].toLowerCase();
      fromHour = problemMatch2[2].padStart(2, "0");
      toHour = problemMatch2[3].padStart(2, "0");
      userId = problemMatch2[4].toLowerCase();
      reason = problemMatch2[5] || null;
    }
    if (DOW_MAP[dow] !== undefined) {
      let date;
      if (weekStart) {
        date = addDaysBerlin(weekStart + "T00:00:00Z", DOW_MAP[dow]);
      } else {
        date = nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
      }
      results.push({
        fact_type: "PROBLEM_SHIFT",
        fact_payload: {
          week_start: weekStart,
          date,
          dow,
          from: `${fromHour}:00`,
          to: `${toHour}:00`,
          user_id: userId,
          reason: reason?.toLowerCase() || null,
          notes: text,
        },
        confidence: 1.0,
      });
      return results;
    }
  }

  // CONFIRM_SHIFT_FACT [YYYY-MM-DD?] <dow> <from>-<to> [ok|problem] - confirm shift fact (ok = plan=fact, problem = needs adjustment)
  const confirmShiftFactMatch = upper.match(/^CONFIRM_SHIFT_FACT(?:\s+(\d{4}-\d{2}-\d{2}))?\s+(\w+)\s+(\d{1,2})-(\d{1,2})\s+(OK|PROBLEM)(?:\s+(.+))?$/);
  if (confirmShiftFactMatch) {
    const weekStart = confirmShiftFactMatch[1] || null;
    const dow = confirmShiftFactMatch[2].toLowerCase();
    const fromHour = confirmShiftFactMatch[3].padStart(2, "0");
    const toHour = confirmShiftFactMatch[4].padStart(2, "0");
    const status = confirmShiftFactMatch[5].toLowerCase();
    const reason = confirmShiftFactMatch[6]?.toLowerCase() || null;
    if (DOW_MAP[dow] !== undefined) {
      let date;
      if (weekStart) {
        date = addDaysBerlin(weekStart + "T00:00:00Z", DOW_MAP[dow]);
      } else {
        date = nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
      }
      results.push({
        fact_type: "SHIFT_FACT_CONFIRMED",
        fact_payload: {
          week_start: weekStart,
          date,
          dow,
          from: `${fromHour}:00`,
          to: `${toHour}:00`,
          status, // "ok" or "problem"
          reason,
          notes: text,
        },
        confidence: 1.0,
      });
      return results;
    }
  }

  // OPEN_WEEK YYYY-MM-DD
  const openWeekMatch = upper.match(/^OPEN_WEEK\s+(\d{4}-\d{2}-\d{2})$/);
  if (openWeekMatch) {
    results.push({
      fact_type: "WEEK_OPEN",
      fact_payload: { week_start: openWeekMatch[1], notes: text },
      confidence: 1.0,
    });
    return results;
  }

  // PROPOSE [YYYY-MM-DD?]
  const proposeMatch = upper.match(/^PROPOSE(?:\s+(\d{4}-\d{2}-\d{2}))?$/);
  if (proposeMatch) {
    const weekStart = proposeMatch[1] || null;
    results.push({
      fact_type: "WEEK_PROPOSE",
      fact_payload: { week_start: weekStart, notes: text },
      confidence: 1.0,
    });
    return results;
  }

  // LOCK [YYYY-MM-DD?]
  const lockMatch = upper.match(/^LOCK(?:\s+(\d{4}-\d{2}-\d{2}))?$/);
  if (lockMatch) {
    const weekStart = lockMatch[1] || null;
    results.push({
      fact_type: "WEEK_LOCK",
      fact_payload: { week_start: weekStart, notes: text },
      confidence: 1.0,
    });
    return results;
  }

  // DECLARE_GAP [YYYY-MM-DD?] <dow> <from>-<to>
  const declareGapMatch1 = upper.match(/^DECLARE_GAP\s+(\d{4}-\d{2}-\d{2})\s+(\w+)\s+(\d{1,2})-(\d{1,2})$/);
  const declareGapMatch2 = upper.match(/^DECLARE_GAP\s+(\w+)\s+(\d{1,2})-(\d{1,2})$/);
  const declareGapMatch = declareGapMatch1 || declareGapMatch2;
  if (declareGapMatch) {
    let weekStart, dow, fromHour, toHour;
    if (declareGapMatch1) {
      weekStart = declareGapMatch1[1];
      dow = declareGapMatch1[2].toLowerCase();
      fromHour = declareGapMatch1[3].padStart(2, "0");
      toHour = declareGapMatch1[4].padStart(2, "0");
    } else {
      weekStart = null;
      dow = declareGapMatch2[1].toLowerCase();
      fromHour = declareGapMatch2[2].padStart(2, "0");
      toHour = declareGapMatch2[3].padStart(2, "0");
    }
    if (DOW_MAP[dow] !== undefined) {
      const date = weekStart
        ? addDaysBerlin(weekStart + "T00:00:00Z", DOW_MAP[dow])
        : nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
      results.push({
        fact_type: "SHIFT_GAP",
        fact_payload: {
          week_start: weekStart,
          date,
          dow,
          from: `${fromHour}:00`,
          to: `${toHour}:00`,
          urgency: "high",
          notes: text,
        },
        confidence: 1.0,
      });
    }
    return results;
  }

  // ASSIGN [YYYY-MM-DD?] <dow> <from>-<to> <user_id>
  const assignMatch1 = upper.match(/^ASSIGN\s+(\d{4}-\d{2}-\d{2})\s+(\w+)\s+(\d{1,2})-(\d{1,2})\s+(\w+)$/);
  const assignMatch2 = upper.match(/^ASSIGN\s+(\w+)\s+(\d{1,2})-(\d{1,2})\s+(\w+)$/);
  const assignMatch = assignMatch1 || assignMatch2;
  if (assignMatch) {
    let weekStart, dow, fromHour, toHour, userId;
    if (assignMatch1) {
      weekStart = assignMatch1[1];
      dow = assignMatch1[2].toLowerCase();
      fromHour = assignMatch1[3].padStart(2, "0");
      toHour = assignMatch1[4].padStart(2, "0");
      userId = assignMatch1[5].toLowerCase();
    } else {
      weekStart = null;
      dow = assignMatch2[1].toLowerCase();
      fromHour = assignMatch2[2].padStart(2, "0");
      toHour = assignMatch2[3].padStart(2, "0");
      userId = assignMatch2[4].toLowerCase();
    }
    if (DOW_MAP[dow] !== undefined) {
      // Calculate date: if weekStart provided, add days from Monday (0=Mon, 6=Sun)
      let date;
      if (weekStart) {
        date = addDaysBerlin(weekStart + "T00:00:00Z", DOW_MAP[dow]);
      } else {
        date = nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
      }
      results.push({
        fact_type: "SHIFT_ASSIGNMENT",
        fact_payload: {
          week_start: weekStart,
          date,
          dow,
          from: `${fromHour}:00`,
          to: `${toHour}:00`,
          assigned_user_id: userId,
          notes: text,
        },
        confidence: 1.0,
      });
    }
    return results;
  }

  // UNASSIGN [YYYY-MM-DD?] <dow> <from>-<to>
  // Example: "UNASSIGN 2026-03-09 sat 18-21" or "UNASSIGN sat 18-21"
  const unassignMatch1 = upper.match(/^UNASSIGN\s+(\d{4}-\d{2}-\d{2})\s+(\w+)\s+(\d{1,2})-(\d{1,2})$/);
  const unassignMatch2 = upper.match(/^UNASSIGN\s+(\w+)\s+(\d{1,2})-(\d{1,2})$/);
  const unassignMatch = unassignMatch1 || unassignMatch2;
  if (unassignMatch) {
    let weekStart, dow, fromHour, toHour;
    if (unassignMatch1) {
      weekStart = unassignMatch1[1];
      dow = unassignMatch1[2].toLowerCase();
      fromHour = unassignMatch1[3].padStart(2, "0");
      toHour = unassignMatch1[4].padStart(2, "0");
    } else {
      weekStart = null;
      dow = unassignMatch2[1].toLowerCase();
      fromHour = unassignMatch2[2].padStart(2, "0");
      toHour = unassignMatch2[3].padStart(2, "0");
    }
    if (DOW_MAP[dow] !== undefined) {
      let date;
      if (weekStart) {
        date = addDaysBerlin(weekStart + "T00:00:00Z", DOW_MAP[dow]);
      } else {
        date = nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
      }
      results.push({
        fact_type: "SHIFT_UNASSIGNMENT",
        fact_payload: {
          week_start: weekStart,
          date,
          dow,
          from: `${fromHour}:00`,
          to: `${toHour}:00`,
          notes: text,
        },
        confidence: 1.0,
      });
    }
    return results;
  }

  // APPROVE_OVERTIME [YYYY-MM-DD?] <dow> <from>-<to>
  const approveOvertimeMatch1 = upper.match(/^APPROVE_OVERTIME\s+(\d{4}-\d{2}-\d{2})\s+(\w+)\s+(\d{1,2})-(\d{1,2})$/);
  const approveOvertimeMatch2 = upper.match(/^APPROVE_OVERTIME\s+(\w+)\s+(\d{1,2})-(\d{1,2})$/);
  const approveOvertimeMatch = approveOvertimeMatch1 || approveOvertimeMatch2;
  if (approveOvertimeMatch) {
    let weekStart, dow, fromHour, toHour;
    if (approveOvertimeMatch1) {
      weekStart = approveOvertimeMatch1[1];
      dow = approveOvertimeMatch1[2].toLowerCase();
      fromHour = approveOvertimeMatch1[3].padStart(2, "0");
      toHour = approveOvertimeMatch1[4].padStart(2, "0");
    } else {
      weekStart = null;
      dow = approveOvertimeMatch2[1].toLowerCase();
      fromHour = approveOvertimeMatch2[2].padStart(2, "0");
      toHour = approveOvertimeMatch2[3].padStart(2, "0");
    }
    if (DOW_MAP[dow] !== undefined) {
      // Calculate date: if weekStart provided, add days from Monday (0=Mon, 6=Sun)
      let date;
      if (weekStart) {
        date = addDaysBerlin(weekStart + "T00:00:00Z", DOW_MAP[dow]);
      } else {
        date = nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
      }
      results.push({
        fact_type: "OWNER_APPROVAL",
        fact_payload: {
          week_start: weekStart,
          date,
          dow,
          from: `${fromHour}:00`,
          to: `${toHour}:00`,
          type: "overtime",
          notes: text,
        },
        confidence: 1.0,
      });
    }
    return results;
  }

  // WORKED <week_start> <dow> <from>-<to>
  const workedMatch1 = upper.match(/^WORKED\s+(\d{4}-\d{2}-\d{2})\s+(\w+)\s+(\d{1,2})-(\d{1,2})$/);
  const workedMatch2 = upper.match(/^WORKED\s+(\w+)\s+(\d{1,2})-(\d{1,2})$/);
  const workedMatch = workedMatch1 || workedMatch2;
  if (workedMatch) {
    let weekStart, dow, fromHour, toHour;
    if (workedMatch1) {
      weekStart = workedMatch1[1];
      dow = workedMatch1[2].toLowerCase();
      fromHour = workedMatch1[3].padStart(2, "0");
      toHour = workedMatch1[4].padStart(2, "0");
    } else {
      weekStart = null;
      dow = workedMatch2[1].toLowerCase();
      fromHour = workedMatch2[2].padStart(2, "0");
      toHour = workedMatch2[3].padStart(2, "0");
    }
    if (DOW_MAP[dow] !== undefined) {
      // Calculate date: if weekStart provided, add days from Monday (0=Mon, 6=Sun)
      let date;
      if (weekStart) {
        date = addDaysBerlin(weekStart + "T00:00:00Z", DOW_MAP[dow]);
      } else {
        date = nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
      }
      results.push({
        fact_type: "SHIFT_WORKED",
        fact_payload: {
          week_start: weekStart,
          date,
          dow,
          from: `${fromHour}:00`,
          to: `${toHour}:00`,
          notes: text,
        },
        confidence: 1.0,
      });
    }
    return results;
  }

  // NO_SHOW <week_start> <dow> <from>-<to>
  const noShowMatch1 = upper.match(/^NO_SHOW\s+(\d{4}-\d{2}-\d{2})\s+(\w+)\s+(\d{1,2})-(\d{1,2})$/);
  const noShowMatch2 = upper.match(/^NO_SHOW\s+(\w+)\s+(\d{1,2})-(\d{1,2})$/);
  const noShowMatch = noShowMatch1 || noShowMatch2;
  if (noShowMatch) {
    let weekStart, dow, fromHour, toHour;
    if (noShowMatch1) {
      weekStart = noShowMatch1[1];
      dow = noShowMatch1[2].toLowerCase();
      fromHour = noShowMatch1[3].padStart(2, "0");
      toHour = noShowMatch1[4].padStart(2, "0");
    } else {
      weekStart = null;
      dow = noShowMatch2[1].toLowerCase();
      fromHour = noShowMatch2[2].padStart(2, "0");
      toHour = noShowMatch2[3].padStart(2, "0");
    }
    if (DOW_MAP[dow] !== undefined) {
      // Calculate date: if weekStart provided, add days from Monday (0=Mon, 6=Sun)
      let date;
      if (weekStart) {
        date = addDaysBerlin(weekStart + "T00:00:00Z", DOW_MAP[dow]);
      } else {
        date = nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
      }
      results.push({
        fact_type: "SHIFT_NO_SHOW",
        fact_payload: {
          week_start: weekStart,
          date,
          dow,
          from: `${fromHour}:00`,
          to: `${toHour}:00`,
          notes: text,
        },
        confidence: 1.0,
      });
    }
    return results;
  }

  // CONFIRM_TIMESHEET <week_start>
  const confirmTimesheetMatch = upper.match(/^CONFIRM_TIMESHEET\s+(\d{4}-\d{2}-\d{2})$/);
  if (confirmTimesheetMatch) {
    results.push({
      fact_type: "TIMESHEET_CONFIRMED",
      fact_payload: { week_start: confirmTimesheetMatch[1], notes: text },
      confidence: 1.0,
    });
    return results;
  }

  // CLEANING [YYYY-MM-DD?] <dow>
  const cleaningMatch1 = upper.match(/^CLEANING\s+(\d{4}-\d{2}-\d{2})\s+(\w+)$/);
  const cleaningMatch2 = upper.match(/^CLEANING\s+(\w+)$/);
  const cleaningMatch = cleaningMatch1 || cleaningMatch2;
  if (cleaningMatch) {
    let weekStart, dow;
    if (cleaningMatch1) {
      weekStart = cleaningMatch1[1];
      dow = cleaningMatch1[2].toLowerCase();
    } else {
      weekStart = null;
      dow = cleaningMatch2[1].toLowerCase();
    }
    if (DOW_MAP[dow] !== undefined) {
      let date;
      if (weekStart) {
        date = addDaysBerlin(weekStart + "T00:00:00Z", DOW_MAP[dow]);
      } else {
        date = sameWeekdayBerlin(receivedAt, DOW_MAP[dow]);
      }
      results.push({
        fact_type: "CLEANING_DONE",
        fact_payload: {
          week_start: weekStart,
          date,
          dow,
          notes: text,
        },
        confidence: 1.0,
      });
    }
    return results;
  }

  // CLEANING_SWAP [YYYY-MM-DD?] <dow> <original_user_id> <replacement_user_id>
  const cleanSwapMatch1 = upper.match(/^CLEANING_SWAP\s+(\d{4}-\d{2}-\d{2})\s+(\w+)\s+(\w+)\s+(\w+)$/);
  const cleanSwapMatch2 = upper.match(/^CLEANING_SWAP\s+(\w+)\s+(\w+)\s+(\w+)$/);
  const cleanSwapMatch = cleanSwapMatch1 || cleanSwapMatch2;
  if (cleanSwapMatch) {
    let weekStart, dow, originalUserId, replacementUserId;
    if (cleanSwapMatch1) {
      weekStart = cleanSwapMatch1[1];
      dow = cleanSwapMatch1[2].toLowerCase();
      originalUserId = cleanSwapMatch1[3].toLowerCase();
      replacementUserId = cleanSwapMatch1[4].toLowerCase();
    } else {
      weekStart = null;
      dow = cleanSwapMatch2[1].toLowerCase();
      originalUserId = cleanSwapMatch2[2].toLowerCase();
      replacementUserId = cleanSwapMatch2[3].toLowerCase();
    }
    if (DOW_MAP[dow] !== undefined) {
      let date;
      if (weekStart) {
        date = addDaysBerlin(weekStart + "T00:00:00Z", DOW_MAP[dow]);
      } else {
        date = sameWeekdayBerlin(receivedAt, DOW_MAP[dow]);
      }
      results.push({
        fact_type: "CLEANING_SWAP",
        fact_payload: {
          week_start: weekStart,
          date,
          dow,
          original_user_id: originalUserId,
          replacement_user_id: replacementUserId,
          notes: text,
        },
        confidence: 1.0,
      });
    }
    return results;
  }

  // EXTRA_CLASS [YYYY-MM-DD?] <dow> <kids_count> [description]
  // New format: EXTRA_CLASS mon 12 (kids count, no dash = not a time range)
  const extraClassKidsMatch1 = upper.match(/^EXTRA_CLASS\s+(\d{4}-\d{2}-\d{2})\s+(\w+)\s+(\d{1,3})(?:\s+(.+))?$/);
  const extraClassKidsMatch2 = upper.match(/^EXTRA_CLASS\s+(\w+)\s+(\d{1,3})(?:\s+(.+))?$/);
  // Only match if the number doesn't look like a time range (no dash after it)
  const extraClassKidsMatch = extraClassKidsMatch1 || extraClassKidsMatch2;
  if (extraClassKidsMatch) {
    let weekStart, dow, kidsCount, description;
    if (extraClassKidsMatch1) {
      weekStart = extraClassKidsMatch1[1];
      dow = extraClassKidsMatch1[2].toLowerCase();
      kidsCount = parseInt(extraClassKidsMatch1[3], 10);
      description = extraClassKidsMatch1[4] || null;
    } else {
      weekStart = null;
      dow = extraClassKidsMatch2[1].toLowerCase();
      kidsCount = parseInt(extraClassKidsMatch2[2], 10);
      description = extraClassKidsMatch2[3] || null;
    }
    if (DOW_MAP[dow] !== undefined) {
      let date;
      if (weekStart) {
        date = addDaysBerlin(weekStart + "T00:00:00Z", DOW_MAP[dow]);
      } else {
        date = sameWeekdayBerlin(receivedAt, DOW_MAP[dow]);
      }
      results.push({
        fact_type: "EXTRA_CLASS",
        fact_payload: {
          week_start: weekStart,
          date,
          dow,
          kids_count: kidsCount,
          description,
          notes: text,
        },
        confidence: 1.0,
      });
      return results;
    }
  }

  // EXTRA_CLASS [YYYY-MM-DD?] <dow> <from>-<to> [description] (legacy: time range)
  const extraClassMatch1 = upper.match(/^EXTRA_CLASS\s+(\d{4}-\d{2}-\d{2})\s+(\w+)\s+(\d{1,2})-(\d{1,2})(?:\s+(.+))?$/);
  const extraClassMatch2 = upper.match(/^EXTRA_CLASS\s+(\w+)\s+(\d{1,2})-(\d{1,2})(?:\s+(.+))?$/);
  const extraClassMatch = extraClassMatch1 || extraClassMatch2;
  if (extraClassMatch) {
    let weekStart, dow, fromHour, toHour, description;
    if (extraClassMatch1) {
      weekStart = extraClassMatch1[1];
      dow = extraClassMatch1[2].toLowerCase();
      fromHour = extraClassMatch1[3].padStart(2, "0");
      toHour = extraClassMatch1[4].padStart(2, "0");
      description = extraClassMatch1[5] || null;
    } else {
      weekStart = null;
      dow = extraClassMatch2[1].toLowerCase();
      fromHour = extraClassMatch2[2].padStart(2, "0");
      toHour = extraClassMatch2[3].padStart(2, "0");
      description = extraClassMatch2[4] || null;
    }
    if (DOW_MAP[dow] !== undefined) {
      let date;
      if (weekStart) {
        date = addDaysBerlin(weekStart + "T00:00:00Z", DOW_MAP[dow]);
      } else {
        date = sameWeekdayBerlin(receivedAt, DOW_MAP[dow]);
      }
      results.push({
        fact_type: "EXTRA_CLASS",
        fact_payload: {
          week_start: weekStart,
          date,
          dow,
          from: `${fromHour}:00`,
          to: `${toHour}:00`,
          description,
          notes: text,
        },
        confidence: 1.0,
      });
    }
    return results;
  }

  return []; // Not a command format, return empty array
}

// Russian day-of-week map (full + abbreviated) → dow code
const RU_DOW_MAP = {
  пн: "mon", понедельник: "mon",
  вт: "tue", вторник: "tue",
  ср: "wed", среда: "wed", среду: "wed",
  чт: "thu", четверг: "thu",
  пт: "fri", пятница: "fri", пятницу: "fri",
  сб: "sat", суббота: "sat", субботу: "sat",
  вс: "sun", воскресенье: "sun",
};

// Named time slots
const NAMED_TIMES = {
  утро: { from: "10:00", to: "13:00" },
  утром: { from: "10:00", to: "13:00" },
  утр: { from: "10:00", to: "13:00" },    // typo
  вечер: { from: "18:00", to: "21:00" },
  вечером: { from: "18:00", to: "21:00" },
  вече: { from: "18:00", to: "21:00" },   // typo
  вечерн: { from: "18:00", to: "21:00" }, // typo
  день: { from: "13:00", to: "18:00" },
  днём: { from: "13:00", to: "18:00" },
  днем: { from: "13:00", to: "18:00" },
};

// Both slots fallback when no time specified
const BOTH_SLOTS = [
  { from: "10:00", to: "13:00" },
  { from: "18:00", to: "21:00" },
];

/**
 * Extract Russian dow from text. Returns { dow, dowIndex } or null.
 */
/**
 * Get current day-of-week from receivedAt as { dow, dowIndex }.
 */
function getCurrentDow(receivedAt) {
  const date = new Date(receivedAt);
  let day = date.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  if (day === 0) day = 7;
  const dowIndex = day - 1; // 0=Mon, ..., 6=Sun
  const dowNames = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  return { dow: dowNames[dowIndex], dowIndex };
}

function extractRuDow(text) {
  // Try full names first (longer match), then abbreviations
  const sorted = Object.keys(RU_DOW_MAP).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    const re = new RegExp(`(?:^|\\s|,)${key}(?:\\s|,|[?!.]|$)`, "i");
    if (re.test(text)) {
      const dow = RU_DOW_MAP[key];
      return { dow, dowIndex: DOW_MAP[dow] };
    }
  }
  return null;
}

/**
 * Extract ALL Russian day-of-week mentions from text.
 * Returns array of { dow, dowIndex } sorted by dow order (mon..sun).
 * Also expands ranges like "пн-ср" → [пн, вт, ср].
 */
function extractAllRuDows(text) {
  const results = [];
  const seen = new Set();

  // First, check for day ranges: "пн-ср", "пн–пт"
  const DOW_ABBREVS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
  const rangeRe = /(пн|вт|ср|чт|пт|сб|вс)\s*[-–—]\s*(пн|вт|ср|чт|пт|сб|вс)/i;
  const rangeMatch = text.match(rangeRe);
  if (rangeMatch) {
    const startIdx = DOW_ABBREVS.indexOf(rangeMatch[1].toLowerCase());
    const endIdx = DOW_ABBREVS.indexOf(rangeMatch[2].toLowerCase());
    if (startIdx !== -1 && endIdx !== -1 && startIdx <= endIdx) {
      for (let i = startIdx; i <= endIdx; i++) {
        const abbr = DOW_ABBREVS[i];
        const dow = RU_DOW_MAP[abbr];
        if (!seen.has(dow)) {
          seen.add(dow);
          results.push({ dow, dowIndex: DOW_MAP[dow] });
        }
      }
    }
  }

  // Then check for individual day mentions
  const sorted = Object.keys(RU_DOW_MAP).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    const re = new RegExp(`(?:^|[\\s,])${key}(?:[\\s,?!.]|$)`, "i");
    if (re.test(text)) {
      const dow = RU_DOW_MAP[key];
      if (!seen.has(dow)) {
        seen.add(dow);
        results.push({ dow, dowIndex: DOW_MAP[dow] });
      }
    }
  }

  return results.sort((a, b) => a.dowIndex - b.dowIndex);
}

/**
 * Extract time range from text. Returns { from, to } or null.
 * Supports: "10-13", "10:00-13:00", "с 10 до 13", "утро", "вечер", "день"
 */
function extractTime(text) {
  // "с 10 до 13" or "с 10:00 до 13:00"
  const tw = parseTimeWindow(text);
  if (tw) return tw;

  // "10:00-13:00" or "10-13"
  const rangeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?/);
  if (rangeMatch) {
    const h1 = rangeMatch[1].padStart(2, "0");
    const m1 = (rangeMatch[2] || "00").padStart(2, "0");
    const h2 = rangeMatch[3].padStart(2, "0");
    const m2 = (rangeMatch[4] || "00").padStart(2, "0");
    return { from: `${h1}:${m1}`, to: `${h2}:${m2}` };
  }

  // Named time slots
  for (const [key, val] of Object.entries(NAMED_TIMES)) {
    if (text.includes(key)) return { ...val };
  }

  return null;
}

/**
 * Parse multi-line schedule format:
 *   "пн - утро\nвт - —\nчт - вечер\nсб - вечер"
 *   "пн - вечер\nвт - утро\nчт - утро, вечер\nвс - не могу"
 *
 * Each line: <day> <separator> <content>
 * Separator: "-", "–", "—", ":"
 * Content:
 *   "утро" → morning slot
 *   "вечер" → evening slot
 *   "утро, вечер" or "утро/вечер" → both slots
 *   "—", "-", "нет", "не могу", empty → SHIFT_UNAVAILABILITY
 */
function parseMultiLineSchedule(text, receivedAt) {
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  // Need at least 2 lines with day-separator-content pattern to qualify
  const DOW_ABBREVS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
  const lineRe = /^(пн|вт|ср|чт|пт|сб|вс|понедельник|вторник|среда|среду|четверг|пятница|пятницу|суббота|субботу|воскресенье)\s*[-–—:]\s*(.*)$/i;

  const parsed = [];
  for (const line of lines) {
    const m = line.match(lineRe);
    if (m) {
      parsed.push({ dayToken: m[1].toLowerCase(), content: m[2].trim().toLowerCase() });
    }
  }

  // Need at least 2 matching lines to consider this multi-line format
  if (parsed.length < 2) return [];

  const results = [];
  for (const { dayToken, content } of parsed) {
    const dow = RU_DOW_MAP[dayToken];
    if (!dow) continue;
    const dowIndex = DOW_MAP[dow];
    const date = nextWeekdayBerlin(receivedAt, dowIndex);

    // Determine if unavailable
    const isUnavail = !content || content === "—" || content === "-" || content === "–"
      || content === "нет" || /не\s*могу/.test(content);

    if (isUnavail) {
      for (const slot of BOTH_SLOTS) {
        results.push({
          fact_type: "SHIFT_UNAVAILABILITY",
          fact_payload: { date, dow, from: slot.from, to: slot.to, availability: "cannot", notes: text },
          confidence: 0.85,
        });
      }
      continue;
    }

    // Check for time slots in content
    const hasMorning = /утр/.test(content);
    const hasEvening = /вечер/.test(content);

    if (hasMorning && hasEvening) {
      // Both slots
      for (const slot of BOTH_SLOTS) {
        results.push({
          fact_type: "SHIFT_AVAILABILITY",
          fact_payload: { date, dow, from: slot.from, to: slot.to, availability: "can", notes: text },
          confidence: 0.85,
        });
      }
    } else if (hasMorning) {
      results.push({
        fact_type: "SHIFT_AVAILABILITY",
        fact_payload: { date, dow, from: "10:00", to: "13:00", availability: "can", notes: text },
        confidence: 0.85,
      });
    } else if (hasEvening) {
      results.push({
        fact_type: "SHIFT_AVAILABILITY",
        fact_payload: { date, dow, from: "18:00", to: "21:00", availability: "can", notes: text },
        confidence: 0.85,
      });
    } else {
      // Try extracting numeric time range from content
      const time = extractTime(content);
      if (time) {
        results.push({
          fact_type: "SHIFT_AVAILABILITY",
          fact_payload: { date, dow, from: time.from, to: time.to, availability: "can", notes: text },
          confidence: 0.85,
        });
      } else {
        // Unknown content but day is present — assume both slots available
        for (const slot of BOTH_SLOTS) {
          results.push({
            fact_type: "SHIFT_AVAILABILITY",
            fact_payload: { date, dow, from: slot.from, to: slot.to, availability: "can", notes: text },
            confidence: 0.6,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Parse "все дни кроме пн" / "могу каждый день кроме пн" / "каждый день кроме среды"
 * Returns SHIFT_AVAILABILITY for included days (both slots) and SHIFT_UNAVAILABILITY for excluded.
 */
function parseAllDaysExcept(text, receivedAt) {
  const lower = text.toLowerCase();
  // Pattern: optional "могу"/"свободна" + "все дни"/"каждый день"/"всю неделю" + optional "кроме <days>"
  const allDaysRe = /(?:мог[уа]|свободн[аы]?)?\s*(?:все\s+дни|каждый\s+день|всю\s+неделю)/i;
  if (!allDaysRe.test(lower)) return [];

  const ALL_DOWS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const excludedDows = new Set();

  // Extract "кроме ..." part
  const exceptRe = /кроме\s+(.+)/i;
  const exceptMatch = lower.match(exceptRe);
  if (exceptMatch) {
    const exceptText = exceptMatch[1];
    const excludedDays = extractAllRuDows(exceptText);
    for (const d of excludedDays) excludedDows.add(d.dow);
  }

  const results = [];
  for (let i = 0; i < ALL_DOWS.length; i++) {
    const dow = ALL_DOWS[i];
    const date = nextWeekdayBerlin(receivedAt, i);
    if (excludedDows.has(dow)) {
      for (const slot of BOTH_SLOTS) {
        results.push({
          fact_type: "SHIFT_UNAVAILABILITY",
          fact_payload: { date, dow, from: slot.from, to: slot.to, availability: "cannot", notes: text },
          confidence: 0.8,
        });
      }
    } else {
      for (const slot of BOTH_SLOTS) {
        results.push({
          fact_type: "SHIFT_AVAILABILITY",
          fact_payload: { date, dow, from: slot.from, to: slot.to, availability: "can", notes: text },
          confidence: 0.8,
        });
      }
    }
  }

  return results;
}

/**
 * Try to parse Russian NL availability/unavailability.
 * Returns array of facts or empty array.
 *
 * Supported patterns:
 *   "могу пн утро"                     → 1 fact (mon morning)
 *   "могу в пн"                        → 2 facts (mon morning + evening)
 *   "могу пн утро, вт утро, чт утро"   → 3 facts
 *   "могу пн, вт, ср утро"             → 3 facts (time from last segment)
 *   "могу пн вт ср"                    → 6 facts (3 days × 2 slots)
 *   "могу пн-ср утро"                  → 3 facts (range expansion)
 *   "не могу сб вече"                  → 1 fact (typo tolerance)
 */
function parseRussianNL(text, receivedAt) {
  const lower = text.toLowerCase();

  // Skip swap keywords — let the swap parser handle those
  const swapKw = ["поменяй", "поменяться", "обмен", "замени меня", "сменяться"];
  if (swapKw.some((k) => lower.includes(k))) return [];

  // Detect negative before positive (не могу before могу)
  const S = "(?:^|[\\s,])"; // start-or-separator
  const E = "(?:[\\s,]|$)"; // end-or-separator
  const negativePatterns = [/не\s+могу/, /не\s+смогу/, /не\s+буду/, new RegExp(S + "занята?" + E), new RegExp(S + "нет" + E)];
  const positivePatterns = [new RegExp(S + "могу" + E), new RegExp(S + "свободн"), new RegExp(S + "ок" + E), new RegExp(S + "да,")];

  let isNegative = false;
  let isPositive = false;

  for (const re of negativePatterns) {
    if (re.test(lower)) { isNegative = true; break; }
  }
  if (!isNegative) {
    for (const re of positivePatterns) {
      if (re.test(lower)) { isPositive = true; break; }
    }
  }

  // Check for leading minus/dash as negation: "- пн 10-13"
  if (!isNegative && !isPositive) {
    if (/^\s*[-–—]\s/.test(text)) isNegative = true;
  }

  const factType = isNegative ? "SHIFT_UNAVAILABILITY" : "SHIFT_AVAILABILITY";
  const availability = isNegative ? "cannot" : "can";
  const confidence = (isNegative || isPositive) ? 0.85 : 0.6;
  const noTimeConfidence = (isNegative || isPositive) ? 0.75 : 0.5;

  // Split by comma/semicolon/и to handle "пн утро, вт утро, чт утро"
  const segments = lower.split(/[,;]|\sи\s/);
  const results = [];

  // Extract global time from full text (fallback when segment has no time)
  const globalTime = extractTime(lower);

  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;

    // Extract all days from this segment (handles "пн вт ср" and "пн-ср")
    const days = extractAllRuDows(trimmed);
    if (days.length === 0) continue;

    // Extract time from this segment specifically
    const segTime = extractTime(trimmed);

    for (const dayInfo of days) {
      const time = segTime || globalTime;
      const date = nextWeekdayBerlin(receivedAt, dayInfo.dowIndex);

      if (time) {
        results.push({
          fact_type: factType,
          fact_payload: {
            date,
            dow: dayInfo.dow,
            from: time.from,
            to: time.to,
            availability,
            notes: text,
          },
          confidence,
        });
      } else {
        // No time specified → generate facts for BOTH slots
        for (const slot of BOTH_SLOTS) {
          results.push({
            fact_type: factType,
            fact_payload: {
              date,
              dow: dayInfo.dow,
              from: slot.from,
              to: slot.to,
              availability,
              notes: text,
            },
            confidence: noTimeConfidence,
          });
        }
      }
    }
  }

  return results;
}

// --- Fuzzy keyword matching layer (fallback for NL) ---

/**
 * Simple Russian stemming — strip common suffixes to normalize words.
 */
function stem(word) {
  return word.replace(/(ала|ась|ось|ать|ить|ыть|ула|ели|ила|ули|ую|ой|ей|ом|ем|ки|ку|ке|ов|ев|ла|ал|ли|ый|ая|ое|ые|ий)$/i, '');
}

/**
 * Keyword dictionary for fuzzy intent detection.
 * Each entry maps a semantic category to arrays of word stems/prefixes.
 */
const INTENT_KEYWORDS = {
  AVAILABLE: {
    positive: ['мог', 'смог', 'готов', 'свобод', 'выход', 'выйд', 'дежур', 'работ'],
    negative: ['не мог', 'не смог', 'не готов', 'не выйд', 'не получ', 'занят', 'болен', 'болею', 'заболел', 'отпуск', 'не буд'],
  },
  CLEANING: {
    done: ['убр', 'убор', 'убира', 'уберу', 'помыл', 'помою', 'вымыл', 'чист', 'убрал'],
    cant: ['не убр', 'не могу убр', 'не уберу'],
  },
  EXTRA_WORK: {
    action: ['сдел', 'провел', 'провод', 'выполн', 'заверш', 'снял', 'сняла', 'подготов', 'оформ', 'разобр'],
  },
  DAYS: {
    'mon': ['пн', 'понед', 'понедельн'],
    'tue': ['вт', 'вторн'],
    'wed': ['ср', 'сред'],
    'thu': ['чт', 'четв'],
    'fri': ['пт', 'пятн', 'пятниц'],
    'sat': ['сб', 'субб', 'суббот'],
    'sun': ['вс', 'воскр', 'воскресен'],
  },
  TIME: {
    morning: ['утр', 'утро', 'утром', 'утрен'],
    day: ['день', 'дневн', 'днём', 'днем'],
    evening: ['веч', 'вечер', 'вечером', 'вечерн', 'ночь', 'ночн'],
  },
};

/**
 * Extract day-of-week codes from text using fuzzy prefix matching.
 * Returns array of dow codes like ['mon', 'thu'].
 */
function fuzzyExtractDays(lower) {
  const found = [];
  const seen = new Set();
  for (const [dow, prefixes] of Object.entries(INTENT_KEYWORDS.DAYS)) {
    for (const prefix of prefixes) {
      if (lower.includes(prefix) && !seen.has(dow)) {
        seen.add(dow);
        found.push(dow);
      }
    }
  }
  return found;
}

/**
 * Extract time slot from text using fuzzy keyword matching.
 * Returns { from, to } or null.
 */
function fuzzyExtractTimeSlot(lower) {
  for (const prefix of INTENT_KEYWORDS.TIME.morning) {
    if (lower.includes(prefix)) return { from: '10:00', to: '13:00' };
  }
  for (const prefix of INTENT_KEYWORDS.TIME.day) {
    if (lower.includes(prefix)) return { from: '13:00', to: '18:00' };
  }
  for (const prefix of INTENT_KEYWORDS.TIME.evening) {
    if (lower.includes(prefix)) return { from: '18:00', to: '21:00' };
  }
  return null;
}

/**
 * Check if text matches any negative availability keyword (multi-word phrases first).
 */
function fuzzyIsNegative(lower) {
  for (const phrase of INTENT_KEYWORDS.AVAILABLE.negative) {
    if (lower.includes(phrase)) return true;
  }
  return false;
}

/**
 * Check if text matches any positive availability keyword.
 */
function fuzzyIsPositive(lower) {
  for (const kw of INTENT_KEYWORDS.AVAILABLE.positive) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

/**
 * Check if text matches cleaning-done keywords.
 */
function fuzzyIsCleaning(lower) {
  for (const kw of INTENT_KEYWORDS.CLEANING.done) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

/**
 * Check if text contains an action verb for extra work.
 */
function fuzzyHasAction(lower) {
  for (const kw of INTENT_KEYWORDS.EXTRA_WORK.action) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

/**
 * Fuzzy match extra work catalog items using stem-based matching.
 * For each catalog item: stem its name words and alias words, then check
 * if the stemmed text contains both an action verb AND the item stems.
 */
function fuzzyMatchExtraWorkCatalog(lower) {
  if (_extraWorkCatalog.length === 0) return null;

  const textWords = lower.split(/\s+/).filter(Boolean);
  const textStems = textWords.map(w => stem(w));
  const textStemsJoined = textStems.join(' ');

  for (const item of _extraWorkCatalog) {
    // Check aliases first (more specific)
    const aliases = CATALOG_ALIASES[item.id] || [];
    for (const alias of aliases) {
      const aliasWords = alias.toLowerCase().split(/\s+/).filter(Boolean);
      const aliasStems = aliasWords.map(w => stem(w));
      // Check if all alias stems appear in the text stems
      const allFound = aliasStems.every(as =>
        textStems.some(ts => ts.startsWith(as) || as.startsWith(ts))
      );
      if (allFound) return item;
    }

    // Check item name stems
    const nameWords = item.name.toLowerCase().split(/\s+/).filter(Boolean);
    const nameStems = nameWords.map(w => stem(w));
    const allNameFound = nameStems.every(ns =>
      textStems.some(ts => ts.startsWith(ns) || ns.startsWith(ts))
    );
    if (allNameFound) return item;
  }
  return null;
}

/**
 * Fuzzy keyword-based intent detection.
 * Called as FALLBACK when existing rules produce no facts.
 * Returns array of facts with confidence 0.6.
 */
function fuzzyMatchIntent(text, receivedAt) {
  const lower = text.toLowerCase().replace(/[.,!?;:()]/g, ' ');
  const results = [];

  // Extract days and time
  const foundDays = fuzzyExtractDays(lower);
  const foundTime = fuzzyExtractTimeSlot(lower);

  // 1. Check for cleaning done
  if (fuzzyIsCleaning(lower) && !fuzzyIsNegative(lower)) {
    if (foundDays.length > 0) {
      for (const dow of foundDays) {
        results.push({
          fact_type: 'CLEANING_DONE',
          fact_payload: {
            date: sameWeekdayBerlin(receivedAt, DOW_MAP[dow]),
            dow,
            notes: text,
          },
          confidence: 0.6,
        });
      }
      return results;
    }
  }

  // 2. Check for extra work (catalog items)
  const matchedWork = fuzzyMatchExtraWorkCatalog(lower);
  if (matchedWork) {
    // If there's an action word or just a catalog item mention
    if (fuzzyHasAction(lower) || matchedWork) {
      results.push({
        fact_type: 'EXTRA_WORK_REQUEST',
        fact_payload: {
          work_type_id: matchedWork.id,
          work_name: matchedWork.name,
          price: matchedWork.price,
          date: getBerlinDateFromIso(receivedAt),
          status: 'pending',
          notes: text,
        },
        confidence: 0.6,
      });
      return results;
    }
  }

  // 3. Check for availability / unavailability
  const isNeg = fuzzyIsNegative(lower);
  const isPos = fuzzyIsPositive(lower);

  if ((isNeg || isPos) && foundDays.length > 0) {
    const factType = isNeg ? 'SHIFT_UNAVAILABILITY' : 'SHIFT_AVAILABILITY';
    const availability = isNeg ? 'cannot' : 'can';

    for (const dow of foundDays) {
      const date = nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
      if (foundTime) {
        results.push({
          fact_type: factType,
          fact_payload: {
            date,
            dow,
            from: foundTime.from,
            to: foundTime.to,
            availability,
            notes: text,
          },
          confidence: 0.6,
        });
      } else {
        // No time → both slots
        for (const slot of BOTH_SLOTS) {
          results.push({
            fact_type: factType,
            fact_payload: {
              date,
              dow,
              from: slot.from,
              to: slot.to,
              availability,
              notes: text,
            },
            confidence: 0.5,
          });
        }
      }
    }
    return results;
  }

  return results;
}

// --- Extra work catalog for NL matching ---
let _extraWorkCatalog = [];

/**
 * Set the extra work catalog for NL matching.
 * Call this at server startup after loading settings.
 * @param {Array<{id: string, name: string, price: number, keywords?: string[]}>} catalog
 */
export function setExtraWorkCatalog(catalog) {
  _extraWorkCatalog = catalog || [];
}

// Built-in aliases for common catalog items (id → array of synonyms/abbreviations)
const CATALOG_ALIASES = {
  gen_cleaning: ["генеральная уборка", "генеральную уборку", "ген уборка", "ген уборку", "ген. уборка", "ген. уборку", "генеральная", "генеральную"],
  reel: ["рилс", "рил", "reels", "рилс с монтажом"],
  shelf_sort: ["разбор шкафов", "разобрала шкафы", "шкафы разобрала", "разобрала шкаф", "разбор"],
  inventory: ["инвентаризация", "инвентаризацию", "инвентарь", "провела инвентаризацию"],
};

/**
 * Simple Levenshtein distance for short strings (for typo tolerance).
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Try to match text against extra work catalog items.
 * Uses: exact match → alias match → fuzzy alias match (Levenshtein ≤ 2).
 * Returns { id, name, price } or null.
 */
function matchExtraWork(text) {
  const lower = text.toLowerCase();

  for (const item of _extraWorkCatalog) {
    const nameLower = item.name.toLowerCase();

    // 1. Exact full name match
    if (lower.includes(nameLower)) return item;

    // 2. Built-in aliases
    const aliases = CATALOG_ALIASES[item.id] || [];
    for (const alias of aliases) {
      if (lower.includes(alias)) return item;
    }

    // 3. Keywords from catalog config
    if (item.keywords) {
      for (const kw of item.keywords) {
        if (lower.includes(kw.toLowerCase())) return item;
      }
    }

    // 4. Fuzzy alias match (Levenshtein ≤ 2) for typo tolerance ("гне уборку" → "ген уборку")
    const words = lower.split(/\s+/);
    for (const alias of aliases) {
      const aliasWords = alias.split(/\s+/);
      if (aliasWords.length <= words.length) {
        // Sliding window: try to match alias words sequence within text words
        for (let start = 0; start <= words.length - aliasWords.length; start++) {
          let totalDist = 0;
          let allClose = true;
          for (let k = 0; k < aliasWords.length; k++) {
            const dist = levenshtein(words[start + k], aliasWords[k]);
            totalDist += dist;
            if (dist > 2) { allClose = false; break; }
          }
          if (allClose && totalDist <= 2) return item;
        }
      }
    }
  }
  return null;
}

export function parseEventToFacts(event) {
  const results = [];
  const text = (event.text || "").trim();
  if (!text) return results;

  const lower = text.toLowerCase();
  const receivedAt = event.received_at || new Date().toISOString();

  // Try command format first (takes priority)
  const commandResults = parseCommandFormat(text, receivedAt);
  if (commandResults && commandResults.length > 0) {
    return commandResults;
  }

  // Rule 0-clar: CLARIFICATION_RESPONSE (short answers to system clarification questions)
  // "1" → cleaning, "2" → shift, "уборка"/"уберусь" → cleaning, "дежурство"/"смена" → shift
  const clarStripped = lower.replace(/[.!?,\s]/g, "");
  const clarNumMap = { "1": "cleaning", "2": "shift" };
  if (clarNumMap[clarStripped]) {
    return [{
      fact_type: "CLARIFICATION_RESPONSE",
      fact_payload: { type: clarNumMap[clarStripped], notes: text },
      confidence: 0.9,
    }];
  }
  if (lower.trim().length < 20) {
    const clarWordMap = {
      "уборка": "cleaning", "уберусь": "cleaning",
      "дежурство": "shift", "смена": "shift",
    };
    const clarWord = lower.replace(/[.!?,]/g, "").trim();
    if (clarWordMap[clarWord]) {
      return [{
        fact_type: "CLARIFICATION_RESPONSE",
        fact_payload: { type: clarWordMap[clarWord], notes: text },
        confidence: 0.9,
      }];
    }
  }

  // Rule 0a0: CLEANING_HELP_REQUEST (поиск замены на уборку)
  // "кто уберётся за меня в среду?" / "не могу убраться в чт" / "не могу убраться пн-ср"
  const cleanHelpRe = /(?:кто\s+(?:убер[её]тся|уберется|сможет\s+убраться|может\s+убраться)|не\s+(?:могу|смогу)\s+убраться)/i;
  if (cleanHelpRe.test(lower)) {
    const allDows = extractAllRuDows(lower);
    if (allDows.length > 0) {
      for (const dowInfo of allDows) {
        const date = sameWeekdayBerlin(receivedAt, dowInfo.dowIndex);
        results.push({
          fact_type: "CLEANING_HELP_REQUEST",
          fact_payload: {
            date,
            dow: dowInfo.dow,
            notes: text,
          },
          confidence: 0.8,
        });
      }
      return results;
    }
  }

  // Rule 0a1: CLEANING_SWAP offer (без имени — "я уберусь в среду", "могу убраться в чт")
  // Speaker volunteers to clean (no "за [Name]" pattern)
  const cleanOfferRe = /(?:(?:я\s+)?убер[уё]сь|могу\s+убраться|я\s+уберусь)\s/i;
  if (cleanOfferRe.test(lower) && !lower.includes(" за ")) {
    const dowInfo = extractRuDow(lower);
    if (dowInfo) {
      const date = sameWeekdayBerlin(receivedAt, dowInfo.dowIndex);
      results.push({
        fact_type: "CLEANING_SWAP",
        fact_payload: {
          date,
          dow: dowInfo.dow,
          replacement_user_id: null, // will be set from event.user_id by caller
          original_user_id: null,
          notes: text,
        },
        confidence: 0.7,
      });
      return results;
    }
  }

  // Rule 0a: CLEANING_SWAP (замена уборки) — order-independent extraction
  // Supports any word order: "убралась за ксюшу пт", "убралась пт за ксюшу",
  // "убралась в пт за ксюшу", "пт убралась за ксюшу", "уберусь за дарину в чт"
  //
  // Strategy: extract ALL key elements independently from the entire text:
  //   1. cleaning_intent: does text contain stem "убр"/"убор"/"уберу"?
  //   2. swap_intent: does text contain preposition "за" followed by or near a person name?
  //   3. target_user: find employee name in any grammatical case anywhere in text
  //   4. day: find day of week anywhere in text
  {
    const cleaningIntentRe = /(?:убр|убор|уберу)/i;
    const hasCleaningIntent = cleaningIntentRe.test(lower);

    if (hasCleaningIntent) {
      // Generate name forms for all employees for flexible matching
      const generateNameForms = (name) => {
        const ln = name.toLowerCase();
        const base = ln.replace(/[аяоеуи]$/, '');
        return new Set([ln, base + 'у', base + 'е', base + 'ой', base + 'ей', base + 'ы', base + 'и', base + 'а', base]);
      };

      // Try to find an employee name anywhere in text
      let targetUserId = null;
      const allUsers = UserDirectory.getAllUsers();
      const textWords = lower.replace(/[,?!.]/g, ' ').split(/\s+/).filter(Boolean);
      for (const user of allUsers) {
        const forms = generateNameForms(user.displayName);
        for (const word of textWords) {
          if (forms.has(word)) {
            targetUserId = user.id;
            break;
          }
        }
        if (targetUserId) break;
        // Also try findByDisplayName as fallback for non-standard forms
        for (const word of textWords) {
          if (word.length >= 2) {
            const uid = UserDirectory.findByDisplayName(word);
            if (uid) { targetUserId = uid; break; }
          }
        }
        if (targetUserId) break;
      }

      // Check for swap intent: "за" preposition near a person name
      const hasSwapIntent = lower.includes(" за ") || lower.includes("\tза ");

      // Extract day of week from text (anywhere)
      const dowInfo = extractRuDow(lower) || getCurrentDow(receivedAt);

      if (hasSwapIntent && targetUserId && dowInfo) {
        // Determine roles based on verb form:
        let originalUserId = null;
        let replacementUserId = null;
        // Past tense "убралась за" → speaker cleaned for target (speaker=replacement, target=original)
        if (/убрал(?:ась|ся|ись)/i.test(lower)) {
          originalUserId = targetUserId;
        }
        // Future tense "уберусь за" → speaker will clean for target
        else if (/уберу(?:сь)?/i.test(lower)) {
          originalUserId = targetUserId;
        }
        // "уборку за меня сделает [Name]" → speaker is original, target is replacement
        else if (/уборк[уе].*за\s+меня\s+сделает/i.test(lower)) {
          replacementUserId = targetUserId;
        }
        // "подменю на уборке" → speaker is replacement
        else if (/подменю\s+на\s+уборке/i.test(lower)) {
          originalUserId = targetUserId;
        }
        // Default: target is original
        else {
          originalUserId = targetUserId;
        }

        if (originalUserId || replacementUserId) {
          const date = sameWeekdayBerlin(receivedAt, dowInfo.dowIndex);
          results.push({
            fact_type: "CLEANING_SWAP",
            fact_payload: {
              date,
              dow: dowInfo.dow,
              original_user_id: originalUserId,
              replacement_user_id: replacementUserId,
              notes: text,
            },
            confidence: 0.7,
          });
          return results;
        }
      }
    }
  }

  // Rule 1: CLEANING_DONE (уборка выполнена)
  // Supports multi-day: "уборка пн и вт" → two facts
  const cleaningPhrases = [
    "уборку сделала",
    "сделала уборку",
    "уборка сделана",
    "убралась",
    "убрался",
    "убрано",
    "уборку сделал",
    "помыла зал",
    "помыл зал",
  ];
  // Also match "уборка <dow>" pattern (short form)
  const cleaningShortRe = /^уборк[аи]\s/i;
  if (cleaningPhrases.some((p) => lower.includes(p)) || cleaningShortRe.test(lower)) {
    const allDows = extractAllRuDows(lower);
    if (allDows.length > 1) {
      // Multi-day: "уборка пн и вт" → separate fact per day
      for (const dowInfo of allDows) {
        results.push({
          fact_type: "CLEANING_DONE",
          fact_payload: {
            date: sameWeekdayBerlin(receivedAt, dowInfo.dowIndex),
            dow: dowInfo.dow,
            notes: text,
          },
          confidence: 0.8,
        });
      }
      return results;
    }
    // Single day or no day
    const dowInfo = allDows[0] || null;
    const payload = {
      date: getBerlinDateFromIso(receivedAt),
      notes: text,
    };
    if (dowInfo) {
      payload.dow = dowInfo.dow;
      payload.date = sameWeekdayBerlin(receivedAt, dowInfo.dowIndex);
    }
    results.push({
      fact_type: "CLEANING_DONE",
      fact_payload: payload,
      confidence: 0.8,
    });
    return results;
  }

  // Rule 1b: EXTRA_CLASS (доп занятие) with kids_count support
  const extraClassPhrases = [
    "доп занятие",
    "допзанятие",
    "провела доп",
    "провёл доп",
    "провел доп",
    "дополнительное занятие",
    "доп урок",
    "допурок",
    "мастер-класс",
    "мастер класс",
    "на допе",
    "на занятии",
  ];
  // Also match short forms: "допы пн 5 детей", "доп пн 10", "мк пн 5 детей"
  const extraShortRe = /(?:^|\s)(?:доп[ыа]?|мк)\s/i;
  if (extraClassPhrases.some((p) => lower.includes(p)) || extraShortRe.test(lower)) {
    const dowInfo = extractRuDow(lower);
    // If no day mentioned, use current day from receivedAt
    const effectiveDow = dowInfo || getCurrentDow(receivedAt);
    if (effectiveDow) {
      // Try to extract kids_count from text
      const kidsMatch = lower.match(/(\d{1,3})\s*(?:дет[еиёй]|ребён|реб[ёе]нк|человек|чел|д\b)/i);
      const plainNumberMatch = lower.match(/(?:доп[ыа]?\s+(?:\S+\s+)?|мастер[- ]класс\s+(?:\S+\s+)?)(\d{1,3})(?:\s|$)/i);
      let kidsCount = null;

      if (kidsMatch) {
        kidsCount = parseInt(kidsMatch[1], 10);
      } else if (plainNumberMatch) {
        kidsCount = parseInt(plainNumberMatch[1], 10);
      }

      const date = sameWeekdayBerlin(receivedAt, effectiveDow.dowIndex);

      // Also try to extract time range (optional)
      const time = extractTime(lower);

      const payload = {
        date,
        dow: effectiveDow.dow,
        kids_count: kidsCount,
        notes: text,
      };
      if (time) {
        payload.from = time.from;
        payload.to = time.to;
      }

      results.push({
        fact_type: "EXTRA_CLASS",
        fact_payload: payload,
        confidence: 0.75,
      });
      return results;
    }
  }

  // Rule 1b2: EXTRA_WORK_REQUEST (доп работа from catalog)
  // "сделала генеральную уборку" / "сняла рилс" / "провела инвентаризацию"
  if (_extraWorkCatalog.length > 0) {
    const extraWorkPhrases = ["сделал", "провел", "провёл", "выполнил", "снял", "закончил", "разобрал"];
    const hasActionWord = extraWorkPhrases.some(p => lower.includes(p));
    if (hasActionWord) {
      const matched = matchExtraWork(lower);
      if (matched) {
        results.push({
          fact_type: "EXTRA_WORK_REQUEST",
          fact_payload: {
            work_type_id: matched.id,
            work_name: matched.name,
            price: matched.price,
            date: getBerlinDateFromIso(receivedAt),
            status: "pending",
            notes: text,
          },
          confidence: 0.75,
        });
        return results;
      }
    }
  }

  // Rule 1c: PROBLEM_SHIFT (проблема / ⚠ — admin marks a problem shift)
  // "проблема пн утро Иса опоздала" or "⚠ чт вечер Дарина"
  const problemPhrases = ["проблема", "⚠"];
  if (problemPhrases.some((p) => lower.includes(p))) {
    const dowInfo = extractRuDow(lower);
    const time = dowInfo ? extractTime(lower) : null;
    if (dowInfo && time) {
      // Try to extract employee name from text
      const nameMap = {
        "иса": "u1", "иса,": "u1",
        "дарина": "u2", "дарина,": "u2", "дарину": "u2",
        "ксюша": "u3", "ксюша,": "u3", "ксюшу": "u3",
        "карина": "u4", "карина,": "u4", "карину": "u4",
        "алёна": "u5", "алёна,": "u5", "алёну": "u5", "алена": "u5",
        "катя": "u6", "катя,": "u6", "катю": "u6",
        "рита": "u7", "рита,": "u7", "риту": "u7",
        "соня": "u8", "соня,": "u8", "соню": "u8",
      };
      let targetUserId = null;
      let reason = null;
      // Find name in text
      for (const [name, uid] of Object.entries(nameMap)) {
        if (lower.includes(name)) {
          targetUserId = uid;
          // Extract reason: everything after the name
          const nameIdx = lower.indexOf(name);
          const afterName = lower.slice(nameIdx + name.length).trim().replace(/^,\s*/, "");
          if (afterName) reason = afterName;
          break;
        }
      }
      if (targetUserId) {
        const date = nextWeekdayBerlin(receivedAt, dowInfo.dowIndex);
        results.push({
          fact_type: "PROBLEM_SHIFT",
          fact_payload: {
            date,
            dow: dowInfo.dow,
            from: time.from,
            to: time.to,
            user_id: targetUserId,
            reason,
            notes: text,
          },
          confidence: 0.75,
        });
        return results;
      }
    }
  }

  // Rule 2: Replacement request detection (BEFORE general NL — "не могу...кто сможет" must not be caught as plain unavailability)
  // "я не могу в чт утро, кто сможет?" → SHIFT_UNAVAILABILITY + needs_replacement flag
  const replacementRequestRe = /(?:не\s+могу|не\s+смогу|не\s+выйду|не\s+получится|заболела?|болею).*(?:кто\s+сможет|кто\s+выйдет|кто\s+заменит|кто\s+свободен|кто\s+может|нужна\s+замена|подмените|подменить|подмени|замена)/i;
  if (replacementRequestRe.test(lower)) {
    const dowInfo = extractRuDow(lower);
    const time = dowInfo ? extractTime(lower) : null;
    if (dowInfo && time) {
      const date = nextWeekdayBerlin(receivedAt, dowInfo.dowIndex);
      results.push({
        fact_type: "SHIFT_UNAVAILABILITY",
        fact_payload: {
          date,
          dow: dowInfo.dow,
          from: time.from,
          to: time.to,
          availability: "cannot",
          needs_replacement: true,
          notes: text,
        },
        confidence: 0.85,
      });
      return results;
    }
  }

  // Rule 3: Replacement offer detection (BEFORE general NL — "я смогу"/"могу заменить" must not be caught as plain availability)
  // "я смогу" / "я выйду" / "могу заменить" / "подменю" → SHIFT_REPLACEMENT
  const replacementOfferRe = /(?:я\s+смогу|я\s+выйду|могу\s+заменить|я\s+заменю|выйду\s+за|подменю|могу\s+подменить)/i;
  if (replacementOfferRe.test(lower)) {
    const dowInfo = extractRuDow(lower);
    const time = dowInfo ? extractTime(lower) : null;
    if (dowInfo && time) {
      const date = nextWeekdayBerlin(receivedAt, dowInfo.dowIndex);
      results.push({
        fact_type: "SHIFT_REPLACEMENT",
        fact_payload: {
          date,
          dow: dowInfo.dow,
          from: time.from,
          to: time.to,
          notes: text,
        },
        confidence: 0.7,
      });
      return results;
    }
  }

  // Rule 3b: Multi-line schedule format
  // "пн - утро\nвт - —\nчт - вечер" or "пн - утро, вечер"
  const multiLineResults = parseMultiLineSchedule(text, receivedAt);
  if (multiLineResults.length > 0) return multiLineResults;

  // Rule 3c: "все дни кроме пн" / "могу каждый день кроме пн"
  const allDaysResults = parseAllDaysExcept(text, receivedAt);
  if (allDaysResults.length > 0) return allDaysResults;

  // Rule 4: Russian NL availability / unavailability
  const nlResults = parseRussianNL(text, receivedAt);
  if (nlResults.length > 0) return nlResults;

  // Rule 5: SHIFT_SWAP_REQUEST (two shift mentions with "поменяй")
  const swapKeywords = ["поменяй", "поменяться", "обмен", "замени меня", "сменяться"];
  const hasSwap = swapKeywords.some((k) => lower.includes(k));
  if (hasSwap) {
    const pattern =
      /(пн|вт|ср|чт|пт|сб|вс)\s+(утро|день|вечер).*на\s+(пн|вт|ср|чт|пт|сб|вс)\s+(утро|день|вечер)/i;
    const m = lower.match(pattern);
    if (m) {
      const fromDayToken = m[1];
      const fromShiftWord = m[2];
      const toDayToken = m[3];
      const toShiftWord = m[4];

      const fromIndex = WEEKDAYS.indexOf(fromDayToken);
      const toIndex = WEEKDAYS.indexOf(toDayToken);
      if (fromIndex !== -1 && toIndex !== -1) {
        const fromDate = nextWeekdayBerlin(receivedAt, fromIndex);
        const toDate = nextWeekdayBerlin(receivedAt, toIndex);
        const fromShift =
          fromShiftWord === "утро"
            ? "morning"
            : fromShiftWord === "вечер"
            ? "evening"
            : "day";
        const toShift =
          toShiftWord === "утро"
            ? "morning"
            : toShiftWord === "вечер"
            ? "evening"
            : "day";

        results.push({
          fact_type: "SHIFT_SWAP_REQUEST",
          fact_payload: {
            from: { date: fromDate, shift: fromShift },
            to: { date: toDate, shift: toShift },
            status: "requested",
            notes: text,
          },
          confidence: 0.65,
        });
      }
    }
  }

  // Return if any rules matched
  if (results.length > 0) return results;

  // Rule 6 (FALLBACK): Fuzzy keyword matching — catches messages that existing rules miss
  const fuzzyResults = fuzzyMatchIntent(text, receivedAt);
  if (fuzzyResults.length > 0) return fuzzyResults;

  return results;
}

