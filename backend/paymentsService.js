/**
 * PaymentsService — ежедневный список оплат через Emogen API.
 *
 * Записи: Emogen /api/paraplan/records
 * Цены:   Emogen /api/settings/groups
 */

import logger from "./logger.js";
import { getBotMode, ADMIN_CHAT_ID } from "./botMode.js";

const EMOGEN_API_URL = process.env.EMOGEN_API_URL || "http://127.0.0.1:3001";
const EMOGEN_API_PASSWORD = process.env.EMOGEN_API_PASSWORD || "prodeti2026";
const emogenAuthHeader = "Basic " + Buffer.from(":" + EMOGEN_API_PASSWORD).toString("base64");

const DOW_RU = { 0: "вс", 1: "пн", 2: "вт", 3: "ср", 4: "чт", 5: "пт", 6: "сб" };

/**
 * Fetch records from Emogen /api/paraplan/records.
 */
export async function fetchRecords(date) {
  const url = `${EMOGEN_API_URL}/api/paraplan/records?date=${encodeURIComponent(date)}`;
  const r = await fetch(url, { headers: { Authorization: emogenAuthHeader } });
  if (!r.ok) throw new Error(`Emogen records API: ${r.status} ${r.statusText}`);
  return r.json();
}

/**
 * Fetch group prices from Emogen /api/settings/groups.
 */
export async function fetchGroupPrices() {
  const url = `${EMOGEN_API_URL}/api/settings/groups`;
  const r = await fetch(url, { headers: { Authorization: emogenAuthHeader } });
  if (!r.ok) throw new Error(`Emogen groups API: ${r.status} ${r.statusText}`);
  return r.json();
}

/**
 * Calculate pro-rated subscription price until end of month.
 * @param {string} groupName - e.g. "МИНИ-2"
 * @param {string} dateStr - ISO date "YYYY-MM-DD"
 * @param {object} pricesData - response from /api/settings/groups
 * @param {object} recordsData - response from getRecordsForDate
 */
export function calculateSubscriptionPrice(groupName, dateStr, pricesData, recordsData) {
  const groups = pricesData?.groups || [];
  // Extract prefix from full group name like "МИНИ-1 ПН (10:00-11:00)" → "МИНИ-1"
  const prefix = groupName.split(/\s+(?:ПН|ВТ|СР|ЧТ|ПТ|СБ|ВС)\b/i)[0].trim() || groupName;
  const group = groups.find(g => g.name === groupName || g.name === prefix);
  if (!group) return null;

  // Find the best subscription template for this group
  const subs = group.subscriptions || [];
  // Pick "2 раза в неделю" first, fallback to any subscription, fallback to single_visit
  const sub = subs.find(s => s.visits === 8) || subs.find(s => s.visits === 4) || subs[0];

  if (!sub && !group.single_visit) return null;

  const monthlyPrice = sub ? sub.price : (group.single_visit * 8);
  const monthlyVisits = sub ? sub.visits : 8;

  // Count remaining lessons this month from the date
  const d = new Date(dateStr + "T00:00:00");
  const year = d.getFullYear();
  const month = d.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();

  // Try to infer lesson days from the records response
  const scheduleDays = recordsData?.schedule_days?.[groupName] || [];

  let remainingLessons = 0;
  if (scheduleDays.length > 0) {
    for (let day = d.getDate(); day <= lastDay; day++) {
      const dt = new Date(year, month, day);
      const dow = dt.getDay();
      if (scheduleDays.includes(dow)) remainingLessons++;
    }
  } else {
    // Fallback: estimate based on subscription type
    const weeksLeft = Math.ceil((lastDay - d.getDate() + 1) / 7);
    const timesPerWeek = monthlyVisits / 4;
    remainingLessons = Math.round(weeksLeft * timesPerWeek);
  }

  if (remainingLessons <= 0) remainingLessons = 1;

  const pricePerLesson = monthlyPrice / monthlyVisits;
  const proRatedPrice = Math.round((pricePerLesson * remainingLessons) / 100) * 100;

  return {
    totalPrice: proRatedPrice,
    remainingLessons,
    monthlyPrice,
    monthlyVisits,
    subName: sub?.name || "разовое",
  };
}

/**
 * Format payment list as Telegram HTML message.
 */
export function formatPaymentsList(recordsData, pricesData, dateStr) {
  const records = recordsData?.records || [];
  if (records.length === 0) return "Нет записей на эту дату.";

  const d = new Date(dateStr + "T00:00:00");
  const dow = DOW_RU[d.getDay()];
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();

  let text = `📋 <b>Оплаты на ${dow} ${dd}.${mm}.${yyyy}</b>\n`;

  // Group records by "group (time)"
  const bySlot = new Map();
  for (const rec of records) {
    const key = `${rec.group}|${rec.time}`;
    if (!bySlot.has(key)) bySlot.set(key, []);
    bySlot.get(key).push(rec);
  }

  const summary = { total: 0, active: 0, trial: 0, compensation: 0, unpaid: 0, frozen: 0 };
  let needsAction = false;

  for (const [slotKey, slotRecords] of bySlot) {
    const [groupName, time] = slotKey.split("|");
    // Avoid duplicating time if group name already contains it (e.g. "МИНИ-1 ПН (10:00-11:00)")
    const hasTime = /\(\d{2}:\d{2}/.test(groupName);
    text += `\n<b>${hasTime ? groupName : `${groupName} (${time || "?"})`}</b>\n`;

    for (const rec of slotRecords) {
      summary.total++;
      const status = rec.status || "active";
      summary[status] = (summary[status] || 0) + 1;

      const studentName = rec.student || "?";
      const sub = rec.subscription || {};
      const parentName = rec.parent_name;
      const displayName = parentName ? `${studentName} (мама ${parentName})` : studentName;

      if (status === "active") {
        const remaining = sub.remaining != null ? ` (ост. ${sub.remaining} зан.)` : "";
        text += `✅ ${displayName} — абонемент${remaining}\n`;
      } else if (status === "compensation") {
        const orig = sub.original_group ? ` (из ${sub.original_group})` : "";
        text += `✅ ${displayName} — отработка${orig}\n`;
      } else if (status === "frozen") {
        text += `✅ ${displayName} — заморозка\n`;
      } else if (status === "trial") {
        needsAction = true;
        const trialPrice = getTrialPrice(groupName, pricesData);
        const subPrice = calculateSubscriptionPrice(groupName, dateStr, pricesData, recordsData);
        text += `🔵 ${displayName} — пробное:\n`;
        if (trialPrice) text += `   • Разово: ${trialPrice}₽\n`;
        if (subPrice) {
          const monthName = getMonthName(d.getMonth());
          text += `   • Абонемент ${subPrice.remainingLessons} зан. (${monthName}): ${subPrice.totalPrice}₽\n`;
        }
      } else if (status === "unpaid") {
        needsAction = true;
        const subPrice = calculateSubscriptionPrice(groupName, dateStr, pricesData, recordsData);
        if (subPrice) {
          text += `💰 ${displayName} — абонемент с ${dd}.${mm} (${subPrice.remainingLessons} зан.): ${subPrice.totalPrice}₽\n`;
        } else {
          text += `💰 ${displayName} — не оплачено\n`;
        }
      } else {
        text += `❓ ${displayName} — ${status}\n`;
      }
    }
  }

  if (!needsAction && summary.total > 0) {
    text += "\n✅ Все оплачены";
  }

  // Summary
  text += `\n\n<i>Всего: ${summary.total}`;
  const parts = [];
  if (summary.active) parts.push(`${summary.active} абон.`);
  if (summary.trial) parts.push(`${summary.trial} проб.`);
  if (summary.compensation) parts.push(`${summary.compensation} отраб.`);
  if (summary.unpaid) parts.push(`${summary.unpaid} неопл.`);
  if (summary.frozen) parts.push(`${summary.frozen} замор.`);
  if (parts.length) text += ` (${parts.join(", ")})`;
  text += "</i>";

  return text;
}

/**
 * Get trial price for a group.
 */
function getTrialPrice(groupName, pricesData) {
  const groups = pricesData?.groups || [];
  const prefix = groupName.split(/\s+(?:ПН|ВТ|СР|ЧТ|ПТ|СБ|ВС)\b/i)[0].trim() || groupName;
  const g = groups.find(gr => gr.name === groupName || gr.name === prefix);
  return g?.trial_price || null;
}

/**
 * Russian month name.
 */
function getMonthName(monthIndex) {
  const MONTHS = ["янв", "фев", "март", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  return MONTHS[monthIndex] || "?";
}

/**
 * Main: fetch data, format, send to Telegram.
 * @param {object} bot - grammY bot instance
 * @param {string} chatId - Telegram chat ID
 * @param {string} dateStr - ISO date "YYYY-MM-DD"
 * @param {number} [threadId] - Telegram forum thread ID
 */
export async function sendPaymentsList(bot, chatId, dateStr, threadId) {
  // 1. Fetch records from Emogen
  let recordsData;
  try {
    recordsData = await fetchRecords(dateStr);
  } catch (e) {
    logger.warn({ err: e, date: dateStr }, "Payments: Emogen records unavailable");
    throw new Error("Emogen API недоступен: " + e.message);
  }

  // 2. Fetch group prices from Emogen
  let pricesData;
  try {
    pricesData = await fetchGroupPrices();
  } catch (e) {
    logger.warn({ err: e }, "Payments: Emogen prices unavailable");
    pricesData = { groups: [] };
  }

  // 3. Format message
  const text = formatPaymentsList(recordsData, pricesData, dateStr);

  // 4. Send to Telegram
  const botMode = getBotMode();
  if (botMode === "manual") {
    logger.info({ chatId, date: dateStr, botMode }, "Payments list suppressed (manual mode)");
    return { ok: true, message_id: null, date: dateStr, records: recordsData?.records?.length || 0, mode: "manual" };
  }

  // debug mode → redirect to admin DM
  const targetChat = botMode === "debug" && ADMIN_CHAT_ID ? ADMIN_CHAT_ID : chatId;
  const debugPrefix = botMode === "debug" ? "[DEBUG]\n" : "";

  const opts = { parse_mode: "HTML" };
  // Only set thread_id for actual group (not debug redirect)
  if (threadId && targetChat === chatId) opts.message_thread_id = Number(threadId);

  const sent = await bot.api.sendMessage(targetChat, debugPrefix + text, opts);
  logger.info({ chatId: targetChat, date: dateStr, messageId: sent.message_id, botMode }, "Payments list sent");

  return { ok: true, message_id: sent.message_id, date: dateStr, records: recordsData?.records?.length || 0 };
}
