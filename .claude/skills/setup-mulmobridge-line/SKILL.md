---
name: setup-mulmobridge-line
description: Interactively guide LINE bridge setup — ngrok install, LINE Developers Console config, and bridge startup. Respond in the user's language.
allowed-tools: Read, Bash, Glob, Grep
---

# Setup LINE Bridge

Guide the user through LINE bridge setup following the docs at `docs/message_apps/line/`. Use the language-appropriate version (README.md for English, README.ja.md for Japanese) based on the user's language.

## Step 1: Prerequisites

1. Check MulmoClaude is running (`lsof -i :3001 -sTCP:LISTEN`). If not, ask the user to run `yarn dev` in a separate terminal first.
2. Check ngrok is installed (`which ngrok`). If not, guide `brew install ngrok` + authtoken setup.

## Step 2: Follow the setup doc

Read the appropriate doc (`docs/message_apps/line/README.md` or `README.ja.md`) and walk the user through it. Key pitfalls to highlight:

- Webhook URL must end with `/webhook` (without it, LINE POSTs to `/` and gets 404)
- Disable auto-reply messages in LINE Official Account settings (prevents double replies)
- Add `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` to `.env`

## Step 3: Start the bridge

```bash
node packages/line/dist/index.js
```

`npx @mulmobridge/line` does not work inside the monorepo. Use `node` directly.

On failure, refer to the troubleshooting table in the setup doc.
