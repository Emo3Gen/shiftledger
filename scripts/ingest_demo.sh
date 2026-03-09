#!/usr/bin/env bash
set -euo pipefail

echo "=== Direct backend (port 3000) ==="
curl -i http://127.0.0.1:3000/ingest \
  -H "content-type: application/json" \
  -H "x-trace-id: demo-backend-1" \
  --data '{
    "source":"emu",
    "chat_id":"debug_chat",
    "user_id":"isa",
    "text":"Пн утро могу, но с 10 до 13",
    "meta":{"role":"staff"}
  }'

echo
echo

echo "=== Through Worker proxy (port 8787) ==="
curl -i http://127.0.0.1:8787/ingest \
  -H "content-type: application/json" \
  -H "x-trace-id: demo-worker-1" \
  --data '{
    "source":"emu",
    "chat_id":"debug_chat",
    "user_id":"isa",
    "text":"Пн утро могу, но с 10 до 13",
    "meta":{"role":"staff"}
  }'

echo

