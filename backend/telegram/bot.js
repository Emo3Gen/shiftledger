/**
 * Telegram bot using grammY.
 *
 * Reads TELEGRAM_BOT_TOKEN from env.
 * Forwards messages to the internal ingest flow and replies with results.
 */

import { Bot } from "grammy";
import logger from "../logger.js";
import { formatFacts, formatSchedule } from "./formatters.js";

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

Команды:
/schedule — расписание на неделю
/help — справка`;

const HELP_TEXT = `<b>Как пользоваться ShiftLedger</b>

<b>Доступность:</b>
• могу пн 10-13
• могу вт утро
• могу ср вечер
• свободна чт с 14 до 17
• ок пт 10-13

<b>Недоступность:</b>
• не могу пн 10-13
• не смогу вт вечер
• занята ср утро
• нет чт 10-13

<b>Команды:</b>
/schedule — расписание на неделю
/help — эта справка`;

/**
 * Create and configure the bot instance.
 * @param {Function} ingestFn - async function(payload) => { facts_preview, ... }
 * @param {Function} scheduleFn - async function(chatId) => schedule object
 */
export function createBot(ingestFn, scheduleFn) {
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

  bot.on("message:text", async (ctx) => {
    try {
      const payload = buildIngestPayload(ctx);
      const result = await ingestFn(payload);

      const facts = result.facts_preview || result.facts || [];
      if (facts.length > 0) {
        const summary = formatFacts(facts);
        await ctx.reply(`✅ Принято: ${summary}`);
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
