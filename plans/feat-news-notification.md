# News Pipeline → Notification Integration (#466 Phase 1)

## Goal

When the news sources pipeline fetches new articles, notify the user about interesting findings via the notification center (bell UI + bridge push). Currently the pipeline writes daily briefs silently — users must manually check the files.

## Scope

Phase 1 focuses on the **pipeline → notification** path. Proactive source recommendation during conversation is Phase 2 (separate PR).

## Design

### User interest profile

Store in `<workspace>/config/interests.json`:

```json
{
  "keywords": ["WebAssembly", "transformer", "Rust"],
  "categories": ["ai", "ml-research", "security"],
  "minRelevance": 0.5,
  "maxNotificationsPerRun": 5,
  "notify": true
}
```

- `keywords`: free-text terms matched against item title + summary (case-insensitive)
- `categories`: CategorySlug values — items from sources in these categories always score higher
- `minRelevance`: threshold (0–1) below which items are not notified
- `maxNotificationsPerRun`: cap to prevent notification flood
- `notify`: master toggle

Default when file doesn't exist: no notifications (backward compatible).

### Relevance scoring

Simple keyword + category matching. No LLM call — keeps the pipeline fast and free.

```
score = 0

// Keyword match: +0.4 per keyword found in title, +0.2 in summary
for each keyword in interests.keywords:
  if title contains keyword: score += 0.4
  else if summary contains keyword: score += 0.2

// Category match: +0.3 if source category overlaps with interests
if item.categories ∩ interests.categories is non-empty: score += 0.3

// Severity boost: critical → +0.3, warn → +0.1
if severity == "critical": score += 0.3
else if severity == "warn": score += 0.1

// Clamp to [0, 1]
return min(score, 1.0)
```

This is intentionally simple. Can upgrade to LLM-based scoring in a future phase if needed.

### Pipeline integration

Insert a new phase between dedup (step 5) and summarize (step 6) in `pipeline/index.ts`:

```
... existing phases ...
4. Dedup
5. NEW: Score relevance + notify
6. Summarize
7. Write
...
```

The notification step:
1. Load interests from `config/interests.json`
2. Score each dedup'd item
3. Filter items where `score >= minRelevance`
4. Sort by score descending, take top `maxNotificationsPerRun`
5. For each: call `publishNotification()` with kind=`push`, title=item title, body=source + summary

### Notification format

Single batch notification when multiple interesting items found:

```
📰 5 interesting articles found
• WebAssembly 3.0 proposal published (wasm-blog)
• New Rust async runtime (hacker-news)  
• GPT-5 security audit results (arxiv)
```

If only 1 item: individual notification with the item title as the notification title.

### Files to create/modify

| File | Change |
|------|--------|
| `server/workspace/sources/interests.ts` | **NEW** — load/save/validate interests profile + relevance scoring |
| `server/workspace/sources/pipeline/notify.ts` | **NEW** — score items, filter, call publishNotification |
| `server/workspace/sources/pipeline/index.ts` | Add notify phase between dedup and summarize |
| `server/api/routes/sources.ts` | Add GET/PUT `/api/sources/interests` endpoints |
| `src/config/apiRoutes.ts` | Add `sources.interests` route constant |
| `src/types/notification.ts` | Add `news` to NOTIFICATION_KINDS |

### API endpoints

```
GET  /api/sources/interests → { interests: InterestsProfile }
PUT  /api/sources/interests → { interests: InterestsProfile }
```

Settings UI integration is deferred — `config/interests.json` direct edit or chat-based for now.

### Testing

- Unit test for relevance scoring (keyword match, category match, severity boost, clamping)
- Unit test for interests load/save/validate
- Pipeline integration: stub fetcher returns known items, assert notification was called with expected items

## Non-goals (Phase 2+)

- LLM-based relevance scoring
- Conversation-driven interest extraction (auto-populate keywords from chat)
- Proactive source recommendation ("You mentioned X — want to add this RSS feed?")
- Settings UI tab for interests
- Dedup notifications across runs (don't re-notify same item next day)

## Risks

- **Notification fatigue**: Mitigated by `maxNotificationsPerRun` cap and `minRelevance` threshold
- **Keyword false positives**: "Rust" matching Rust language articles AND Rust the game — accept as MVP, LLM scoring in Phase 2 would fix
- **Pipeline latency**: Scoring is pure computation (no LLM), adds < 1ms
