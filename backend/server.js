import express from "express";
import dotenv from "dotenv";

// Простая поддержка окружений dev/prod:
// APP_ENV=dev  -> .env.dev
// APP_ENV=prod -> .env.prod
const envName = process.env.APP_ENV || "dev";
dotenv.config({ path: `.env.${envName}` });

const app = express();
app.use(express.json());

// Healthcheck для Cloudflare Worker / внешних проверок.
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    env: envName,
    time: new Date().toISOString(),
  });
});

// Простой webhook: только логируем Update.
app.post("/telegram/webhook", async (req, res) => {
  const update = req.body;

  // Лог в stdout, чтобы хорошо читалось в dev-логах.
  console.log("=== Telegram Update ===");
  console.log(JSON.stringify(update, null, 2));
  console.log("========================");

  // Здесь позже можно будет вызвать Supabase-запросы, бизнес-логику и т.д.
  // Например:
  // import { supabase } from "./supabaseClient.js";
  // await supabase.from("updates").insert({ raw: update });

  return res.sendStatus(200);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[backend] listening on http://127.0.0.1:${port} (env=${envName})`);
});