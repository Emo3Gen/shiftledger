/**
 * Paraplan Integration — unified entry point.
 *
 * Lazy-init: call init() once on first use.
 * After init, use getHours()/getGroups()/getTeachers()/refresh().
 *
 * Credentials from env: PARAPLAN_LOGIN, PARAPLAN_PASSWORD
 * Company ID hardcoded (single-tenant for now).
 */

import { ParaplanDataService } from "./dataService.js";
import { calculateHoursFromParaplan, toWeekHoursTemplate } from "./hoursCalculator.js";
import logger from "../../logger.js";

const COMPANY_ID = "ecfd714a-fbb9-d298-79a1-b16a7cff6c5f";
const BASE_URL = "https://paraplancrm.ru";

// Skip groups that are not real recurring groups
const SKIP_GROUPS = [
  "МИНИ-1 ср 14:30-15:30",
  "МИНИ-1 ЧТ (11:30-12:30)",
];

// Singleton state
let dataService = null;
let lastResult = null; // { hours, groups, teachers, updatedAt }
let initPromise = null;
let isInitialized = false;

function getCredentials() {
  const username = process.env.PARAPLAN_LOGIN;
  const password = process.env.PARAPLAN_PASSWORD;
  if (!username || !password) {
    return null;
  }
  return { username, password };
}

/**
 * Initialize the Paraplan integration (authenticate + load data).
 * Safe to call multiple times — only runs once.
 */
export async function init() {
  if (isInitialized) return lastResult;
  if (initPromise) return initPromise;

  initPromise = _doInit();
  try {
    const result = await initPromise;
    isInitialized = true;
    return result;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

async function _doInit() {
  const creds = getCredentials();
  if (!creds) {
    logger.warn("[paraplan] PARAPLAN_LOGIN / PARAPLAN_PASSWORD not set — integration disabled");
    return null;
  }

  dataService = new ParaplanDataService({
    baseUrl: BASE_URL,
    username: creds.username,
    password: creds.password,
    loginType: "KIDS_APP",
    companyId: COMPANY_ID,
  });

  await dataService.init();

  // Load hours immediately
  const result = await calculateHoursFromParaplan(dataService, { skipGroups: SKIP_GROUPS });
  lastResult = { ...result, updatedAt: new Date().toISOString() };

  logger.info(
    { groups: result.groups.length, daysWithHours: Object.keys(result.hours).length },
    "[paraplan] Data loaded"
  );

  return lastResult;
}

/**
 * Refresh data from Paraplan (re-fetch all groups + recalculate hours).
 */
export async function refresh() {
  if (!dataService) {
    return init();
  }

  dataService.invalidateAll();
  const result = await calculateHoursFromParaplan(dataService, { skipGroups: SKIP_GROUPS });
  lastResult = { ...result, updatedAt: new Date().toISOString() };

  logger.info(
    { groups: result.groups.length, daysWithHours: Object.keys(result.hours).length },
    "[paraplan] Data refreshed"
  );

  return lastResult;
}

/**
 * Refresh and recalculate with a junior filter.
 * @param {Array} groupsConfig - Array of { paraplan_id, requires_junior }
 */
export async function refreshWithFilter(groupsConfig) {
  if (!dataService) return init();

  // Build set of group IDs that require junior (only those count for hours)
  const juniorGroupIds = new Set(
    groupsConfig.filter((g) => g.requires_junior).map((g) => g.paraplan_id)
  );

  dataService.invalidateAll();
  const result = await calculateHoursFromParaplan(dataService, {
    skipGroups: SKIP_GROUPS,
    juniorGroupIds,
  });
  lastResult = { ...result, updatedAt: new Date().toISOString() };

  logger.info(
    { groups: result.groups.length, juniorFiltered: juniorGroupIds.size, daysWithHours: Object.keys(result.hours).length },
    "[paraplan] Data refreshed with junior filter"
  );

  return lastResult;
}

/**
 * Get current hours data (from cache, no API call).
 * Returns null if not initialized.
 */
export function getHours() {
  return lastResult?.hours || null;
}

/**
 * Get group details.
 */
export function getGroups() {
  return lastResult?.groups || [];
}

/**
 * Get teachers by group prefix.
 */
export function getTeachers() {
  return lastResult?.teachers || {};
}

/**
 * Get last update timestamp.
 */
export function getLastUpdate() {
  return lastResult?.updatedAt || null;
}

/**
 * Get WeekHoursTemplate for the schedule engine.
 * Merges Paraplan hours with the default template.
 */
export function getWeekHoursTemplate(defaultTemplate) {
  if (!lastResult?.hours) return defaultTemplate;
  return toWeekHoursTemplate(lastResult.hours, defaultTemplate);
}

/**
 * Get the internal data service (for direct API calls like compensations).
 */
export function getDataService() {
  return dataService;
}

/**
 * Check if Paraplan integration is available (credentials configured).
 */
export function isConfigured() {
  return !!getCredentials();
}

/**
 * Check if Paraplan integration is initialized and has data.
 */
export function isReady() {
  return isInitialized && !!lastResult;
}

/**
 * Get status summary for API/UI.
 */
export function getStatus() {
  const creds = getCredentials();
  return {
    configured: !!creds,
    initialized: isInitialized,
    ready: isReady(),
    updatedAt: lastResult?.updatedAt || null,
    groupCount: lastResult?.groups?.length || 0,
    teacherCount: Object.keys(lastResult?.teachers || {}).length,
    daysWithHours: Object.keys(lastResult?.hours || {}).length,
    cacheStats: dataService?.cache?.getStats() || null,
    apiStats: dataService?.stats || null,
  };
}

/**
 * Get groups schedule for a specific date (uses the day-of-week).
 * @param {string} dateStr - ISO date string "YYYY-MM-DD"
 */
export function getGroupsForDate(dateStr) {
  if (!lastResult?.hours) return null;

  const date = new Date(dateStr + "T00:00:00");
  const jsDay = date.getDay(); // 0=Sun..6=Sat
  const DOW_FROM_JS = { 0: "sun", 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat" };
  const dow = DOW_FROM_JS[jsDay];

  const dayHours = lastResult.hours[dow];
  if (!dayHours) return { dow, morning: null, evening: null };

  return {
    dow,
    morning: dayHours.morning || null,
    evening: dayHours.evening || null,
  };
}
