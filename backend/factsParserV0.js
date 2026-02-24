// v0 deterministic parser for chat events -> structured facts.
// No LLM, only regex / rule-based parsing.

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

  // AVAIL <dow> <from>-<to>
  // Example: "AVAIL mon 10-13" -> SHIFT_AVAILABILITY
  const availMatch = upper.match(/^AVAIL\s+(mon|tue|wed|thu|fri|sat|sun)\s+(\d{1,2})-(\d{1,2})$/i);
  if (availMatch) {
    const dow = availMatch[1].toLowerCase();
    const fromHour = availMatch[2].padStart(2, "0");
    const toHour = availMatch[3].padStart(2, "0");
    const date = nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
    results.push({
      fact_type: "SHIFT_AVAILABILITY",
      fact_payload: {
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

  // CANT <dow> <from>-<to>
  // Example: "CANT thu 18-21" -> SHIFT_UNAVAILABILITY
  const cantMatch = upper.match(/^CANT\s+(\w+)\s+(\d{1,2})-(\d{1,2})$/);
  if (cantMatch) {
    const dow = cantMatch[1].toLowerCase();
    const fromHour = cantMatch[2].padStart(2, "0");
    const toHour = cantMatch[3].padStart(2, "0");
    if (DOW_MAP[dow] !== undefined) {
      const date = nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
      results.push({
        fact_type: "SHIFT_UNAVAILABILITY",
        fact_payload: {
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
        date = nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
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

  // EXTRA_CLASS [YYYY-MM-DD?] <dow> <from>-<to> [description]
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
        date = nextWeekdayBerlin(receivedAt, DOW_MAP[dow]);
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
  вечер: { from: "18:00", to: "21:00" },
  вечером: { from: "18:00", to: "21:00" },
  день: { from: "13:00", to: "18:00" },
  днём: { from: "13:00", to: "18:00" },
  днем: { from: "13:00", to: "18:00" },
};

/**
 * Extract Russian dow from text. Returns { dow, dowIndex } or null.
 */
function extractRuDow(text) {
  // Try full names first (longer match), then abbreviations
  const sorted = Object.keys(RU_DOW_MAP).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    const re = new RegExp(`(?:^|\\s|,)${key}(?:\\s|,|$)`, "i");
    if (re.test(text)) {
      const dow = RU_DOW_MAP[key];
      return { dow, dowIndex: DOW_MAP[dow] };
    }
  }
  return null;
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
 * Try to parse Russian NL availability/unavailability.
 * Returns array of facts or empty array.
 */
function parseRussianNL(text, receivedAt) {
  const lower = text.toLowerCase();

  // Detect negative before positive (не могу before могу)
  // Use explicit delimiters — \b doesn't work with Cyrillic in JS
  const S = "(?:^|[\\s,])"; // start-or-separator
  const E = "(?:[\\s,]|$)"; // end-or-separator
  const negativePatterns = [/не\s+могу/, /не\s+смогу/, new RegExp(S + "занята?" + E), new RegExp(S + "нет" + E)];
  const positivePatterns = [new RegExp(S + "могу" + E), new RegExp(S + "свободн"), new RegExp(S + "ок" + E), new RegExp(S + "да," )];

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

  const dowInfo = extractRuDow(lower);
  if (!dowInfo) return [];

  const time = extractTime(lower);
  if (!time) return [];

  // Full form with explicit marker → high confidence
  if (isNegative || isPositive) {
    const date = nextWeekdayBerlin(receivedAt, dowInfo.dowIndex);
    return [{
      fact_type: isNegative ? "SHIFT_UNAVAILABILITY" : "SHIFT_AVAILABILITY",
      fact_payload: {
        date,
        dow: dowInfo.dow,
        from: time.from,
        to: time.to,
        availability: isNegative ? "cannot" : "can",
        notes: text,
      },
      confidence: 0.85,
    }];
  }

  // Short form: day + time only, no keyword → default to availability, lower confidence
  // Skip if swap keywords present — let the swap parser handle those
  const swapKw = ["поменяй", "поменяться", "обмен", "замени меня", "сменяться"];
  if (swapKw.some((k) => lower.includes(k))) return [];

  // Check for leading minus/dash as negation: "- пн 10-13"
  const isShortNegative = /^\s*[-–—]\s/.test(text);
  const date = nextWeekdayBerlin(receivedAt, dowInfo.dowIndex);
  return [{
    fact_type: isShortNegative ? "SHIFT_UNAVAILABILITY" : "SHIFT_AVAILABILITY",
    fact_payload: {
      date,
      dow: dowInfo.dow,
      from: time.from,
      to: time.to,
      availability: isShortNegative ? "cannot" : "can",
      notes: text,
    },
    confidence: 0.6,
  }];
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

  // Rule 1: CLEANING_DONE (уборка выполнена)
  const cleaningPhrases = [
    "уборку сделала",
    "сделала уборку",
    "уборка сделана",
    "убралась",
    "убрался",
    "убрано",
    "уборку сделал",
  ];
  if (cleaningPhrases.some((p) => lower.includes(p))) {
    const dowInfo = extractRuDow(lower);
    const payload = {
      date: getBerlinDateFromIso(receivedAt),
      notes: text,
    };
    if (dowInfo) {
      payload.dow = dowInfo.dow;
      payload.date = nextWeekdayBerlin(receivedAt, dowInfo.dowIndex);
    }
    results.push({
      fact_type: "CLEANING_DONE",
      fact_payload: payload,
      confidence: 0.8,
    });
    return results;
  }

  // Rule 1b: EXTRA_CLASS (доп занятие)
  const extraClassPhrases = [
    "доп занятие",
    "допзанятие",
    "провела доп",
    "провёл доп",
    "провел доп",
    "дополнительное занятие",
    "доп урок",
    "допурок",
  ];
  if (extraClassPhrases.some((p) => lower.includes(p))) {
    const dowInfo = extractRuDow(lower);
    const time = dowInfo ? extractTime(lower) : null;
    if (dowInfo && time) {
      const date = nextWeekdayBerlin(receivedAt, dowInfo.dowIndex);
      results.push({
        fact_type: "EXTRA_CLASS",
        fact_payload: {
          date,
          dow: dowInfo.dow,
          from: time.from,
          to: time.to,
          notes: text,
        },
        confidence: 0.75,
      });
      return results;
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
        "дарина": "u2", "дарина,": "u2",
        "ксюша": "u3", "ксюша,": "u3",
        "карина": "u4", "карина,": "u4",
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

  return results;
}

