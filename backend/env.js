import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

// Определяем окружение: dev / prod / другое.
export const envName = process.env.APP_ENV || "dev";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.<envName> if it exists (not required — Railway injects env vars directly).
// dotenv never overwrites vars already in process.env.
dotenv.config({
  path: path.join(__dirname, `.env.${envName}`),
});
dotenv.config({
  path: path.join(__dirname, ".env"),
});

