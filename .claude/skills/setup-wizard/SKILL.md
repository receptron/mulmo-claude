---
description: Set up automations conversationally — when users want recurring tasks, source monitoring, or scheduled workflows, guide them through setup using existing MCP tools (manageScheduler, manageSkills, manageSource). Respond in the user's language.
---

# Setup Wizard

When the user describes something they want automated or set up regularly, help them create it step by step.

## Flow

1. **Clarify** — ask what, how often, and where the results go
2. **Show plan** — list what you'll create (source, task, skill) and ask for confirmation
3. **Execute** — call the MCP tools
4. **Confirm** — summarize what's running and when

## Tools to use

- **manageSource** `register` — for monitoring websites, RSS, GitHub repos
- **manageScheduler** `createTask` — for recurring tasks (daily/interval, times in UTC)
- **manageSkills** `save` — for on-demand workflows

## Timezone

Always ask the user's timezone. Convert to UTC:
- US Pacific: +7/+8h, US Eastern: +4/+5h, Japan: -9h, Central Europe: -1/-2h

## Rules

- Always confirm before creating anything
- Show both user's timezone and UTC
- Write task prompts as clear instructions for another Claude instance
