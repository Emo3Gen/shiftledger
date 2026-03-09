/**
 * Paraplan Hours Calculator
 *
 * Loads group schedule from Paraplan CRM and calculates paid hours per slot.
 *
 * Logic:
 *   1. Fetch all groups with schedules from Paraplan
 *   2. For each day of week, split groups into morning (before 14:00) and evening (after 14:00)
 *   3. For each slot:
 *      - paid_start = first_group_start - 1 hour
 *      - paid_end = last_group_end + 1 hour
 *      - hours = paid_end - paid_start
 *   4. Extract teacher (ведущий) for each group
 */

import logger from "../../logger.js";

const DOW_MAP = {
  1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat", 7: "sun",
};

const DOW_RU = {
  mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс",
};

// Paraplan weekDay: 1=Mon..7=Sun → our dow string
function paraplanDayToDow(weekDay) {
  return DOW_MAP[weekDay] || null;
}

function timeToMinutes(hour, minute) {
  return (hour || 0) * 60 + (minute || 0);
}

function minutesToHours(minutes) {
  return Math.round(minutes / 60 * 10) / 10; // round to 0.1
}

function formatTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function shortName(fullName) {
  if (!fullName) return null;
  const parts = fullName.split(/\s+/);
  if (parts.length < 2) return fullName;
  return `${parts[0]} ${parts[1][0]}.`;
}

/**
 * Extract prefix from Paraplan group name.
 * "МИНИ-1 ВТ (17:00-18:00)" → "МИНИ-1"
 */
function extractPrefix(name) {
  const upper = name.toUpperCase();
  const PREFIXES = ["СТАРТ-2", "СТАРТ-1", "МИНИ-2", "МИНИ-1", "ПКШК", "ГКП", "ИНГЛИШ", "РИСОВАНИЕ"];
  for (const p of PREFIXES) {
    if (upper.startsWith(p)) return p;
  }
  return null;
}

const MORNING_CUTOFF = 14 * 60; // 14:00 in minutes — groups starting before this = morning
const PREP_BUFFER_MINUTES = 60; // 1 hour before first group / after last group

/**
 * Calculate slot hours from Paraplan group data.
 *
 * @param {Object} dataService - initialized ParaplanDataService
 * @param {Object} [options]
 * @param {string[]} [options.skipGroups] - group names to skip
 * @param {Set<string>} [options.juniorGroupIds] - if set, only include groups with these IDs for hours calculation
 * @returns {Object} Result with hours per dow/slot + group details
 */
export async function calculateHoursFromParaplan(dataService, options = {}) {
  const skipSet = new Set((options.skipGroups || []).map((s) => s.toLowerCase()));
  const juniorGroupIds = options.juniorGroupIds || null; // null = no filter, include all

  // Load all groups with details
  // Try paginated groups first, then min-info as fallback
  let groupList = [];
  try {
    const paginatedResp = await dataService.getGroups();
    groupList = paginatedResp?.itemList || paginatedResp?.groupList || paginatedResp?.content || [];
    if (Array.isArray(paginatedResp) && groupList.length === 0) groupList = paginatedResp;
    logger.info({ count: groupList.length, keys: Object.keys(paginatedResp || {}).slice(0, 10) }, "[paraplan-hours] getGroups response");
  } catch (err) {
    logger.warn({ err: err.message }, "[paraplan-hours] getGroups failed, trying min-info");
  }

  if (groupList.length === 0) {
    try {
      const minInfo = await dataService.getGroupsMinInfo();
      groupList = minInfo?.itemList || minInfo?.groupList || minInfo?.content || [];
      if (Array.isArray(minInfo) && groupList.length === 0) groupList = minInfo;
      logger.info({ count: groupList.length }, "[paraplan-hours] getGroupsMinInfo: %d groups", groupList.length);
    } catch (err) {
      logger.warn({ err: err.message }, "[paraplan-hours] getGroupsMinInfo also failed");
    }
  }

  if (groupList.length === 0) {
    logger.warn("[paraplan-hours] No groups from Paraplan");
    return { hours: {}, groups: [], teachers: {} };
  }

  // Fetch full details for each group (with schedule/teachers)
  const allLessons = []; // { dow, startMinutes, endMinutes, groupName, prefix, teacher, teacherFull, duration }
  const teachersByPrefix = {}; // prefix → Set<shortName>
  const groupDetails = [];

  for (const g of groupList) {
    if (skipSet.has(g.name.toLowerCase())) continue;

    try {
      const detail = await dataService.getGroupDetails(g.id);
      if (!detail?.group) continue;

      const group = detail.group;
      const prefix = extractPrefix(group.name);
      if (!prefix) continue;

      const lessons = group.schedule?.lessonList || [];
      for (const lesson of lessons) {
        const dow = paraplanDayToDow(lesson.weekDay);
        if (!dow) continue;

        const startMin = timeToMinutes(lesson.startTime?.hour, lesson.startTime?.minute);
        const endMin = startMin + (lesson.durationMinutes || 60);
        const teacher = lesson.teacherList?.[0]?.name || group.teacherList?.[0]?.name || null;

        // Only include in hours calculation if:
        // - no juniorGroupIds filter, OR
        // - this group ID is in the juniorGroupIds set
        const includeInHours = !juniorGroupIds || juniorGroupIds.has(group.id);

        allLessons.push({
          dow,
          startMinutes: startMin,
          endMinutes: endMin,
          groupName: group.name,
          prefix,
          teacher: shortName(teacher),
          teacherFull: teacher,
          duration: lesson.durationMinutes || 60,
          studentCount: group.studentCount || 0,
          includeInHours,
        });

        // Track teachers per prefix
        if (teacher) {
          if (!teachersByPrefix[prefix]) teachersByPrefix[prefix] = new Set();
          teachersByPrefix[prefix].add(shortName(teacher));
        }
      }

      groupDetails.push({
        id: group.id,
        name: group.name,
        prefix,
        studentCount: group.studentCount || 0,
        teachers: (group.teacherList || []).map((t) => ({
          name: shortName(t.name),
          fullName: t.name,
          id: t.id,
        })),
        lessons: lessons.map((l) => ({
          weekDay: l.weekDay,
          dow: paraplanDayToDow(l.weekDay),
          startTime: `${String(l.startTime?.hour || 0).padStart(2, "0")}:${String(l.startTime?.minute || 0).padStart(2, "0")}`,
          duration: l.durationMinutes || 60,
        })),
      });

      // Rate-limit between requests
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      logger.warn({ err: err.message, group: g.name }, "[paraplan-hours] Failed to load group");
    }
  }

  // Group lessons by dow
  const lessonsByDow = {};
  for (const lesson of allLessons) {
    if (!lessonsByDow[lesson.dow]) lessonsByDow[lesson.dow] = [];
    lessonsByDow[lesson.dow].push(lesson);
  }

  // Calculate hours per dow × slot (morning/evening)
  const hours = {};
  const DOW_LIST = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

  for (const dow of DOW_LIST) {
    const dayLessons = lessonsByDow[dow] || [];
    if (dayLessons.length === 0) continue;

    // Split into morning (start < 14:00) and evening (start >= 14:00)
    // Only include lessons marked includeInHours for the hours calculation
    const morningAll = dayLessons.filter((l) => l.startMinutes < MORNING_CUTOFF);
    const eveningAll = dayLessons.filter((l) => l.startMinutes >= MORNING_CUTOFF);
    const morning = morningAll.filter((l) => l.includeInHours);
    const evening = eveningAll.filter((l) => l.includeInHours);

    hours[dow] = {};

    if (morning.length > 0) {
      const firstStart = Math.min(...morning.map((l) => l.startMinutes));
      const lastEnd = Math.max(...morning.map((l) => l.endMinutes));
      const paidStart = Math.max(0, firstStart - PREP_BUFFER_MINUTES);
      const paidEnd = lastEnd + PREP_BUFFER_MINUTES;
      const slotHours = minutesToHours(paidEnd - paidStart);

      hours[dow].morning = {
        hours: slotHours,
        paid_start: formatTime(paidStart),
        paid_end: formatTime(paidEnd),
        groups: morningAll.map((l) => ({
          name: l.groupName,
          prefix: l.prefix,
          start: formatTime(l.startMinutes),
          end: formatTime(l.endMinutes),
          teacher: l.teacher,
          students: l.studentCount,
          included: l.includeInHours,
        })),
      };
    }

    if (evening.length > 0) {
      const firstStart = Math.min(...evening.map((l) => l.startMinutes));
      const lastEnd = Math.max(...evening.map((l) => l.endMinutes));
      const paidStart = Math.max(0, firstStart - PREP_BUFFER_MINUTES);
      const paidEnd = lastEnd + PREP_BUFFER_MINUTES;
      const slotHours = minutesToHours(paidEnd - paidStart);

      hours[dow].evening = {
        hours: slotHours,
        paid_start: formatTime(paidStart),
        paid_end: formatTime(paidEnd),
        groups: eveningAll.map((l) => ({
          name: l.groupName,
          prefix: l.prefix,
          start: formatTime(l.startMinutes),
          end: formatTime(l.endMinutes),
          teacher: l.teacher,
          students: l.studentCount,
          included: l.includeInHours,
        })),
      };
    }
  }

  // Convert teacher sets to arrays
  const teachers = {};
  for (const [prefix, names] of Object.entries(teachersByPrefix)) {
    teachers[prefix] = Array.from(names);
  }

  logger.info(
    { daysWithHours: Object.keys(hours).length, totalGroups: groupDetails.length, totalLessons: allLessons.length },
    "[paraplan-hours] Calculation complete"
  );

  return { hours, groups: groupDetails, teachers };
}

/**
 * Convert calculated hours to WeekHoursTemplate format for the schedule engine.
 * Falls back to defaultTemplate for days/slots not covered by Paraplan.
 *
 * @param {Object} paraplanHours - hours object from calculateHoursFromParaplan
 * @param {Object} defaultTemplate - fallback WeekHoursTemplate
 * @returns {Object} WeekHoursTemplate-compatible object
 */
export function toWeekHoursTemplate(paraplanHours, defaultTemplate) {
  const DOW_LIST = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const result = {};

  for (const dow of DOW_LIST) {
    const paraplan = paraplanHours[dow];
    const fallback = defaultTemplate[dow] || { morning: 5, evening: 6 };

    result[dow] = {
      morning: paraplan?.morning?.hours ?? fallback.morning,
      evening: paraplan?.evening?.hours ?? fallback.evening,
    };
  }

  return result;
}
