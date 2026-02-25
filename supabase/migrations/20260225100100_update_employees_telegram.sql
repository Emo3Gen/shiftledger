-- Migration 008: Add Telegram and phone columns to employees

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS telegram_user_id TEXT,
  ADD COLUMN IF NOT EXISTS telegram_username TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_telegram_user_id
  ON employees(telegram_user_id) WHERE telegram_user_id IS NOT NULL;
