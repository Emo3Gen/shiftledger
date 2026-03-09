#!/usr/bin/env bash
set -euo pipefail

FILE="${1:-}"

if [[ -z "$FILE" ]]; then
  echo "Usage: $0 path/to/file.jsonl" >&2
  exit 1
fi

if [[ ! -f "$FILE" ]]; then
  echo "File not found: $FILE" >&2
  exit 1
fi

URL="http://127.0.0.1:8787/ingest"

while IFS= read -r line || [[ -n "$line" ]]; do
  # Пропускаем пустые строки
  [[ -z "$line" ]] && continue

  TRACE_ID="replay-$(date +%s%N)"
  echo ">>> $TRACE_ID: $line"

  RESPONSE="$(curl -sS -H "content-type: application/json" \
    -H "x-trace-id: $TRACE_ID" \
    --data "$line" \
    "$URL")"

  if command -v jq >/dev/null 2>&1; then
    echo "$RESPONSE" | jq .
  else
    echo "$RESPONSE"
  fi

  echo
done < "$FILE"
