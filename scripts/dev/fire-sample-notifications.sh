#!/usr/bin/env bash
# Fire one representative notification for every permalink target
# variant via POST /api/notifications/test. Useful for eyeballing
# the bell panel and clicking through to confirm each deep-link
# lands on the right URL (#762).
#
# Prereqs:
#   - `yarn dev` (or an equivalent MulmoClaude dev server) running
#     on localhost:3001 with a real workspace
#   - The workspace's auth token set in MULMOCLAUDE_AUTH_TOKEN,
#     or available at ~/mulmoclaude/.session-token
#
# Usage:
#   ./scripts/dev/fire-sample-notifications.sh
#   ./scripts/dev/fire-sample-notifications.sh --host http://127.0.0.1:3002
#
# Every notification fires with delaySeconds=0 so they land in the
# bell immediately. Adjust DELAY_BETWEEN_SEC if you want them spaced
# out for a slower manual walk-through.

set -euo pipefail

HOST="http://localhost:3001"
DELAY_BETWEEN_SEC="0.2"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="$2"
      shift 2
      ;;
    --delay)
      DELAY_BETWEEN_SEC="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,22p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

TOKEN="${MULMOCLAUDE_AUTH_TOKEN:-}"
if [[ -z "$TOKEN" && -f "$HOME/mulmoclaude/.session-token" ]]; then
  TOKEN="$(cat "$HOME/mulmoclaude/.session-token")"
fi
if [[ -z "$TOKEN" ]]; then
  echo "Set MULMOCLAUDE_AUTH_TOKEN or ensure ~/mulmoclaude/.session-token exists." >&2
  exit 1
fi

ENDPOINT="${HOST%/}/api/notifications/test"

fire() {
  local label="$1"
  local body="$2"
  echo "→ ${label}"
  # shellcheck disable=SC2005
  echo "$(curl -sS -X POST "$ENDPOINT" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$body")"
  sleep "$DELAY_BETWEEN_SEC"
}

fire "chat → /chat/:sessionId?result=…" '{
  "message": "Agent reply ready",
  "body": "Your prior chat session finished.",
  "kind": "agent",
  "delaySeconds": 0,
  "action": {
    "type": "navigate",
    "target": { "view": "chat", "sessionId": "demo-session", "resultUuid": "demo-uuid" }
  }
}'

fire "todos → /todos/:itemId" '{
  "message": "Todo overdue",
  "body": "Review the quarterly report by EOD.",
  "kind": "todo",
  "delaySeconds": 0,
  "action": {
    "type": "navigate",
    "target": { "view": "todos", "itemId": "demo-todo" }
  }
}'

fire "automations → /automations/:taskId" '{
  "message": "Scheduled task fired",
  "body": "The finance briefing task just finished its morning run.",
  "kind": "scheduler",
  "delaySeconds": 0,
  "action": {
    "type": "navigate",
    "target": { "view": "automations", "taskId": "finance-daily-briefing" }
  }
}'

fire "sources → /sources/:slug" '{
  "message": "New article from Federal Reserve",
  "body": "FOMC releases updated policy statement.",
  "kind": "push",
  "delaySeconds": 0,
  "action": {
    "type": "navigate",
    "target": { "view": "sources", "slug": "federal-reserve" }
  }
}'

fire "calendar (index)" '{
  "message": "Calendar event reminder",
  "body": "Weekly planning review in 15 minutes.",
  "kind": "scheduler",
  "delaySeconds": 0,
  "action": {
    "type": "navigate",
    "target": { "view": "calendar" }
  }
}'

fire "files → /files/<path>" '{
  "message": "New file ingested",
  "body": "Added data/sources/federal-reserve/2026-04-25.md.",
  "kind": "journal",
  "delaySeconds": 0,
  "action": {
    "type": "navigate",
    "target": { "view": "files", "path": "data/sources/federal-reserve/2026-04-25.md" }
  }
}'

fire "wiki → /wiki/pages/<slug>#<anchor>" '{
  "message": "Daily briefing published",
  "body": "Todays global finance briefing has been written to the wiki.",
  "kind": "push",
  "delaySeconds": 0,
  "action": {
    "type": "navigate",
    "target": { "view": "wiki", "slug": "daily-finance-briefing-2026-04-25", "anchor": "front-page" }
  }
}'

fire "bridge inbound (chat permalink)" '{
  "message": "New message on Slack",
  "body": "@alice: meeting moved to 3pm",
  "kind": "bridge",
  "delaySeconds": 0,
  "action": {
    "type": "navigate",
    "target": { "view": "chat", "sessionId": "slack-thread-demo" }
  }
}'

echo "All sample notifications fired against ${ENDPOINT}."
echo "Open the bell in the Web UI and click each entry to confirm the permalink lands correctly."
