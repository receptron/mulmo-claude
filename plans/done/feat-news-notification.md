# News Notification — Concierge-Style Proactive Support (#466)

## Goal

Without the user explicitly saying "notify me", Claude detects interests from natural conversation, proposes relevant news sources, and automatically notifies when interesting articles are found.

## User Experience

```text
User: "I can't keep up with WebAssembly developments lately"

Claude: "Want me to track WebAssembly news automatically?
  I can register these sources:
  - WebAssembly Blog (official)
  - Bytecode Alliance Blog
  - Hacker News wasm tag
  I'll check daily and notify you when something interesting comes up."

User: "Sure, go ahead"

Claude: registers 3 sources + adds keywords to interests.json
  → everything automatic from here

--- (next day) ---

📰 Notification: "WebAssembly 3.0 proposal published (wasm-blog)"
  → bell icon + Telegram/Slack delivery
```

## Design

### 1. System Prompt (no code change needed)

Add to the existing system prompt:

```text
## News Concierge

When you detect the user's interest in a specific topic during conversation:
1. Propose relevant news sources (RSS, arXiv, GitHub releases)
2. On agreement, register sources via the manageSource tool
3. Add keywords/categories to config/interests.json (via Edit tool)
4. Confirm: "I'll notify you when interesting articles come up"

Read interest signals naturally — don't wait for "notify me".
Propose once per topic. Don't push if declined.
```

Claude uses existing file tools (read/write/edit) to manage `interests.json` directly — no dedicated API needed.

### 2. Interest Profile

`<workspace>/config/interests.json`:

```json
{
  "keywords": ["WebAssembly", "transformer", "Rust"],
  "categories": ["ai", "ml-research", "security"],
  "minRelevance": 0.5,
  "maxNotificationsPerRun": 5
}
```

- `keywords`: case-insensitive match against item title + summary
- `categories`: CategorySlug values — items from matching sources score higher
- `minRelevance`: notification threshold (0–1), default 0.5
- `maxNotificationsPerRun`: cap per pipeline run, default 5

No file = no notifications (backward compatible).

### 3. Relevance Scoring (no LLM cost)

```text
score = 0

keyword in title:     +0.4
keyword in summary:   +0.2
category match:       +0.3
severity critical:    +0.3
severity warn:        +0.1

→ clamp(0, 1)
```

Pure string matching. Sub-millisecond, zero API cost.

### 4. Pipeline Integration

Insert notify phase between dedup and summarize in `pipeline/index.ts`:

```text
1. Load → 2. Plan → 3. Fetch → 4. Dedup
→ 5. Notify (NEW)
→ 6. Summarize → 7. Write → 8. Archive → 9. Persist
```

Notify phase:
1. Load `config/interests.json` (skip if absent)
2. Score each dedup'd item
3. Filter by threshold, sort by score, take top N
4. Call `publishNotification()` (bell + bridge push)

### 5. Notification Format

**Single item**: article title as notification title

```text
📰 WebAssembly 3.0 proposal published
From wasm-blog — New milestone for the component model
```

**Multiple items**: batch notification

```text
📰 3 interesting articles found
• WebAssembly 3.0 proposal (wasm-blog)
• New Rust async runtime (hacker-news)
• GPT-5 security audit (arxiv)
```

## Files to Create/Modify

| File | Change |
|------|--------|
| `server/workspace/sources/interests.ts` | **NEW** — load interests + scoring function |
| `server/workspace/sources/pipeline/notify.ts` | **NEW** — filter by score → publishNotification |
| `server/workspace/sources/pipeline/index.ts` | Add notify phase |
| `server/agent/prompt.ts` | Add News Concierge instructions to system prompt |
| `src/types/notification.ts` | Add `news` to NOTIFICATION_KINDS |
| `test/sources/test_interests.ts` | Scoring unit tests |

## Testing

- Scoring: keyword match, category match, severity boost, clamp to [0,1]
- Interests file: load/validate (invalid JSON, empty, missing file)
- Pipeline integration: stub fetcher → verify notification fires with correct items

## Out of Scope (future)

- LLM-based relevance scoring
- Notification dedup across runs (don't re-notify same article next day)
- Settings UI for interests editing
- Auto-learning interests from conversation history
