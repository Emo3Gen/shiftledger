#!/usr/bin/env bash
# start-test.sh — запуск ShiftLedger для тестирования
# Собирает фронтенд и запускает бэкенд на одном порту (по умолчанию 3000)
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3000}"

echo "=== ShiftLedger Test Server ==="
echo ""

# 1. Kill old processes
echo "[1/3] Останавливаем старые процессы..."
pkill -f "node backend/server" 2>/dev/null || true
pkill -f vite 2>/dev/null || true
sleep 1

# 2. Build frontend
echo "[2/3] Собираем фронтенд..."
cd "$ROOT/apps/simulator"
npx vite build --outDir dist 2>&1 | tail -3

# 3. Start backend (serves both API and frontend static files)
echo "[3/3] Запускаем сервер на порту $PORT..."
cd "$ROOT"
APP_ENV=dev PORT="$PORT" node backend/server.js &
SERVER_PID=$!
sleep 2

# Verify
if kill -0 "$SERVER_PID" 2>/dev/null; then
  echo ""
  echo "=== Готово! ==="
  echo "Панель директора: http://localhost:${PORT}/#/director"
  echo "API документация: http://localhost:${PORT}/api-docs"
  echo ""
  # Check Telegram bot
  if grep -q "TELEGRAM_BOT_TOKEN" "$ROOT/backend/.env.dev" 2>/dev/null; then
    echo "Telegram бот:     запущен (long polling)"
    echo "  Команды: /start, /help, /schedule, /status, /pay, /link"
    echo "  Привязка: /link <telegram_id> <employee_id>"
  else
    echo "Telegram бот:     выключен (нет TELEGRAM_BOT_TOKEN в .env.dev)"
  fi
  echo ""
  echo "Для остановки: kill $SERVER_PID"
  echo "Или: pkill -f 'node backend/server'"
else
  echo "Ошибка запуска сервера!"
  exit 1
fi

wait "$SERVER_PID"
