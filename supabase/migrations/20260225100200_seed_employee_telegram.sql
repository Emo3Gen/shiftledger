-- Migration 009: Ensure employees have telegram columns (nullable by default)
-- No data changes needed — columns were added in migration 008 as nullable.
-- This migration is a placeholder for future real employee Telegram binding.

-- Example: When real Telegram IDs are known, update like:
-- UPDATE employees SET telegram_user_id = '123456789', telegram_username = 'isa_user' WHERE id = 'u1';
