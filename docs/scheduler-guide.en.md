# Scheduler Guide — Recurring Tasks & Calendar

## What is the Scheduler?

MulmoClaude's scheduler lets you **have AI do work automatically on a recurring basis**.

For example:
- Summarize news every morning at 9 AM
- Check project progress every hour
- Prepare a team report every Monday

Set it up once, and the AI runs automatically even when you're away from your PC. When you wake your laptop from sleep, it catches up on any missed work automatically.

Plus, the **calendar** feature lets you visually manage events and appointments.

---

## Two Features

### 1. Calendar (Managing Events)

View and manage events in month, week, or list view.

**What you can do:**
- Add events (title, date, time, location, notes)
- Edit and delete events
- Switch between month / week / list views
- Manage "unscheduled" items without dates

**How to access:**
Pick **Calendar** from the plugin launcher at the top of the window. Automated tasks live in the adjacent **Actions** tab — the former single "Schedule" menu was split into Calendar / Actions in 2026-04.

**Adding events:**
Just ask Claude: "Add a meeting tomorrow at 2 PM." You can also add directly from the UI.

### 2. Tasks (Automated Work)

At the scheduled time, AI automatically processes your instructions.

**What you can do:**
- Create recurring tasks ("Do X every day at 9 AM")
- Pause / resume tasks
- Run immediately (without waiting for schedule)
- View execution history (when it ran, success or failure)
- Delete tasks

---

## Types of Tasks

### System Tasks (Automatic, No Setup Needed)

Two built-in tasks that run without any configuration:

| Task | What it does | Frequency |
|---|---|---|
| **Journal** | Summarizes recent chats into daily notes | Every hour |
| **Chat Index** | Adds titles and summaries to chat history | Every hour |

These appear in the **Actions** tab but can't be modified (marked with a "System" badge).

### User Tasks (Created by You)

Ask Claude to create them.

**Example:**

> "Summarize the latest news articles every morning at 9 AM"

Claude creates the task automatically. From then on, it runs every day at 9 AM.

### Skill Tasks (Advanced)

Add `schedule:` to a skill file (SKILL.md) and it runs automatically:

```yaml
---
description: Summarize unread Slack messages
schedule: daily 08:00
---

Check unread Slack channels and list the important messages.
```

---

## Creating Tasks

### Method 1: Ask Claude (Recommended)

Just tell Claude in natural language:

- "Check my todo list every morning at 9"
- "Summarize emails every 30 minutes"
- "Prepare a weekly report every Friday at 5 PM"

Claude understands and creates the task with the right schedule.

### Method 2: Actions Tab

1. Pick **Actions** (formerly the Tasks tab under Schedule) from the plugin launcher
2. View all tasks — each row shows the schedule, last run, and next run
3. Create / edit is still driven by Claude ("schedule X every Y"); the UI is for inspection and manual triggers

---

## Schedule Syntax

### Daily at a fixed time

```
daily 09:00     → Every day at 9:00 (UTC)
daily 18:30     → Every day at 18:30 (UTC)
```

> **Note:** Times are in UTC. For US Eastern (UTC-5), 9 AM local = `daily 14:00`. For Japan (UTC+9), 9 AM local = `daily 00:00`.

### At regular intervals

```
interval 30m    → Every 30 minutes
interval 2h     → Every 2 hours
interval 60s    → Every 60 seconds (minimum 10s)
```

---

## What Happens When Your PC is Off? (Catch-up)

You close your laptop and go out. When you come back — what about tasks that were scheduled while you were away?

MulmoClaude's **catch-up** feature automatically detects and handles missed work:

| Policy | Behavior | Used for |
|---|---|---|
| **Skip** | Ignore missed runs, resume from next | System tasks (journal, etc.) |
| **Run once** | Run just the latest missed one | User tasks (default) |
| **Run all** | Run every missed one in order | Special cases |

For example, if you set "summarize news daily at 9 AM" and your PC was off for 3 days:
- **Run once (default)**: Runs once when you open the laptop
- No need to repeat all 3 days

---

## Managing Tasks

### Pause and Resume

Toggle a task **enabled/disabled** without deleting it. Disabled tasks won't run at their scheduled time.

### Run Now

Can't wait? Click the **play button (▶)** to run immediately.

### Execution History

Check each task's results:
- When it ran
- Success or error
- How long it took
- Error details if it failed

---

## Using the Calendar

### View Options

- **Month view**: Calendar grid showing events by date
- **Week view**: 7-day view with events listed
- **List view**: All events in chronological order

Use **◀ Today ▶** buttons to navigate.

### Adding Events

Easiest way — ask Claude:
- "Add a team meeting on June 20th at 2 PM, location: Zoom"
- "Put a dentist appointment next Thursday"

Events can have any custom properties (location, attendees, notes, etc.).

### Editing and Deleting

- Click an event to open the editor
- In list view, hover to show the delete button (×)

---

## Where Data is Stored

Scheduler data lives in your MulmoClaude workspace:

| File | Contents |
|---|---|
| `config/scheduler/items.json` | Calendar events |
| `config/scheduler/tasks.json` | User-created tasks |
| `config/scheduler/state.json` | Task execution state (last run time, etc.) |
| `data/scheduler/logs/` | Execution logs (daily JSON files) |

---

## FAQ

### Q: My task isn't running

- Is your PC awake? MulmoClaude server must be running
- Check the **Actions** tab — is the task "enabled"?
- Look at execution history for errors

### Q: How do I set my local timezone?

All times are UTC. Convert to your timezone:

| US Eastern (UTC-5) | UTC | Japan (UTC+9) |
|---|---|---|
| 6:00 AM | 11:00 | 8:00 PM |
| 9:00 AM | 14:00 | 11:00 PM |
| 12:00 PM | 17:00 | 2:00 AM (+1) |
| 6:00 PM | 23:00 | 8:00 AM (+1) |

### Q: How do I stop all tasks?

Stop the MulmoClaude server and all tasks stop. To stop individual tasks, disable them in the **Actions** tab.

### Q: Do calendar events trigger actions?

No. Calendar events are for display only. For automated actions, create a **task** instead.

---

## For Developers

The scheduler core is available as [`@receptron/task-scheduler`](https://www.npmjs.com/package/@receptron/task-scheduler) — an independent npm package that works with any Node.js application.

- npm: https://www.npmjs.com/package/@receptron/task-scheduler
- Source: https://github.com/receptron/mulmoclaude/tree/main/packages/scheduler
- API docs: [packages/scheduler/README.md](https://github.com/receptron/mulmoclaude/blob/main/packages/scheduler/README.md)
