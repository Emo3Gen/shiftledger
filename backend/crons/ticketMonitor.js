/**
 * SL-032: Ticket monitor cron — classifies new feedback tickets with OpenAI,
 * sends Telegram alerts for critical ones.
 */
import OpenAI from "openai";
import { supabase } from "../supabaseClient.js";
import { ADMIN_CHAT_ID } from "../botMode.js";
import logger from "../logger.js";

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * Classify unprocessed tickets (ai_category IS NULL, status = 'new').
 * @param {Function} [sendTelegram] - (chatId, text, opts) => Promise
 * @returns {Promise<number>} number of tickets processed
 */
export async function classifyNewTickets(sendTelegram) {
  if (!openai) {
    logger.debug("[ticketMonitor] No OPENAI_API_KEY, skipping");
    return 0;
  }

  const { data: tickets, error } = await supabase
    .from("feedback")
    .select("*")
    .is("ai_category", null)
    .eq("status", "new")
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) {
    logger.error({ err: error }, "[ticketMonitor] Failed to fetch tickets");
    return 0;
  }
  if (!tickets?.length) return 0;

  let processed = 0;

  for (const ticket of tickets) {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 200,
        messages: [
          {
            role: "system",
            content: `You are a ticket classifier for a shift management app (ShiftLedger).
Classify the ticket into one of: critical, normal, low.
Also provide a 1-sentence summary in Russian.
Respond as JSON: {"category":"critical|normal|low","summary":"..."}`,
          },
          {
            role: "user",
            content: `Type: ${ticket.type}\nText: ${ticket.text}\nPage: ${ticket.page_url || "unknown"}`,
          },
        ],
      });

      const raw = completion.choices[0]?.message?.content || "";
      let category = "normal";
      let summary = "";

      try {
        const parsed = JSON.parse(raw);
        category = ["critical", "normal", "low"].includes(parsed.category)
          ? parsed.category
          : "normal";
        summary = parsed.summary || "";
      } catch {
        category = "normal";
        summary = ticket.text.slice(0, 100);
      }

      await supabase
        .from("feedback")
        .update({
          ai_category: category,
          ai_summary: summary,
          updated_at: new Date().toISOString(),
        })
        .eq("id", ticket.id);

      // Telegram alert for critical tickets
      if (category === "critical" && sendTelegram && ADMIN_CHAT_ID) {
        const alertText = [
          `<b>\uD83D\uDEA8 \u041A\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0442\u0438\u043A\u0435\u0442</b>`,
          ``,
          `<b>\u0422\u0438\u043F:</b> ${ticket.type}`,
          `<b>\u041E\u0442:</b> ${ticket.created_by || "unknown"}`,
          `<b>\u0422\u0435\u043A\u0441\u0442:</b> ${ticket.text.slice(0, 300)}`,
          summary ? `<b>AI:</b> ${summary}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        await sendTelegram(ADMIN_CHAT_ID, alertText, { parse_mode: "HTML" }).catch((e) =>
          logger.warn({ err: e }, "[ticketMonitor] Failed to send TG alert"),
        );
      }

      processed++;
    } catch (err) {
      logger.error({ err, ticketId: ticket.id }, "[ticketMonitor] Failed to classify ticket");
    }
  }

  logger.info({ processed }, "[ticketMonitor] Classification run complete");
  return processed;
}
