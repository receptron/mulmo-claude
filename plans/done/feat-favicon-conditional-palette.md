# feat: favicon conditional palette

## Problem

The favicon has four colors (`idle` gray, `running` blue, `done` green, `error` red) plus a red unread dot. Every tab looks the same whenever the session is idle — which is most of the time. Users asked for a more varied, context-aware tab icon: different colors for different conditions, both informational (load, unread count) and flavour (time of day, weekend).

## Goal

Replace the 4-value `STATE_COLORS` record with a **priority-ordered rule chain** that picks one colour from ~10 options based on the full runtime context (agent state, unread count, time of day, weekday, server CPU load, and a couple of date-based easter eggs). Keep the existing frame / mascot / unread-dot rendering — only the backing colour changes.

Non-goals: animations, gradients, per-project palette customisation (those can layer on later).

## Conditions and colours

Listed highest priority first; the first rule that matches wins.

| # | Condition | Color | Rationale |
|---|---|---|---|
| 1 | **error** — agent run ended with `ERROR` | `#DC2626` red-600 | Strongest alert, always wins. |
| 2 | **overloaded** — server `load1 / cores > 0.9` | `#EA580C` orange-600 | Machine is burning; the chat likely feels laggy. Surface the cause. |
| 3 | **many-unread** — `sessionsUnreadCount >= 5` | `#D946EF` fuchsia-500 | Attention threshold — 5+ unread tabs means a real pile-up. |
| 4 | **running-long** — `running` AND for `>= 60 s` | `#06B6D4` cyan-500 | Still thinking — distinct from the fresh-start blue. |
| 5 | **running** (default) | `#3B82F6` blue-500 | Unchanged from today. |
| 6 | **has-unread** (active or current session) | `#22C55E` green-500 | Unchanged from today. |
| 7 | **birthday** — memory has `User: birthday: MM-DD` matching today | `#EAB308` yellow-500 | Easter egg. Optional — skip if no memory key. |
| 8 | **new-year** — Jan 1–3 | `#B91C1C` red-700 | Festive. |
| 9 | **christmas** — Dec 24–25 | `#15803D` green-700 | Festive. |
| 10 | **late-night** — local hour `∈ [22, 5)` | `#6366F1` indigo-500 | Deep work / wind-down. |
| 11 | **morning** — local hour `∈ [5, 9)` | `#F59E0B` amber-500 | Sunrise. |
| 12 | **weekend** — Sat/Sun, 9:00–22:00 local | `#14B8A6` teal-500 | Casual. |
| 13 | **idle** (fallback) | `#6B7280` gray-500 | Unchanged fallback. |

### Priority reasoning

- Rules 1–6 are **state** driven: they always beat flavour so a running agent still looks blue even on Christmas evening.
- Rules 7–12 only fire on **idle**. If you're watching the tab, a green "done" or red "error" is what you care about.
- Among idle rules: calendar (birthday / holiday) beats clock (late-night, morning, weekend). Two clocks never match at once (disjoint hour ranges), so no further tiebreak needed.

## Architecture

Split out of `src/composables/useDynamicFavicon.ts` into pure, testable pieces:

```
src/composables/favicon/
  resolveColor.ts      # pure: (context) => hex string
  conditions.ts        # pure predicates: isLateNight, isWeekend, isBirthday, ...
  types.ts             # FaviconContext, FaviconColorReason (for telemetry)
test/composables/favicon/
  test_resolveColor.ts
  test_conditions.ts
```

`resolveColor(ctx: FaviconContext): { color: string; reason: FaviconColorReason }` is a total function with no clock / DOM dependencies (all time inputs are passed in). `useFaviconState` assembles the context at call time:

```ts
resolveColor({
  state,                    // "idle" | "running" | "done" | "error"
  sessionsUnreadCount,      // number
  runningSinceMs,           // number | null — epoch ms when current run started
  now,                      // Date (so tests can pin it)
  userBirthdayMMDD,         // "MM-DD" | null — from memory.md parse (optional)
  cpuLoadRatio,             // number | null — load1 / cores from /api/health
});
```

Returning a `reason` (e.g. `"overloaded"`, `"late-night"`) lets us log it once per change for debuggability without inventing colour names in the UI layer.

## Server-side: add CPU load to `/api/health`

`os.loadavg()[0]` gives the kernel's 1-minute load average on Linux / macOS. Normalise by `os.cpus().length` so `load1/cores > 1.0` means "one full core saturated per host core". On Windows `os.loadavg()` returns `[0, 0, 0]`, so the overloaded rule is silently unreachable there — acceptable (Windows users just never see the orange).

Change:

```ts
// server/index.ts GET /api/health response shape
{
  status: "OK",
  geminiAvailable,
  sandboxEnabled,
  cpu: { load1: os.loadavg()[0], cores: os.cpus().length },
}
```

Client polls every 15 s from `useHealth` (currently a one-shot fetch). The ratio is stored as a `ref<number | null>` and fed into `FaviconContext`. Missing / null → rule 2 is skipped.

## Memory birthday (optional, low-risk)

Looking into `conversations/memory.md` for `birthday: MM-DD` under `## User` is a niche feature but cheap. Parse once on mount (via a tiny `/api/config/user-birthday` endpoint that greps the memory file server-side) and cache in `useFaviconState`. If the memory file doesn't exist or the key isn't there, the context value stays `null` and rule 7 is skipped.

**If this feels like over-reach, drop rules 7–9 entirely** and keep the clock-based + overload + state rules. The code path is the same either way — the resolver just loses a branch.

## Testing

Every condition gets a `test_conditions.ts` case with a pinned `Date`. `resolveColor` gets a matrix test: one assertion per rule firing in isolation + one "state-beats-flavour" fixture to pin priority. Drift-testing: a fuzz-lite loop that generates 100 random contexts and asserts `reason` is one of the 13 enum values (catches any rule that falls through to `idle` when it shouldn't).

## Migration

- [ ] Step 1: add `cpu` field to `/api/health` + extend `useHealth` to poll every 15 s and expose `cpuLoadRatio`.
- [ ] Step 2: create `src/composables/favicon/{types,conditions,resolveColor}.ts` with the full rule chain.
- [ ] Step 3: add `test/composables/favicon/{test_conditions,test_resolveColor}.ts`.
- [ ] Step 4: rewire `useDynamicFavicon` to call `resolveColor` instead of its internal `STATE_COLORS[state]` lookup.
- [ ] Step 5: rewire `useFaviconState` to thread `runningSinceMs` + `cpuLoadRatio` into the context.
- [ ] Step 6: (optional) memory-birthday plumbing — skip if not wanted.
- [ ] Step 7: smoke-test each rule in a local dev server by temporarily pinning the `now` / `cpuLoadRatio` from devtools.

## Out of scope

- Animation / pulsing — the running-long cyan already differentiates extended runs without motion.
- Gradient backgrounds — 32 px is too small for them to read.
- Per-project palette overrides — can come later with a `config/favicon.json` if demand appears.
- Alternative CPU sources (Claude CLI subprocess, client-side `requestAnimationFrame` jank probe) — `os.loadavg()` is the cheapest cross-cutting signal and all we need today.
