/**
 * Telegram bot using grammY.
 *
 * Reads TELEGRAM_BOT_TOKEN from env.
 * Forwards messages to the internal ingest flow and replies with results.
 */

import { Bot } from "grammy";
import logger from "../logger.js";
import { formatFacts, formatSchedule } from "./formatters.js";
import { UserDirectory } from "../userDirectory.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

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
/help или "помощь" — справка`;

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
/help или "помощь" — эта справка`;

const DOW_RU = { mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" };

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
 * Create and configure the bot instance.
 * @param {Function} ingestFn - async function(payload) => { facts_preview, ... }
 * @param {Function} scheduleFn - async function(chatId) => schedule object
 * @param {Function} [weekStateFn] - async function(chatId) => week state object
 */
export function createBot(ingestFn, scheduleFn, weekStateFn) {
  if (!TOKEN) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — bot disabled");
    return null;
  }

  const bot = new Bot(TOKEN);

  bot.command("start", async (ctx) => {
    await ctx.reply(WELCOME_TEXT, { parse_mode: "HTML" });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(HELP_TEXT, { parse_mode: "HTML" });
  });

  bot.command("schedule", async (ctx) => {
    try {
      const chatId = String(ctx.chat.id);
      const schedule = await scheduleFn(chatId);
      const text = formatSchedule(schedule);
      await ctx.reply(text, { parse_mode: "HTML" });
    } catch (err) {
      logger.error({ err }, "telegram /schedule error");
      await ctx.reply("❌ Ошибка загрузки расписания, попробуйте позже");
    }
  });

  bot.command("status", async (ctx) => {
    try {
      if (!weekStateFn) {
        await ctx.reply("Команда /status пока недоступна");
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

      await ctx.reply(text, { parse_mode: "HTML" });
    } catch (err) {
      logger.error({ err }, "telegram /status error");
      await ctx.reply("❌ Ошибка загрузки статуса, попробуйте позже");
    }
  });

  bot.on("message:text", async (ctx) => {
    try {
      const text = ctx.message.text.trim().toLowerCase();

      // Russian text aliases for commands
      if (text === "расписание" || text === "график") {
        const chatId = String(ctx.chat.id);
        const schedule = await scheduleFn(chatId);
        const reply = formatSchedule(schedule);
        await ctx.reply(reply, { parse_mode: "HTML" });
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
          await ctx.reply(reply, { parse_mode: "HTML" });
        } else {
          await ctx.reply("Команда 'статус' пока недоступна");
        }
        return;
      }
      if (text === "помощь") {
        await ctx.reply(HELP_TEXT, { parse_mode: "HTML" });
        return;
      }

      // Normal message processing
      const payload = buildIngestPayload(ctx);
      const result = await ingestFn(payload);

      const facts = result.facts_preview || result.facts || [];
      if (facts.length > 0) {
        // Try specific reply for known fact types
        const userName = ctx.from.first_name || "Сотрудник";
        const specificReply = formatFactReply(facts[0], userName);
        if (specificReply) {
          await ctx.reply(specificReply);
        } else {
          const summary = formatFacts(facts);
          await ctx.reply(`✅ Принято: ${summary}`);
        }
      } else {
        await ctx.reply("📝 Записано, но не распознано. Попробуйте написать:\n• могу пн 10-13\n• не могу чт вечер\n• свободна ср с 14 до 17");
      }
    } catch (err) {
      logger.error({ err }, "telegram message handler error");
      await ctx.reply("❌ Ошибка обработки, попробуйте позже");
    }
  });

  return bot;
}
