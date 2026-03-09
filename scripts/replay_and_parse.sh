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

INGEST_URL="http://127.0.0.1:8787/ingest"
EVENTS_URL="http://127.0.0.1:3000/events"
PARSE_URL_BASE="http://127.0.0.1:3000/parse"

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue

  TRACE_ID="replay-$(date +%s%N)"
  echo ">>> ingest trace_id=$TRACE_ID payload=$line"

  curl -sS \
    -H "content-type: application/json" \
    -H "x-trace-id: $TRACE_ID" \
    --data "$line" \
    "$INGEST_URL" >/dev/null

  # Fetch latest event by trace_id
  EVENTS_JSON="$(curl -sS "${EVENTS_URL}?trace_id=${TRACE_ID}&limit=1")"

  if command -v jq >/dev/null 2>&1; then
    EVENT_ID="$(echo "$EVENTS_JSON" | jq -r '.events[0].id // empty')"
  else
    EVENT_ID="$(printf "%s" "$EVENTS_JSON" | sed -n 's/.*"id":[[:space:]]*\([0-9]\+\).*/\1/p' | head -1)"
  fi

  if [[ -z "${EVENT_ID:-}" ]]; then
    echo "!! failed to resolve event_id for trace_id=$TRACE_ID"
    continue
  fi

  echo ">>> parse event_id=$EVENT_ID"
  PARSE_JSON="$(curl -sS -X POST "${PARSE_URL_BASE}/${EVENT_ID}")"

  if command -v jq >/dev/null 2>&1; then
    echo "$PARSE_JSON" | jq .
  else
    echo "$PARSE_JSON"
  fi

  echo
done < "$FILE"

