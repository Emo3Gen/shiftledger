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

const HELP_TEXT = `Команды ShiftLedger:

<b>Доступность:</b>
AVAIL mon 10-13 — могу работать
CANT tue — не могу весь день

<b>Обмен:</b>
SWAP u1 u2 mon 10-13 — обмен сменами

<b>На русском:</b>
"могу пн 10-13" — доступность
"не могу вт" — недоступность
"обмен Иса Дарина пн утро" — запрос обмена

<b>Бот-команды:</b>
/start — приветствие
/help — эта справка
/schedule — расписание на неделю`;

const WELCOME_TEXT = `Привет! Я бот ShiftLedger для управления расписанием.

Отправьте мне текстовую команду, например:
• <code>AVAIL mon 10-13</code>
• <code>могу пн 10-13</code>

${HELP_TEXT}`;

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
        await ctx.reply("📝 Записано, но не распознано как команда. Попробуйте: AVAIL mon 10-13");
      }
    } catch (err) {
      logger.error({ err }, "telegram message handler error");
      await ctx.reply("❌ Ошибка обработки, попробуйте позже");
    }
  });

  return bot;
}
