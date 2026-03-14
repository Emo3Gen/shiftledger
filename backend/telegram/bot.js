/**
 * Telegram bot using grammY.
 *
 * Reads TELEGRAM_BOT_TOKEN from env.
 * Forwards messages to the internal ingest flow and replies with results.
 */

import { Bot, InputFile } from "grammy";
import logger from "../logger.js";
import { formatFacts, formatSchedule, formatPayBreakdown, formatPinnedSchedule } from "./formatters.js";
import { UserDirectory } from "../userDirectory.js";
import { generateScheduleImage } from "../services/scheduleImage.js";

import { getBotMode, ADMIN_CHAT_ID } from "../botMode.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const IS_DEV = process.env.APP_ENV === "dev" || process.env.TEST_MODE === "true";

// In-memory store: chatId → pinned message_id
const pinnedMessageIds = new Map();

// In-memory store for /as role switching (dev mode only): telegram_user_id → { employeeId, employeeName }
const devRoleOverrides = new Map();

// Name → employee_id mapping for /as command
const NAME_TO_ID = {
  "иса": "u1", "isa": "u1",
  "дарина": "u2", "darina": "u2", "daria": "u2",
  "ксюша": "u3", "ksusha": "u3", "ksu": "u3",
  "карина": "u4", "karina": "u4",
  "алёна": "u5", "алена": "u5", "alena": "u5",
  "катя": "u6", "katya": "u6",
  "рита": "u7", "rita": "u7",
  "соня": "u8", "sonya": "u8",
};

// employee_id → display name
const ID_TO_NAME = {
  u1: "Иса", u2: "Дарина", u3: "Ксюша", u4: "Карина",
  u5: "Алёна", u6: "Катя", u7: "Рита", u8: "Соня",
};

/**
 * Build reply options that preserve message_thread_id for forum topics.
 */
function replyOptions(ctx, extra = {}) {
  const opts = { ...extra };
  if (ctx.message?.message_thread_id) {
    opts.message_thread_id = ctx.message.message_thread_id;
  }
  return opts;
}

/**
 * Build the ingest payload from a Telegram context.
 */
export function buildIngestPayload(ctx) {
  return {
    tenant_id: process.env.DEFAULT_TENANT_ID || "dev",
    channel: "telegram",
    chat_id: String(ctx.chat.id),
    user_id: String(ctx.from.id),
    message_id: String(ctx.message.message_id),
    ts: new Date(ctx.message.date * 1000).toISOString(),
    text: ctx.message.text,
    meta: {
      role: "staff",
      telegram: {
        chat_type: ctx.chat.type,
        message_thread_id: ctx.message?.message_thread_id,
        is_forum: ctx.chat?.is_forum,
        first_name: ctx.from.first_name,
        username: ctx.from.username,
      },
    },
  };
}

const WELCOME_TEXT = `Привет! Я бот ShiftLedger для управления расписанием.

Как сообщить о доступности:
• могу пн 10-13
• могу вт утро
• не могу чт вечер
• свободна ср с 14 до 17

Попросить замену:
• не могу в чт утро, кто сможет?

Выйти на замену:
• я смогу в чт утро

Команды:
/schedule или "расписание" — график на неделю
/status или "статус" — статус недели
/pay или "зарплата" — моя зарплата
/availability или "доступность" — моя доступность
/help или "помощь" — справка
/as Имя — играть за сотрудника (тест)`;

const HELP_TEXT = `<b>Как пользоваться</b>

<b>Сообщить доступность:</b>
• могу пн утро
• вт вечер
• все дни кроме среды

<b>Сообщить что не можете:</b>
• не могу чт утро
• не могу в пятницу

<b>Попросить замену:</b>
• не могу в чт утро, кто сможет?

<b>Выйти на замену:</b>
• я смогу в чт утро

<b>Команды:</b>
/schedule или "расписание" — график на неделю
/status — статус недели
/availability или "доступность" — моя доступность
/help или "помощь" — эта справка`;

const DOW_RU = { mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" };

/**
 * Format multiple facts into a compact confirmation reply.
 * "✅ Иса: Пн утро, Чт вечер, Сб вечер"
 */
function formatMultiFactReply(facts, userName) {
  // For a single fact, use the specific formatter
  if (facts.length === 1) {
    const specific = formatFactReply(facts[0], userName);
    if (specific) return specific;
  }

  // Group availability/unavailability facts by day
  const availFacts = facts.filter(f => f.fact_type === "SHIFT_AVAILABILITY" || f.fact_type === "SHIFT_UNAVAILABILITY");

  if (availFacts.length === 0) {
    // Not availability facts — use single fact formatter or generic
    const specific = formatFactReply(facts[0], userName);
    if (specific) return specific;
    return `✅ Принято: ${formatFacts(facts)}`;
  }

  // Build compact display: group by day, show slot
  const daySlots = new Map(); // dow → { available: [slots], unavailable: [slots] }
  const DOW_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

  for (const f of availFacts) {
    const p = f.fact_payload || {};
    const dow = p.dow;
    if (!dow) continue;
    if (!daySlots.has(dow)) daySlots.set(dow, { available: [], unavailable: [] });
    const entry = daySlots.get(dow);
    const slotName = p.from === "10:00" ? "утро" : p.from === "18:00" ? "вечер" : `${p.from}-${p.to}`;
    if (f.fact_type === "SHIFT_AVAILABILITY") {
      entry.available.push(slotName);
    } else {
      entry.unavailable.push(slotName);
    }
  }

  // Sort by day order
  const sortedDays = [...daySlots.entries()].sort((a, b) => DOW_ORDER.indexOf(a[0]) - DOW_ORDER.indexOf(b[0]));

  const parts = [];
  for (const [dow, slots] of sortedDays) {
    const dayLabel = DOW_RU[dow] || dow;
    if (slots.available.length > 0) {
      parts.push(`${dayLabel} ${slots.available.join(", ")} ✅`);
    }
    if (slots.unavailable.length > 0) {
      parts.push(`${dayLabel} ✖`);
    }
  }

  if (parts.length === 0) return `✅ Принято`;

  return `✅ ${userName}:\n${parts.join("\n")}`;
}

const STATE_RU = {
  COLLECTING: "Сбор доступности",
  ACTIVE: "График активен",
  CLOSED: "Неделя закрыта",
};

/**
 * Format a single fact into a bot reply.
 */
function formatFactReply(fact, userName) {
  const p = fact.fact_payload || {};
  const dow = DOW_RU[p.dow] || p.dow || "";
  const time = p.from && p.to ? `${p.from}-${p.to}` : "";
  const shift = dow && time ? `${dow} ${time}` : dow || time;

  switch (fact.fact_type) {
    case "SHIFT_AVAILABILITY":
      return `✅ Принято: ${userName} может ${shift}`;
    case "SHIFT_UNAVAILABILITY":
      if (p.needs_replacement) {
        return `⚠️ ${userName} не может ${shift}. Кто сможет выйти?`;
      }
      return `✅ Принято: ${userName} не может ${shift}`;
    case "SHIFT_REPLACEMENT":
      return `🔄 Замена: ${shift} — ${userName} выходит на замену. График обновлён.`;
    case "EXTRA_CLASS": {
      const kidsCount = p.kids_count;
      const BASE_RATE = 500;
      const THRESHOLD = 8;
      const PER_KID = 100;
      if (kidsCount != null && kidsCount > THRESHOLD) {
        const extraKids = kidsCount - THRESHOLD;
        const total = BASE_RATE + extraKids * PER_KID;
        return `✅ Доп.занятие ${dow}: ${kidsCount} детей (порог ${THRESHOLD}). Оплата: ${BASE_RATE} + ${extraKids}×${PER_KID} = ${total}₽`;
      }
      return `✅ Доп.занятие ${dow}: ${kidsCount ?? "—"} детей. Оплата: ${BASE_RATE}₽`;
    }
    case "CLEANING_HELP_REQUEST":
      return `⚠️ ${userName} ищет замену на уборку ${dow}. Кто сможет?`;
    case "CLEANING_DONE":
      return `✅ Уборка ${dow}: ${userName} — записано.`;
    case "CLEANING_SWAP": {
      const replacement = p.replacement_user_id;
      const original = p.original_user_id;
      if (replacement) {
        const replName = UserDirectory.getDisplayName(replacement);
        return `✅ Уборка ${dow}: ${replName} вместо ${userName}`;
      }
      if (original) {
        const origName = UserDirectory.getDisplayName(original);
        return `✅ Уборка ${dow}: ${userName} вместо ${origName}`;
      }
      return `✅ Уборка ${dow}: замена записана.`;
    }
    default:
      return null; // Use generic formatter
  }
}

/**
 * Resolve internal employee ID from Telegram user ID.
 * Returns { employeeId, employeeName } or null if unknown.
 */
async function resolveEmployee(telegramUserId, empService) {
  if (!empService) return null;
  try {
    const emp = await empService.getByTelegramUserId(String(telegramUserId));
    if (emp) {
      return { employeeId: emp.id, employeeName: emp.name };
    }
  } catch (err) {
    logger.debug({ err }, "resolveEmployee error");
  }
  return null;
}

/**
 * Create and configure the bot instance.
 * @param {Function} ingestFn - async function(payload) => { facts_preview, ... }
 * @param {Function} scheduleFn - async function(chatId) => schedule object
 * @param {Function} [weekStateFn] - async function(chatId) => week state object
 * @param {Function} [timesheetFn] - async function(chatId) => timesheet object
 * @param {Object} [employeeService] - employee service for Telegram mapping
 */
export function createBot(ingestFn, scheduleFn, weekStateFn, timesheetFn, employeeService) {
  if (!TOKEN) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — bot disabled");
    return null;
  }

  const bot = new Bot(TOKEN);

  // Debug: log ALL incoming updates
  bot.use(async (ctx, next) => {
    logger.info({
      update_id: ctx.update.update_id,
      chat_id: ctx.chat?.id,
      chat_type: ctx.chat?.type,
      thread_id: ctx.message?.message_thread_id,
      is_topic: ctx.message?.is_topic_message,
      is_forum: ctx.chat?.is_forum,
      from_id: ctx.from?.id,
      from_name: ctx.from?.first_name,
      text: ctx.message?.text?.substring(0, 100),
      has_message: !!ctx.message,
    }, "telegram incoming update");
    await next();
  });

  bot.command("start", async (ctx) => {
    await ctx.reply(WELCOME_TEXT, replyOptions(ctx, { parse_mode: "HTML" }));
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(HELP_TEXT, replyOptions(ctx, { parse_mode: "HTML" }));
  });

  bot.command("schedule", async (ctx) => {
    try {
      const chatId = String(ctx.chat.id);
      const schedule = await scheduleFn(chatId);
      const pngBuffer = generateScheduleImage(schedule);
      await ctx.replyWithPhoto(
        new InputFile(pngBuffer, "schedule.png"),
        replyOptions(ctx),
      );
    } catch (err) {
      logger.error({ err }, "telegram /schedule error");
      // Fallback to text if image generation fails
      try {
        const schedule = await scheduleFn(String(ctx.chat.id));
        const text = formatSchedule(schedule);
        await ctx.reply(text, replyOptions(ctx, { parse_mode: "HTML" }));
      } catch {
        await ctx.reply("❌ Ошибка загрузки расписания, попробуйте позже", replyOptions(ctx));
      }
    }
  });

  bot.command("status", async (ctx) => {
    try {
      if (!weekStateFn) {
        await ctx.reply("Команда /status пока недоступна", replyOptions(ctx));
        return;
      }
      const chatId = String(ctx.chat.id);
      const ws = await weekStateFn(chatId);
      const state = ws?.state || "COLLECTING";
      const stateLabel = STATE_RU[state] || state;
      const gapsOpen = ws?.gaps_open || [];
      const hasGaps = ws?.hasGaps || gapsOpen.length > 0;

      let text = `📊 <b>Статус недели</b>\n\nСостояние: <b>${stateLabel}</b>`;

      if (ws?.week_start) {
        text += `\nНеделя: ${ws.week_start}`;
      }

      if (hasGaps) {
        text += `\n\n⚠️ Незакрытые смены: ${gapsOpen.length}`;
        for (const gap of gapsOpen) {
          const d = DOW_RU[gap.dow] || gap.dow;
          text += `\n  ${d} ${gap.from}-${gap.to}`;
        }
      } else {
        text += "\n\n✅ Все смены закрыты";
      }

      await ctx.reply(text, replyOptions(ctx, { parse_mode: "HTML" }));
    } catch (err) {
      logger.error({ err }, "telegram /status error");
      await ctx.reply("❌ Ошибка загрузки статуса, попробуйте позже", replyOptions(ctx));
    }
  });

  bot.command("pay", async (ctx) => {
    try {
      if (!timesheetFn) {
        await ctx.reply("Команда /pay пока недоступна", replyOptions(ctx));
        return;
      }
      const chatId = String(ctx.chat.id);
      const devOvr = IS_DEV ? devRoleOverrides.get(String(ctx.from.id)) : null;
      const resolved = devOvr || await resolveEmployee(ctx.from.id, employeeService);
      const userId = resolved?.employeeId || String(ctx.from.id);
      const ts = await timesheetFn(chatId);
      const emp = ts?.employees?.find((e) => e.user_id === userId);
      if (!emp) {
        await ctx.reply("Данных по вашей зарплате пока нет.", replyOptions(ctx));
        return;
      }
      const text = formatPayBreakdown(emp);
      await ctx.reply(text, replyOptions(ctx, { parse_mode: "HTML" }));
    } catch (err) {
      logger.error({ err }, "telegram /pay error");
      await ctx.reply("❌ Ошибка загрузки зарплаты, попробуйте позже", replyOptions(ctx));
    }
  });

  // /link — show binding status for the current user
  bot.command("link", async (ctx) => {
    try {
      const resolved = await resolveEmployee(ctx.from.id, employeeService);
      if (resolved) {
        await ctx.reply(`✅ ${ctx.from.first_name} привязан как ${resolved.employeeName}`, replyOptions(ctx));
      } else {
        await ctx.reply(`❌ ${ctx.from.first_name} не найден в системе. Обратитесь к директору.`, replyOptions(ctx));
      }
    } catch (err) {
      logger.error({ err }, "telegram /link error");
      await ctx.reply("❌ Ошибка, попробуйте позже", replyOptions(ctx));
    }
  });

  // /availability or /доступность — show current availability template & declared facts
  bot.command("availability", async (ctx) => {
    try {
      const devOvr = IS_DEV ? devRoleOverrides.get(String(ctx.from.id)) : null;
      const resolved = devOvr || await resolveEmployee(ctx.from.id, employeeService);
      if (!resolved) {
        await ctx.reply("Сотрудник не найден в системе.", replyOptions(ctx));
        return;
      }
      const userId = resolved.employeeId;
      const schedule = await scheduleFn(String(ctx.chat.id));
      const slots = schedule?.slots || [];
      const DOW_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

      const available = [];
      const unavailable = [];

      for (const dow of DOW_ORDER) {
        const daySlots = slots.filter(s => s.dow === dow);
        const morningSlot = daySlots.find(s => s.slot_name === "Утро" || s.slot_name === "morning");
        const eveningSlot = daySlots.find(s => s.slot_name === "Вечер" || s.slot_name === "evening");

        const mAvail = morningSlot?.available_user_ids?.includes(userId);
        const eAvail = eveningSlot?.available_user_ids?.includes(userId);
        const mUnavail = morningSlot?.unavailable_user_ids?.includes(userId);
        const eUnavail = eveningSlot?.unavailable_user_ids?.includes(userId);

        const dayLabel = DOW_RU[dow] || dow;

        if (mUnavail && eUnavail) {
          unavailable.push(dayLabel);
        } else if (mUnavail) {
          unavailable.push(`${dayLabel} утро`);
          if (eAvail) available.push(`${dayLabel} вечер`);
        } else if (eUnavail) {
          unavailable.push(`${dayLabel} вечер`);
          if (mAvail) available.push(`${dayLabel} утро`);
        } else if (mAvail && eAvail) {
          available.push(`${dayLabel} весь день`);
        } else if (mAvail) {
          available.push(`${dayLabel} утро`);
        } else if (eAvail) {
          available.push(`${dayLabel} вечер`);
        }
      }

      let text = `<b>Доступность: ${resolved.employeeName}</b>\n`;
      if (available.length > 0) {
        text += `\n✅ Доступна: ${available.join(", ")}`;
      }
      if (unavailable.length > 0) {
        text += `\n✖ Не могу: ${unavailable.join(", ")}`;
      }
      if (available.length === 0 && unavailable.length === 0) {
        text += "\nДанных пока нет.";
      }
      text += `\n\n<i>Шаблон для ввода:</i>\nмогу пн утро, вт весь день\nне могу чт, пт`;
      await ctx.reply(text, replyOptions(ctx, { parse_mode: "HTML" }));
    } catch (err) {
      logger.error({ err }, "telegram /availability error");
      await ctx.reply("Ошибка загрузки доступности", replyOptions(ctx));
    }
  });

  // Dev-only command: /as ИмяСотрудника — switch identity for testing
  bot.command("as", async (ctx) => {
    if (!IS_DEV) {
      await ctx.reply("Команда /as доступна только в режиме разработки", replyOptions(ctx));
      return;
    }

    const arg = (ctx.message.text || "").replace(/^\/as(@\w+)?\s*/, "").trim().toLowerCase();
    if (!arg) {
      const currentOverride = devRoleOverrides.get(String(ctx.from.id));
      const currentName = currentOverride ? ID_TO_NAME[currentOverride.employeeId] || currentOverride.employeeId : "не задана";
      await ctx.reply(
        `Текущая роль: ${currentName}\n\nИспользование: /as Имя\nПример: /as Иса\n\nДоступные сотрудники:\n${Object.entries(ID_TO_NAME).map(([id, name]) => `• ${name} (${id})`).join('\n')}\n\nДля сброса: /as сброс`,
        replyOptions(ctx)
      );
      return;
    }

    // Reset override
    if (arg === "сброс" || arg === "reset" || arg === "off") {
      devRoleOverrides.delete(String(ctx.from.id));
      await ctx.reply("Роль сброшена. Теперь вы пишете от своего имени.", replyOptions(ctx));
      return;
    }

    const empId = NAME_TO_ID[arg];
    if (!empId) {
      await ctx.reply(`Сотрудник «${arg}» не найден.\n\nДоступные: ${Object.values(ID_TO_NAME).join(', ')}`, replyOptions(ctx));
      return;
    }

    const empName = ID_TO_NAME[empId] || empId;
    devRoleOverrides.set(String(ctx.from.id), { employeeId: empId, employeeName: empName });
    await ctx.reply(`Теперь вы пишете за ${empName} \uD83D\uDC64`, replyOptions(ctx));
  });

  bot.on("message:text", async (ctx) => {
    try {
      const text = ctx.message.text.trim().toLowerCase();

      // Russian text aliases for commands
      if (text === "расписание" || text === "график") {
        const chatId = String(ctx.chat.id);
        const schedule = await scheduleFn(chatId);
        const reply = formatSchedule(schedule);
        await ctx.reply(reply, replyOptions(ctx, { parse_mode: "HTML" }));
        return;
      }
      if (text === "статус") {
        if (weekStateFn) {
          const chatId = String(ctx.chat.id);
          const ws = await weekStateFn(chatId);
          const state = ws?.state || "COLLECTING";
          const stateLabel = STATE_RU[state] || state;
          const gapsOpen = ws?.gaps_open || [];
          let reply = `📊 Статус: <b>${stateLabel}</b>`;
          if (gapsOpen.length > 0) {
            reply += `\n⚠️ Незакрытых смен: ${gapsOpen.length}`;
          } else {
            reply += "\n✅ Все смены закрыты";
          }
          await ctx.reply(reply, replyOptions(ctx, { parse_mode: "HTML" }));
        } else {
          await ctx.reply("Команда 'статус' пока недоступна", replyOptions(ctx));
        }
        return;
      }
      if (text === "помощь") {
        await ctx.reply(HELP_TEXT, replyOptions(ctx, { parse_mode: "HTML" }));
        return;
      }
      if (text === "доступность") {
        try {
          const devOvrAvail = IS_DEV ? devRoleOverrides.get(String(ctx.from.id)) : null;
          const resolvedAvail = devOvrAvail || await resolveEmployee(ctx.from.id, employeeService);
          if (!resolvedAvail) {
            await ctx.reply("Сотрудник не найден в системе.", replyOptions(ctx));
            return;
          }
          const avUserId = resolvedAvail.employeeId;
          const avSchedule = await scheduleFn(String(ctx.chat.id));
          const avSlots = avSchedule?.slots || [];
          const DOW_ORD = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
          const avail = [], unavail = [];
          for (const dow of DOW_ORD) {
            const ds = avSlots.filter(s => s.dow === dow);
            const mS = ds.find(s => s.slot_name === "Утро" || s.slot_name === "morning");
            const eS = ds.find(s => s.slot_name === "Вечер" || s.slot_name === "evening");
            const mA = mS?.available_user_ids?.includes(avUserId);
            const eA = eS?.available_user_ids?.includes(avUserId);
            const mU = mS?.unavailable_user_ids?.includes(avUserId);
            const eU = eS?.unavailable_user_ids?.includes(avUserId);
            const dl = DOW_RU[dow] || dow;
            if (mU && eU) { unavail.push(dl); }
            else if (mU) { unavail.push(`${dl} утро`); if (eA) avail.push(`${dl} вечер`); }
            else if (eU) { unavail.push(`${dl} вечер`); if (mA) avail.push(`${dl} утро`); }
            else if (mA && eA) { avail.push(`${dl} весь день`); }
            else if (mA) { avail.push(`${dl} утро`); }
            else if (eA) { avail.push(`${dl} вечер`); }
          }
          let avText = `<b>Доступность: ${resolvedAvail.employeeName}</b>\n`;
          if (avail.length > 0) avText += `\n✅ Доступна: ${avail.join(", ")}`;
          if (unavail.length > 0) avText += `\n✖ Не могу: ${unavail.join(", ")}`;
          if (avail.length === 0 && unavail.length === 0) avText += "\nДанных пока нет.";
          avText += `\n\n<i>Шаблон для ввода:</i>\nмогу пн утро, вт весь день\nне могу чт, пт`;
          await ctx.reply(avText, replyOptions(ctx, { parse_mode: "HTML" }));
        } catch (err) {
          logger.error({ err }, "telegram доступность error");
          await ctx.reply("Ошибка загрузки доступности", replyOptions(ctx));
        }
        return;
      }
      if (text === "зарплата") {
        if (timesheetFn) {
          const chatId = String(ctx.chat.id);
          const devOvrPay = IS_DEV ? devRoleOverrides.get(String(ctx.from.id)) : null;
          const resolvedPay = devOvrPay || await resolveEmployee(ctx.from.id, employeeService);
          const userId = resolvedPay?.employeeId || String(ctx.from.id);
          const ts = await timesheetFn(chatId);
          const emp = ts?.employees?.find((e) => e.user_id === userId);
          if (!emp) {
            await ctx.reply("Данных по вашей зарплате пока нет.", replyOptions(ctx));
          } else {
            await ctx.reply(formatPayBreakdown(emp), replyOptions(ctx, { parse_mode: "HTML" }));
          }
        } else {
          await ctx.reply("Команда 'зарплата' пока недоступна", replyOptions(ctx));
        }
        return;
      }

      // --- Filters: skip irrelevant messages ---
      // Forwarded messages
      if (ctx.message.forward_origin || ctx.message.forward_from || ctx.message.forward_date) {
        logger.debug("telegram: skipping forwarded message");
        return;
      }

      // Resolve employee first — unknown users are silently ignored in groups
      const devOverride = IS_DEV ? devRoleOverrides.get(String(ctx.from.id)) : null;
      const resolved = devOverride || await resolveEmployee(ctx.from.id, employeeService);

      if (!resolved) {
        // Unknown user — silently ignore in group chats
        logger.debug({ from: ctx.from.id, text: text.substring(0, 50) }, "telegram: unknown user, ignoring");
        return;
      }

      // Short/irrelevant messages filter
      const SCHEDULE_KEYWORDS = /(?:пн|вт|ср|чт|пт|сб|вс|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье|утро|вечер|могу|не могу|смогу|свободн|убр|убор|уберу|занят|дежур|смена|замен|подмен|все дни|каждый день|avail|cant|swap)/i;
      if (text.length < 3 || (!SCHEDULE_KEYWORDS.test(text) && text.length < 30)) {
        logger.debug({ text: text.substring(0, 50) }, "telegram: no schedule keywords, ignoring");
        return;
      }

      // Normal message processing
      const payload = buildIngestPayload(ctx);
      payload.user_id = resolved.employeeId;
      const result = await ingestFn(payload);

      const facts = result.facts_preview || result.facts || [];
      if (facts.length > 0) {
        const userName = resolved.employeeName || ctx.from.first_name || "Сотрудник";
        // Build compact confirmation for multiple facts
        const reply = formatMultiFactReply(facts, userName);
        await ctx.reply(reply, replyOptions(ctx));
        // Update pinned schedule after new facts
        await updatePinnedSchedule(bot, String(ctx.chat.id), ctx.message?.message_thread_id);
      }
      // No facts parsed — silently ignore (don't spam group with "не распознано")
    } catch (err) {
      logger.error({ err }, "telegram message handler error");
      await ctx.reply("❌ Ошибка обработки, попробуйте позже", replyOptions(ctx));
    }
  });

  /**
   * Update or create the pinned schedule message in a chat.
   * @param {Bot} botInstance
   * @param {string} chatId
   * @param {number} [threadId] - message_thread_id for forum topics
   */
  async function updatePinnedSchedule(botInstance, chatId, threadId) {
    const botMode = getBotMode();
    if (botMode === "manual") {
      logger.info({ chatId, threadId, botMode }, "updatePinnedSchedule suppressed (manual mode)");
      return;
    }
    try {
      const schedule = await scheduleFn(chatId);
      const text = formatPinnedSchedule(schedule);

      // debug mode → redirect to admin DM
      const targetChat = botMode === "debug" && ADMIN_CHAT_ID ? ADMIN_CHAT_ID : chatId;
      const debugPrefix = botMode === "debug" ? "[DEBUG]\n" : "";

      const pinKey = threadId ? `${chatId}:${threadId}` : chatId;
      const existingMsgId = pinnedMessageIds.get(pinKey);
      const sendOpts = { parse_mode: "HTML" };
      // Only set thread_id for actual group (not debug redirect)
      if (threadId && targetChat === chatId) sendOpts.message_thread_id = threadId;

      if (existingMsgId && botMode !== "debug") {
        // Try to edit existing pinned message (only in auto mode)
        try {
          await botInstance.api.editMessageText(chatId, existingMsgId, text, { parse_mode: "HTML" });
          return;
        } catch (editErr) {
          logger.debug({ editErr }, "failed to edit pinned message, sending new one");
        }
      }

      // Send new message
      const msg = await botInstance.api.sendMessage(targetChat, debugPrefix + text, sendOpts);
      if (botMode !== "debug") {
        pinnedMessageIds.set(pinKey, msg.message_id);
        try {
          await botInstance.api.pinChatMessage(targetChat, msg.message_id, { disable_notification: true });
        } catch (pinErr) {
          logger.debug({ pinErr }, "failed to pin message (bot may lack permissions)");
        }
      }
    } catch (err) {
      logger.error({ err }, "updatePinnedSchedule error");
    }
  }

  return bot;
}
