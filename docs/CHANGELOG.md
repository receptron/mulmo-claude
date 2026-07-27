# Changelog

All notable changes to MulmoClaude are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions use [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Highlights

#### Start MulmoClaude from an icon, without a terminal (#2613, PR #2615)

For anyone who does not open a terminal, `npx mulmoclaude@latest` was the whole barrier to entry. One command creates a clickable app:

```bash
npx mulmoclaude@latest create-shortcut
```

It writes `MulmoClaude.app` to `/Applications` — or `~/Applications` when that is not writable, which is what a non-admin account gets. `--dir <path>` chooses somewhere else, `--yes` skips the confirmation. macOS only for now; the command refuses to run elsewhere.

Double-clicking it opens the browser straight to an **already-running** MulmoClaude rather than starting a second one, checks Node.js, `npx` and Claude Code before anything else, and shows a progress page while the server boots — `npx …@latest` looks at the network on every launch, so a silent thirty-second wait was not an option. When a prerequisite is missing, the page names it and gives the commands to run, in whichever of the 8 UI languages the system is set to. The launcher's log is at `~/Library/Logs/MulmoClaude/launcher.log`.

No Electron. A macOS app bundle is a directory with an `Info.plist` and an executable, so this is one of each — no native module rebuilds, no signing, no notarisation, and no Gatekeeper prompt, since a bundle written locally never carries the quarantine attribute that triggers one. A Mac under managed policy can still be told to refuse unsigned apps outright.

**The part that decides whether any of it works is `PATH`.** A GUI launch inherits `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else — `launchctl getenv PATH` is empty — so nodebrew, nvm, fnm, asdf, Volta and even Apple-Silicon Homebrew are all absent. The stub therefore asks the login shell for its `PATH` before looking for anything, and it has to be an **interactive** login shell: version managers and `~/.local/bin` are set up in `.zshrc`, which `-l` alone never reads. Measured on a nodebrew machine, `-l` resolved a different Node than the user's own and could not find `claude` at all — it would have told someone who has Claude Code installed to go install it.

Re-run `create-shortcut` after upgrading: the bundle carries its own copy of the launcher.

Two known gaps, both tracked: the server keeps running with no way to stop it from the icon (#2616), and `--disable-macos-reminders` is a CLI flag an icon cannot pass (#2617).

---

## [1.7.2] - 2026-07-27

**A `.env` you edit that has no effect, and no way to tell why.**

### Highlights

#### The app says when your shell is overriding `.env` (#2604, PR #2612 — and #2610, PR #2614)

`.env` loses to an exported shell variable. That is dotenv's documented rule and it was working correctly — the problem was that losing was invisible. With a stale `export GEMINI_API_KEY=…` left in `~/.zshrc`, you can correct `.env` as many times as you like, restart every time, and nothing changes, with nothing anywhere pointing at the shell. The report that started this came out of exactly that loop.

A single definition is unambiguous and fine. The failure needs two definitions and no visible precedence.

The launcher already knew which keys had lost — `mergeLaunchEnv` returns them — and turned the fact into one terminal log line that is easy to scroll past. It now hands the key **names** (never values) to the server, which raises a notification in the bell naming them and saying which side won. The entry is de-duplicated by a stable id, so restarting with the conflict unfixed does not stack a second one; fixing one of two keys **replaces** the entry rather than leaving one that still names the key you just fixed; and a boot with nothing shadowed **retracts** the warning entirely.

`yarn dev` reached a `.env` by a second route that got none of this (#2610): the server's own `import "dotenv/config"` read `<cwd>/.env` with the same shell-wins rule and discarded what it skipped — the same dead end with even less to go on, since the launcher's log line is not there either. That import is now a reporting loader, and both routes feed one notification.

Along the way, `error-recovery.md` — the file the agent reads before asking you a clarifying question about a tool failure — gained a section for this state. It needed one: the section already there told the agent to *"add the missing key to `.env` (restart the server)"*, which is precisely the advice that fails silently here. It also corrects two things the obvious guidance gets wrong: an **empty** export (`export GEMINI_API_KEY=`) shadows just as hard, and `echo "$VAR"` cannot detect that case because unset and set-but-empty both print blank.

Ships the same scoped package versions as 1.7.1, except `@mulmoclaude/core@1.7.1` (the `error-recovery.md` addition).

---

## [1.7.1] - 2026-07-27

**Icons that rendered as their own names instead of glyphs.**

### Highlights

#### Action, custom-view and spinner icons draw with the font their names belong to (#2605, #2606, PR #2608)

Both icon fonts resolve a glyph from the element's **text**, via a ligature. A name the font does not carry forms no ligature, so the browser typesets the letters instead — invisible as an icon, but still taking the width. Eleven sites moved from `.material-icons` to `material-symbols-outlined`: six spinners hardcoding `progress_activity` (#2605), and five icons whose name comes from a collection's `schema.json` (#2606), where the docs already told the LLM to write Material Symbols names and the code was the side that disagreed. A static guard pins the regression so it cannot return silently. Nothing is added to the bundle — `material-symbols/outlined.css` was already imported.

**This fix is the whole reason 1.7.1 exists.** It merged while the 1.7.0 release PR was in review, twenty minutes after `mulmoclaude@1.7.0` had already gone to npm, so **1.7.0 on npm does not contain it**. Rather than tag a `v1.7.0` whose tree differs from its own published tarball, the fix ships as 1.7.1 and both versions keep a tag matching exactly what was published.

Ships the same scoped package versions as 1.7.0, except `@mulmoclaude/collection-plugin@1.2.1` (five of the eleven icon sites live there).

---

## [1.7.0] - 2026-07-27

**Google Calendar sync stops being one-way, and a cycle of hardening closes the gaps where external data was trusted without checking.**

### Highlights

#### Push a collection back to Google Calendar (#2598, #2600)

A `googleCalendar` collection could only ever be filled *from* Google. There was no setting for a write-back, which is why a beta user trying to set up "two-way sync" could not find one — and why the conversation with the agent went in circles: the thing being looked for did not exist.

The collection view now has a **Push to Google** button beside Sync. It creates events for records added locally and updates the fields actually edited, leaving attendees, reminders and recurrence untouched. It deliberately **never deletes** — a Google delete removes the event for every attendee and cannot be undone — and it **skips a record edited on both sides** rather than picking a winner.

**Push before you sync.** A pull overwrites a locally edited record as soon as Google reports any change to that event, so syncing first can discard the edit that was waiting to go out. The help doc the agent reads now says this outright, along with a plain statement that there is no automatic write-back and no config key for one.

Under it sits a per-calendar baseline (`data/calendar/.push-state.json`) holding the raw value Google last reported. The pull deliberately drops the zone offset and flattens all-day into `…T00:00`, so a push cannot rebuild a Google time from the stored value alone — and the same baseline is the only way to tell a local edit from an untouched record. Writes are conditional (`If-Match` on the etag; a 412 is reported as a conflict rather than silently overwriting), and conflict detection is field-level, so Google moving an event you retitled locally is not treated as a clash.

Not yet verified against a live calendar — tracked in #2602.

#### Self-service triage when something looks broken (#2571, #2579, #2586)

"Is this a bug?" now starts with an attempt to *solve* it rather than to file it. The agent takes the symptom through one form, checks whether settings or documented behaviour already explain it, then searches existing issues — and only files something new if none of that accounted for the behaviour. Diagnostics are masked server-side before they are shown.

#### Security and robustness sweep

- **Dev server no longer exposes your LAN by default** (#2599). `vite dev` bound every interface unconditionally. It now binds loopback unless `MULMOCLAUDE_DEV_LAN=1`; with LAN on, the session token is injected only for loopback callers and the proxied `/api` + `/artifacts` prefixes are refused for everyone else.
- **The CSRF guard stopped assuming its own premise** (#2601). `requireSameOrigin` allowed every `Origin`-less request, justified by a comment saying the server binds 127.0.0.1 — true, but nothing checked it. `isLoopbackPeer` now gates that branch, handling the `::ffff:127.0.0.1` form a dual-stack listener reports.
- **Log injection closed** (#2591, #2595). Every request-derived value reaching `log.*` in the route layer goes through `singleLineForLog`, so CR/LF in a crafted slug or id cannot forge log lines. Classified per site rather than swept blindly — 9 of 28 `slug` sites in `collections.ts` were request-derived.
- **External data validated instead of cast** (#2592/#2596, #2594/#2603). Eight hand-rolled `JsonObject` casts in the remote-host handlers and the unchecked `as` casts on HTML / markdown tool arguments are replaced with real runtime guards, so a malformed payload is refused at the boundary rather than reaching a handler shaped as something it is not.
- **`asyncHandler` types tightened, and it stops swallowing errors** (#2590, #2593/#2597). Structural bounds replace its `Request` / `Response` casts, and `next(err)` is forwarded when headers are already sent instead of being dropped.
- **Polynomial ReDoS fixed** in the HTML attribute iterator (CodeQL #402, #2587).

#### Sessions list got faster (#2588, #2589, #2584, #2585)

`GET /api/sessions` re-read every session's meta sidecar on every scan — 493 sessions in a 90-day window is not unusual, and each one cost a `stat`, an open + read + parse, and another `stat`. The meta is now cached against the diff cursor the client already sends. Separately, returning to a backgrounded tab fired the catch-up twice (a reconnect and a visibility flip landing together), doing all that work twice over.

### Packages published during this cycle

- **`@mulmoclaude/core@1.7.0`** (#2598/PR #2600, #2592/PR #2596, PR #2587) — released 2026-07-27. **Collection → Google Calendar push** (#2598): Google Calendar sync was pull-only and no setting enabled a write-back, which is why a user asking for "two-way sync" could not find one to configure. `pushCalendarForCollection` adds the other direction — creating events for locally added records and patching only the fields actually edited, so attendees / reminders / recurrence stay untouched. It never deletes (a Google delete removes the event for every attendee and is irreversible) and skips a record edited on both sides rather than picking a winner. The substance is a new per-calendar baseline, `<workspace>/data/calendar/.push-state.json`, holding the RAW value Google last reported per event: `toCollectionDateTime` deliberately drops the zone offset and flattens all-day into `…T00:00`, so a push cannot rebuild a Google time from the stored value alone, and the same baseline is the only way to tell a local edit from an untouched record. Pull → push round-trips byte-identically, pinned by test. Conflict detection is field-level (Google moving an event the user retitled locally is not a conflict, because the patch carries only the title) and the write is conditional — `getCalendarEvent` returns the etag, `updateCalendarEvent` sends it as `If-Match`, and 412 is reported as a conflict rather than silently overwriting a version never read. New surface: `toGoogleEventTime`, `planRecord` / `conflictingFields` / `mayAdoptExisting` / `locallyDeletedIds`, the `.push-state.json` accessors, `getCalendar`, `getCalendarEvent`, `CalendarEventTime` / `CalendarEventSpan` (all-day and explicit `timeZone`), `ifMatch` on `UpdateCalendarEventInput`, and `extraHeaders` on `googleRequest`. **Typed remote-host handlers** (#2592): eight hand-rolled `JsonObject` casts replaced with real guards, so a malformed command payload is refused at the boundary. **ReDoS fix** (CodeQL #402): the polynomial backtracking pattern in the HTML attribute iterator is gone. All 11 declared `@mulmoclaude/core` ranges swept `^1.6.0 → ^1.7.0`.
- **`@mulmoclaude/collection-plugin@1.2.0`** (#2598/PR #2600) — released 2026-07-27. The **Push to Google** button, beside Sync on a `googleCalendar` collection. Deliberately a second button rather than making Sync bidirectional: which direction the data moved must never be ambiguous, and this direction writes to a calendar other people may read. Setup problems (unlinked account, read-only calendar) and per-record skips arrive as fields on an HTTP 200, so the new `pushProblems` helper surfaces both in the banner — reporting only the counts would render a setup failure as "0 created" and send the user to audit their records instead of their settings. Labels and result messages translated across all eight locales.
- **`@mulmoclaude/html-plugin@1.1.0`**, **`@mulmoclaude/markdown-plugin@1.1.0`** (#2594/PR #2603) — released 2026-07-27. Export `isHtmlDispatchArgs` / `isPackHtmlArgs` and `isMarkdownDispatchArgs`. Externally supplied tool arguments were narrowed with unchecked `as` casts, so a malformed payload reached the handler shaped as something it was not; the guards reject it at the boundary.
- **`@mulmoclaude/accounting-plugin@1.1.0`** (PR #2590) — released 2026-07-27. Exports `ErrorBody` and `ApiResponse<T>`, and `asyncHandler` takes structural bounds (`RoutePathBearing` / `ErrorSendableResponse`) instead of casting its `Request` / `Response` generics — a handler whose response type cannot carry an error body is now a compile error.
- **`chart` / `google` / `mulmoscript` plugins deliberately NOT republished** — their only drift since their last tag is the `@mulmoclaude/core` range ratchet, so their published source is unchanged. The swept `^1.7.0` range reaches npm on each package's own next release, which is what the dep-range rule intends.

**Resolved package versions** — every scoped package this launcher pulls in, which is not the same list as the one published above: a package keeps shipping at its existing version when it had nothing new to release. `@mulmoclaude/core@1.7.0`, `@mulmoclaude/collection-plugin@1.2.0`, `@mulmoclaude/html-plugin@1.1.0`, `@mulmoclaude/markdown-plugin@1.1.0`, `@mulmoclaude/accounting-plugin@1.1.0`, `@mulmoclaude/google-plugin@1.2.0`, `@mulmoclaude/chart-plugin@1.0.3`, `@mulmoclaude/mulmoscript-plugin@1.1.2`, `@mulmoclaude/common@1.1.1`, `@mulmoclaude/form-plugin@1.0.2`, `@mulmoclaude/markdown-utils@1.3.1`, `@mulmoclaude/spotify-plugin@1.0.2`, `@mulmoclaude/x-plugin@1.0.1`.

---

## [1.6.0] - 2026-07-26

**Google Calendar and Tasks become a full round trip, and a calendar-backed collection keeps itself current without spending tokens.**

### Highlights

#### Calendar-backed collections sync on their own (#2427, #2566)

A collection that declares `googleCalendar` used to sit empty until the hourly scheduler happened to run, with no way to ask for a sync in the meantime. Now the first sync starts as soon as the collection's schema lands — the same applies when a `googleCalendar` block is added to a collection that already exists — and the collection view gains a **Sync** button for an on-demand pass, the counterpart of the feed Refresh that calendars never had.

The sync calls the Calendar API directly instead of routing events through the agent, so raising the frequency costs nothing. Syncs are queued per calendar: a Sync click landing during a scheduled run no longer walks the whole calendar twice.

#### Edit and delete for calendar events and tasks (#2569, #2572, #2574, #2577)

The `google` tool could create and list, but never change or remove — so "move that meeting" or "delete that task" had no path. It now covers the full round trip: `calendarUpdateEvent`, `calendarDeleteEvent`, `tasksUpdate`, `tasksDelete`, and `tasksUncomplete` for putting a completed task back on the list. **No re-linking needed** — the OAuth scope already granted write access.

Editing is a PATCH, and the builders encode that "leave this alone" and "clear this" are different, so *remove the description* cannot be silently dropped. An update that would change nothing is rejected rather than reported as a successful edit that never happened.

#### The same commands from your phone (#2573, #2575)

The remote-host command channel gained `updateEvent` / `deleteEvent`, so the phone remote can drive the new calendar operations, not just the old create/list ones.

#### The dev backend survives a movie build (#2557)

A `mulmocast` movie build could grow until the OOM killer took the dev backend with it, ending the session. The dev server now supervises and restarts the backend, and `mulmocast` 2.9.2 fixes the memory growth upstream.

#### Every package is findable from npm (#2576, #2578, #2580)

All 51 published packages gained a README section linking MulmoClaude, MulmoTerminal and the [user guide](https://receptron.github.io/mulmoterminal/), plus `homepage` / `repository` / `bugs` / `keywords` — 51 of them previously declared none, so their npm pages had no link back to the source. 15 packages had no README at all.

Ships `@mulmoclaude/core@1.5.0`, `@mulmoclaude/google-plugin@1.2.0`, `@mulmoclaude/collection-plugin@1.1.1`, `@mulmoclaude/accounting-plugin@1.0.3`, `@mulmoclaude/chart-plugin@1.0.3`, `@mulmoclaude/common@1.1.1`, `@mulmoclaude/form-plugin@1.0.2`, `@mulmoclaude/html-plugin@1.0.3`, `@mulmoclaude/markdown-plugin@1.0.3`, `@mulmoclaude/markdown-utils@1.3.1`, `@mulmoclaude/mulmoscript-plugin@1.1.2`, `@mulmoclaude/spotify-plugin@1.0.2`, `@mulmoclaude/x-plugin@1.0.1`.

---

## Package releases - 2026-07-26

**Discoverability release across all 51 published shared packages** (#2578). **49 of them are documentation-only patches** — byte-identical to their previous release apart from their own `package.json` and `README.md`. The remaining two carry code and take a minor; they are listed at the end of this entry.

What every package gained:

- **A `## Related projects` section** in its README linking [MulmoClaude](https://github.com/receptron/mulmoclaude), [MulmoTerminal](https://github.com/receptron/mulmoterminal) and the [MulmoTerminal manual](https://receptron.github.io/mulmoterminal/), each with a one-line description rather than a bare URL. 15 packages (`@mulmoclaude/core` and 14 plugins) had no README at all before this.
- **npm metadata**: `homepage`, `repository` (with the monorepo `directory`), `bugs`, and hand-picked `keywords` — 51 of the 53 packages previously declared none of these, leaving their npm pages with no link back to the source and no search terms to be found by.

Version map: the 49 documentation-only packages each move one patch (`1.0.0 → 1.0.1`, `1.3.0 → 1.3.1`, …). Internal dependency ranges were swept in the same commit, so no consumer is left pointing at a superseded line.

**Two packages carry real code and take a minor instead**, because feature work landed after their last release:

- **`@mulmoclaude/core` 1.4.0 → 1.5.0** — `uncompleteTask` joins the Tasks API (#2577, closes #2574): a completed task can be put back on the list. Completed tasks are hidden from `tasksList` unless `showCompleted: true`, so that is how the caller finds the id.
- **`@mulmoclaude/google-plugin` 1.1.0 → 1.2.0** — the `tasksUncomplete` kind (#2577) exposes it, taking the kind count to 18. `tasksUpdate` deliberately still refuses to change status, so the two operations stay separable.

Not included: `mulmoclaude` (the launcher — its version belongs to the `/publish-mulmoclaude` flow) and `create-mulmoclaude-plugin` (never published).

---

## Package releases - 2026-07-25

Three shared packages published. No launcher release — these reach `npx mulmoclaude` users on the launcher's next publish.

### `@mulmoclaude/core` 1.4.0

- **Google Calendar / Tasks write API completed** (#2572, closes #2569) — `updateCalendarEvent` / `deleteCalendarEvent` / `updateTask` join the existing create/list/sync calls. Editing is a PATCH; the pure `buildEventPatch` / `buildTaskPatch` builders encode that `undefined` (leave alone) and `""` (clear it) are different, so "remove the description" cannot be silently dropped.
- **`canonicalTaskListId`** mirrors the existing `canonicalCalendarId` — a blank or whitespace `taskListId` falls back to `@default` instead of building `/lists//tasks`. Pre-existing bug affecting `tasksList` / `tasksCreate` / `tasksComplete`, not only the new calls.
- **Calendar-backed collections sync on creation and on demand** (#2566, closes #2427) — `syncNewCalendarCollections`, `syncCalendarForCollection`, `unsyncedGroups`, `withKeyedLock` exported for the host.
- **New agent help `assets/helps/google.md`** — every `google` tool kind, the timezone-offset requirement, patch semantics, failure modes. The calendar-collection help claimed *"there is no calendar tool"*; corrected, and the two now cross-link.
- Corrected a security claim in both the help and the tool prompt: the refresh token **does** go to Google's token endpoint to mint access tokens. It never goes to claude.ai or any other service.
- First README for the package, plus `repository` / `homepage` / `bugs` (#2576).

### `@mulmoclaude/google-plugin` 1.1.0

- **Kinds 13 → 17** (#2572, closes #2569): `calendarUpdateEvent`, `calendarDeleteEvent`, `tasksUpdate`, `tasksDelete`. **No re-linking needed** — the OAuth scope was already `calendar.events` (read and write).
- Update kinds reject a call that changes nothing: an empty PATCH answers 200, which would be reported as a successful edit that never happened.
- `tasksUpdate` deliberately does not change status (`tasksComplete` owns it), so un-completing a task remains unsupported (#2574).
- Blank `taskListId` now rejected at the schema layer across all five tasks kinds.
- New guard test pins the kind list against the tool definition's enum in both directions.
- README listed 9 kinds with no update/delete; npm description still described Tasks and Drive as future work (#2576).

### `@mulmoclaude/collection-plugin` 1.1.0

- **Sync button for `googleCalendar` collections** (#2566, closes #2427) — on-demand refresh, closing the feeds-parity gap. New i18n keys in all 8 locales.
- **Record modal made safe from browser page translation** (#2563, closes #2561) — it teleports to `<body>`, outside `#app`, so it did not inherit `translate="no"`; page translation was rewriting Material Icons ligature text into words.
- `uiContext` sync result gained an optional `removed` count (additive).
- First README for the package, plus npm metadata (#2576).

---

## [1.5.0] - 2026-07-25

**The launcher finally delivers the 1.x package line — with a deduplication campaign, a spreadsheet-correctness pass, and four oversized views broken apart behind it.**

### Summary

The first launcher release since 1.4.0 (2026-07-20): **211 merged PRs, 707 commits, six days.** Most of that is internal, so here is the shape of it before the detail.

- **npm delivery is repaired — this is the point of the release.** `mulmoclaude@1.4.0` declared `0.x` ranges for every internal package, and a `0.x` caret cannot float across minors (`^0.28.0` means `>=0.28.0 <0.29.0`). Nothing published in the last six days could reach an installed user: not `@mulmoclaude/core` 1.0.0→1.3.0, not the 14 plugins, not the 32-package `@mulmobridge/*` 1.0.0 suite. All 17 launcher ranges now point at the 1.x line, verified by a clean install of the packed tarball.
- **87 refactor PRs — a deduplication campaign.** Two new browser-safe leaf packages (`@mulmoclaude/common`, `@mulmoclaude/markdown-utils`) plus new `@mulmoclaude/core` subpaths absorbed code that had been hand-copied across the host, plugins, bridges and relay. Behaviour-preserving by intent — the interesting part is the bugs that folding the copies together exposed, several of which were real and are listed below.
- **69 fix PRs, 35 of them in the spreadsheet engine.** A systematic Excel-compatibility pass over lookup bounds, criteria matching, financial functions, date math, and error values.
- **11 features.** The user-visible ones: remote-host auto-recovery, reorderable launcher shortcuts, drag-and-drop into File Explorer folders, and a related-collections pulldown.
- **Four of the largest `.vue` files were split** into components and composables — `CollectionView`, `manageSkills`, `wiki`, and `mulmoscript`.

### Highlights

#### npm delivery — the 1.x line finally reaches installed users

Every shared package moved to the 1.x line during this cycle, but `mulmoclaude@1.4.0` had shipped `0.x` caret ranges, which npm cannot float across a minor. The result was six days of publishes that existed on the registry and reached nobody. This release sweeps all 17 internal ranges (`@mulmoclaude/core@^1.3.0`, the plugins at `^1.0.1`–`^1.1.1`, `@mulmobridge/*` at `^1.0.0`) and was verified end to end: `npm pack` → clean install → the resolved tree contains `@mulmoclaude/core@1.3.0`, not `0.28.x`. Every dependency range in the repo is now a floating range — the last eight exact pins (`firebase`, `vite`, `knip`, `vue-i18n`, `@mulmochat-plugin/quiz`) were converted to carets so upgrades are not silently withheld again.

#### Remote host — disconnects are visible and recover on their own (#2535, #2538)

A transient Firestore `onSnapshot` error used to take the remote host down permanently and silently. It now re-subscribes with bounded exponential backoff (1 s → 16 s over five attempts) and surfaces the state in the UI; fatal codes (`permission-denied`, `unauthenticated`, unrecognised) or exhausted retries still go offline deliberately. `classifyListenerError` and `backoffDelayMs` were extracted as pure, unit-tested helpers, and the replay path is safe against double execution — the `claimCommand` queued→processing transaction still gates each command exactly once.

#### Launcher shortcuts can be reordered (#2519, #2531)

Pinned shortcuts on the launcher are draggable, with the order persisted. The reorder intent is resolved at execution time rather than at drag time, so a reorder issued against a stale list no longer moves the wrong entry.

#### File Explorer — drop straight onto a folder row (#2270, #2275)

Dragging files onto a folder row in the File Explorer saves them directly into that workspace folder, instead of forcing a drop into the current directory and a follow-up move.

#### Browser page translation no longer breaks the UI (#2558, #2561, #2563)

Material Icons draw their glyphs from **ligatures**, so an icon element's text content _is_ the icon name (`<span class="material-icons">send</span>`). Chrome's page translation rewrites those text nodes, the ligature stops matching, and every icon-only control renders its name as a literal word — inflating each button to the width of that word. Combined with the translator's overlay spans on the nav, the result reads as "the CSS never loaded", which is exactly how it kept getting reported. The app chrome now carries `translate="no"` — it already ships in 8 locales, so translating it was never the wanted behaviour — and agent / user content opts back in with `translate="yes"`. Body teleports render outside `#app` and so carry their own attribute, with a guard test to stop the next one silently reintroducing the bug. Setup problems of this shape also gained a home: `docs/troubleshooting.md` (#2562, #2565).

#### Collections — related-collections pulldown, agent-sized schema docs, and clean deletion (#2249, #2251, #2428, #2550)

The view header gains a pulldown to jump between collections that reference each other (#2251). `schemaDocs` is now sectioned so it fits inside the agent's result limit instead of being truncated mid-schema (#2249). Deleting a collection now also clears the state that outlived it: the Google Calendar sync token (keyed by `calendarId`, so a collection recreated on the same calendar used to resume from the deleted one's token and receive only the delta) and the feeds ingest cursor at `data/ingest-state/<slug>.json` (which lives in a shared directory outside every per-collection location, so a recreated collection inherited `lastFetchedAt` and sat waiting for an interval instead of fetching). Both presented identically to the user: recreate a collection, it stays empty.

#### Spreadsheet engine — an Excel-compatibility pass (#2360 and 34 sibling PRs)

The largest single concentration of change in this release. Lookup functions respect index bounds and approximate-match semantics (`VLOOKUP`/`HLOOKUP`, #2506, #2453, #2441); `COUNTIF`/`SUMIF` criteria match case-insensitively and honour wildcards (#2485); aggregates accept multiple arguments and exclude blank cells (#2502, #2383); `IF`/`IFS` evaluate their chosen branch through the engine by parsing rather than `eval` (#2474, #2448, #2362); financial functions were corrected so `IPMT + PPMT` equals `PMT`, and `RATE`/`IRR` report `#NUM!` on non-convergence instead of a wrong number (#2430, #2516); `DATEDIF "MD"` no longer returns negative days (#2429); `TEXT` honours digit grouping and format decimals (#2510); domain and boundary rules are enforced across the math functions (#2432); and formula errors are now a distinct value type rather than strings that could be mistaken for data (#2492, #2450). Cross-sheet date references resolve to raw values (#2332), and ambiguous slash dates are read in the user's locale order (#2333).

#### The deduplication campaign — two new shared packages and what folding them exposed

`@mulmoclaude/common` (#2267) is a dependency-free, browser-safe leaf holding the runtime type guards, `errorMessage`, `escapeHtml`, `toUtcIsoDate`, CSV/allowlist parsing, env scanning, and the SSRF deny-list. `@mulmoclaude/markdown-utils` (#2277, #2278, #2280) holds the markdown and image rendering chain, including the mermaid renderer with a parameterised DOM id prefix — its extraction alone took repo-wide duplication from 2.74% to 1.69%. Folding the copies together surfaced real defects that had been hiding in the divergence: the feeds HTTP client's SSRF table had drifted from the mastodon bridge's and was missing four CIDR ranges plus the hostname blocklist, and consolidating them exposed **two bypasses present in both copies** — WHATWG `URL` serialises `[::ffff:127.0.0.1]` in hex, so a dotted-quad-only regex let IPv4-mapped loopback through, and a string-prefix IPv6 check under-blocked `fe81::`–`febf::` inside `fe80::/10` (both fixed, now mask-based, #2459). `errorMessage` existed in four behaviours across fourteen copies, one of which turned gRPC quota errors into `"[object Object]"`. `makeTasksInteractive` was scanning superlinearly (#2282).

#### Prototype-chain lookups are guarded (#2316, #2318, #2319, #2322, #2323, #2324, #2326, #2354)

Object lookups that read user- or schema-supplied keys — field pointers, `where` clauses, handler dispatch, dangling ref/embed resolution, spawn intervals, mutate params, aggregate key collisions — now check own-property rather than reading through the prototype chain, where a key like `constructor` or `toString` returned a function instead of the miss the caller expected.

#### Four oversized views split into components and composables (#2298, #2299, #2300, #2301, #2528)

`CollectionView`, the `manageSkills` view, the wiki view, and the mulmoscript view were each broken into child components plus composables, in deliberate stages: a "safe layer" first (pure helpers extracted with tests, byte-equivalent behaviour), then the template split. Along the way the wiki save queue became a pure, tested module (#2525), and the mulmoscript view gained beat numbers with Generate hidden on beat-reference beats (#2543).

#### Windows — workspace paths and CI (#2540, #2542)

A `.gitignore` rule stopped hiding anything below the workspace root on Windows: the file-tree walk built host-shaped paths with `node:path` (`dir1\ignored.md`) and fed them to the `ignore` package, which only matches POSIX input. The host↔POSIX crossing now has one home (`toPosixRelPath` / `joinPosixRelPath` in `@mulmoclaude/core/files`), applied at the six sites that actually cross the contract while the ten host-internal containment checks were deliberately left alone. The separator is a parameter so the Windows rule is assertable from a POSIX runner — that invisibility is how the backslash form reached main twice. Both Windows scheduled workflows were also unbroken (#2540).

#### Type-safety ratchet

`req.body` on the routes that read it, `.vue` imports in the ESLint program, the RELAY durable-object binding, and the mattermost/zulip bridge payloads are all typed now, taking lint warnings from 148 to 97 (#2253, #2255, #2257, #2258, #2263). The `no-base-to-string` rule was ratcheted from warning to error once the last findings cleared (#2236), and several `as any` escapes were replaced with real type guards (#2239, #2241, #2242, #2256).

### Fixes

Chat gains a "new messages" affordance in the sidebar list (#2291). Whisper no longer warns about a missing server when voice input is disabled (#2553). `manageSkills` stops clobbering a newer selection after a slow delete (#2523), gives repo-list load failures their own error channel (#2518), and guards star-lock ownership on update/uninstall (#2479). The wiki reserves its `deleted` state for genuine not-found rather than any failed fetch (#2496), rejects the same `[[links]]` that `WIKI_LINK_PATTERN` does (#2515), and handles stale-response tokens honestly (#2484). Canvas gets per-instance ids, an honest Clear, off-canvas save and a failure UI (#2513); `manageRoles` handles IME Enter, re-entrancy and delete confirmation (#2509); the scheduler's TasksTab hardens refetch, remount, delete and i18n (#2478); textResponse fixes i18n speaker labels and StackView wiring (#2505); the chart plugin no longer crashes on sparse instances (#2507). Atomic writes use a unique staging file by default (#2222). `node-pty`'s `posix_spawnp` failure is prevented at runtime as a backstop against `--ignore-scripts` installs (#2266, #2268), and Docker credential refresh no longer misreads a numeric `expiresAt` (#2266). An unreachable backend is no longer flattened into "no data" (#2238). Google-synced calendar datetimes are normalised to the shape collections parse (#2372).

### Packages published during this cycle

- **7 `@mulmoclaude/*` plugins + `@mulmobridge/relay`** — released 2026-07-25. Metadata-only republish, no source change in any of them: it exists so every package's npm tarball matches `main` and the tag-based drift audit (`git diff <name>@<version> main -- <dir>`) comes back clean before the launcher release. `accounting` / `chart` / `collection` / `google` / `html` / `markdown` → `1.0.2` and `mulmoscript` → `1.1.1` carry the `@mulmoclaude/core` sweep `^1.2.1 → ^1.3.0` (`mulmoscript` from a drifted `^1.2.0`). Functionally inert: a caret on a `1.x` package floats, so the published `^1.2.x` ranges already resolved core 1.3.0, and none of these plugins import the new 1.3.0 exports — the bump only makes each declared floor match what the source actually requires. `@mulmobridge/relay@1.0.1` carries the `wrangler` devDependency bump `^4.113.0 → ^4.114.0` (#2556); also inert, since nothing declares relay as a dependency (it is deployed to Cloudflare, not consumed from npm). Launcher ranges swept to match; the launcher itself ships separately via `/publish-mulmoclaude`.
- **`@mulmoclaude/core@1.3.0`** (#2542/PR #2549, #2428+#2550/PR #2551) — released 2026-07-25. **New `@mulmoclaude/core/files` exports `toPosixRelPath` / `joinPosixRelPath`** (#2542): a workspace-relative path is a POSIX contract on every surface that carries one (Files tree, upload response, `file:` pubsub channel, `<collection_paths>`, export manifests, wiki hrefs), but `node:path` returns `sub\dir` on Windows — so a `.gitignore` rule stopped hiding anything below the workspace root, because the tree walk fed host-shaped paths to the `ignore` package, which only matches POSIX input. The conversion now has one home. `toPosixRelPath` splits on `path.sep` rather than replacing every `\` (a backslash is a legal POSIX filename character, so a blanket replace would turn the single directory `we\ird` into two segments), and takes `sep` as a parameter so the Windows rule is assertable from a POSIX runner — that invisibility is how the backslash form reached main twice (#2540). Separator shape only: a traversal or drive-absolute input survives as one, so `resolveWithinRoot` downstream still sees the escape it must refuse. The sweep classified 16 sites; core's crossings (`collection/registry/server/exportCollection.ts`, `collection/server/skillAssets.ts`) route through the helper, while host-internal containment checks are deliberately left alone. **Deleting a collection now clears the sync state that outlives it** (#2428, #2550): both stores are keyed by something other than the collection, so a recreated collection inherited the deleted one's progress and stayed empty. The Google Calendar sync token is keyed by `calendarId` — new `anySyncedCollectionSurvives` / `orphanedCalendarId` / `releaseOrphanedCalendarToken` and the `CalendarDeclaring` type on `@mulmoclaude/core/google` release it once no surviving collection declares that calendar; the feeds ingest cursor (`data/ingest-state/<slug>.json`, a shared dir outside every per-collection location) joins `deleteTargets` and is removed on delete — deliberately **not** archived, since restoring a stale `lastFetchedAt` would reintroduce the bug it fixes. Minor bump for the new exports; all 12 `@mulmoclaude/core` ranges swept `^1.2.1 → ^1.3.0` (launcher + `accounting` / `chart` / `collection` / `google` / `html` / `markdown` / `mulmoscript` plugins — `mulmoscript` had drifted to `^1.2.0`).
- **`@mulmoclaude/debug-plugin@1.0.1`** (#2490, #2521) — released 2026-07-25. Metadata-only republish: the `1.0.0` tarball still declares `gui-chat-protocol` at `^1.1.0`, so an npm install of the dev-only debug plugin peer-resolves to the line before `createSerialLock()` (#2490) even though the source has required `^1.2.0` since then. Also picks up the `lint` script added across the remaining workspace packages (#2521). No source change. Nothing declares this package as a dependency (the launcher installs it at runtime from `preset-list.ts`, `devOnly`), so no consumer ranges move.
- **`@mulmobridge/*` suite → 1.0.0** — released 2026-07-25. The **1.0.0 milestone for the whole bridge suite** (32 packages). `@mulmobridge/protocol@1.0.0` carries the API changes accumulated since `0.1.4`: the `Attachment` gains a `path` carrier with `data`/`mimeType` now optional (path-first uploads), `skill` / `pdf` added to the event-type & generation-kind maps, and the dead `switchRole` event removed. Also `@mulmobridge/client@1.0.0`, `@mulmobridge/webhook-runtime@1.0.1`, `@mulmobridge/web-push@1.0.0`, `@mulmobridge/chat-service@1.0.0`, `@mulmobridge/relay@1.0.0`, `@mulmobridge/mock-server@1.0.0`, and all 25 channel bridges (bluesky, chatwork, cli, discord, email, google-chat, irc, line, line-works, mastodon, matrix, mattermost, messenger, nostr, rocketchat, signal, slack, teams, telegram, twilio-sms, viber, webhook, whatsapp, xmpp, zulip) at `1.0.0`. Promotes `0.x → 1.0.0` per the min-1.0.0 policy; because a `0.x` caret can't float past a minor, every internal `protocol` / `client` range is swept to `^1.0.0` (`webhook-runtime` → `^1.0.1`) and the whole suite republishes together. Launcher + root ranges updated to match.
- **`@receptron/task-scheduler@1.0.0`** — released 2026-07-25. Promote to 1.0.0 (stable). Releases the accumulated internal refactoring/simplification of the persistent scheduler (catch-up, windows, state, logging) since `0.1.0` — net code reduction, no API additions. Launcher + root ranges swept `^0.1.0 → ^1.0.0`.
- **`@mulmoclaude/core@1.2.1`** (#2535, #2298/#2527) — released 2026-07-25. **Remote-host listener resilience** (#2535): a transient Firestore `onSnapshot` error now re-subscribes with bounded exponential backoff (1 s→16 s over 5 attempts) instead of downing the host permanently; fatal codes (`permission-denied` / `unauthenticated` / unrecognized) or exhausted retries still go offline. `classifyListenerError` / `backoffDelayMs` extracted as pure, unit-tested helpers; re-subscribe is safe against double execution (the `claimCommand` queued→processing transaction still gates each command once). Also absorbs the pure collection helpers extracted in the CollectionView refactor (#2298/#2527) and a wiki renderer fix (the renderer now rejects the same `[[links]]` that `WIKI_LINK_PATTERN` does). `@receptron/task-scheduler` range `* → ^1.0.0`.
- **13 `@mulmoclaude/*` plugins** — released 2026-07-25. Republished to ship source changes accumulated since each plugin's last publish (all were `local == npm`, never released). `@mulmoclaude/x-plugin@1.0.0` (promoted from `0.1.2` per the min-1.0.0 policy); `@mulmoclaude/collection-plugin@1.0.1` (the #2528 CollectionView refactor — composables / table / cell / toolbar extraction, `mulmoscript`-style beat handling); and `@1.0.1` for `accounting`, `chart`, `google`, `html`, `markdown` (core-dependent — `@mulmoclaude/core` range → `^1.2.1`), plus `bookmarks`, `edgar`, `email`, `form`, `recipe-book`, `spotify`. Launcher ranges swept to match.
- **`@mulmoclaude/core@1.2.0`** (#2398, #2399, #2401, #2404, #2405, #2406, #2410, #2436, #2459, #2460, #2461, #2462, #2483, #2486, #2489, #2490, plus #2318/#2319/#2322/#2323/#2324) — released 2026-07-24. First publish since `1.0.1`; carries the dedup campaign, several prototype-pollution guards, and new browser-safe subpaths. Security: the feeds HTTP client's SSRF CIDR table (which had drifted from the mastodon bridge's and was missing four ranges plus the hostname blocklist) now imports `@mulmoclaude/common/ssrf`, gaining the union table and the two bypass fixes (hex IPv4-mapped IPv6; mask-based `fe80::/10`) (#2459); prototype-chain lookups in field pointers, `where`, handler dispatch, and dangling ref/embed resolution are guarded (#2318/#2319/#2322/#2323/#2324); `resolveWithinRoot` single-sourced onto the server-only `@mulmoclaude/core/files` subpath (#2461). New/consolidated subpaths: `@mulmoclaude/core/artifacts` (#2405, later absorbing the host `yearMonthUtc` in #2460), `@mulmoclaude/core/plugin-vue` (#2404/#2436, plus `useFileVersion` / barrel-exported `nextFileVersion` in #2489), `@mulmoclaude/core/plugin-vue/i18n` (`createPluginI18n`, #2462), `@mulmoclaude/core/files` (one `writeFileAtomic`, #2399), `@mulmoclaude/core/fetch` (one `fetchWithTimeout`, #2398), and `loadTranslated` on `@mulmoclaude/core/translation/client` (#2460). Internal: host-adapter slot factory (#2401) and logger interfaces aliased to `@mulmoclaude/common`'s `StructuredLogger` (#2486); schema-walk preload unified (#2406); wiki frontmatter reuses `@mulmoclaude/markdown-utils` (#2410); `escapeHtml` from common (#2483); `createSerialLock()` adopted from gui-chat-protocol 1.2.0 (#2490). Requires `@mulmoclaude/common@^1.1.0` and `@mulmoclaude/markdown-utils@^1.3.0`.
- **`@mulmobridge/client@0.2.0`** (#2403, #2487) — released 2026-07-24. Drift-fix publish (npm was on `0.1.5`). `readBridgeEnvOptions` is now a thin wrapper over the shared `scanEnvOptions(env, { prefixes, allowKeys? })` in `@mulmoclaude/common` (#2487) — it had been a parallel implementation of the host's `resolveRelayBridgeOptions`; the only real difference (the relay's `RELAY_TOKEN` / `RELAY_URL` allowlist) is now the `allowKeys` parameter, and a dead defensive branch in `snakeToLowerCamel` was dropped (segments are pre-filtered non-empty). Also carries the #2403 shared bridge plumbing (`frameText`, `fetchJsonRecord` / pure `asJsonRecord`) and the `@mulmoclaude/common` dep for `isRecord`.
- **`@mulmoclaude/markdown-utils@1.3.0`** (#2300, #2382, #2483) — released 2026-07-24. Adds `splitFrontmatter(raw)`, returning the frontmatter `prefix` plus the `body` suffix so a caller rewriting the body can re-attach the original header verbatim (built on `parseFrontmatter`; `prefix + body` reproduces `raw` exactly) — replaces the hand-rolled splitter in the wiki `View.vue` task-checkbox path (#2382, #2300). `mermaidExtension`'s local `escapeHtml` now imports the canonical `@mulmoclaude/common` one (new dep; purity note corrected, #2483). `makeTasksInteractive` no longer scans superlinearly. Launcher / markdown-plugin / core ranges already declared `^1.3.0`; this publish is what lets them resolve on npm.
- **`@mulmoclaude/common`, `@mulmobridge/webhook-runtime`, `@mulmobridge/client`** (#2403) — Phase-3 dedup of the bridge↔bridge and bridge↔relay clones (code only; version bumps + consumer-range sweeps are deferred to the next publish, per the bump-once-at-publish policy). **`@mulmoclaude/common/meta-webhook`** (new subpath) holds `extractMessengerMessages` / `extractWhatsAppMessages` — the pure Meta payload parsers that were byte-identical between the Messenger/WhatsApp bridges and the relay's `webhooks/{messenger,whatsapp}.ts`; common is the only tier both the Node bridges and the Cloudflare Worker relay can import (signature verification stays per-runtime: bridge = node:crypto, relay = Web Crypto). **`@mulmobridge/webhook-runtime`** adds `registerMetaWebhookVerification` / `metaVerificationResult` (pure) / `verifyMetaHmacSignature`, collapsing the identical Meta GET `hub.challenge` handler + `sha256=` HMAC strip shared by the two Meta bridges. **`@mulmobridge/client`** adds `frameText` (ws-frame→utf8, Mastodon/Signal), `fetchJsonRecord` + pure `asJsonRecord` (REST GET/POST skeleton, Rocket.Chat/Zulip), and gains a `@mulmoclaude/common` dep for `isRecord`. New unit tests for every extracted pure function.
- **`@mulmoclaude/markdown-utils@1.3.0`** (PR #2382, #2300) — adds `splitFrontmatter(raw)`, returning the frontmatter `prefix` + the `body` that follows so callers rewriting the body can re-attach the original header verbatim. Built on `parseFrontmatter` (`body` is always a suffix of `raw`, so `prefix + body` reproduces the input exactly). Replaces the hand-rolled splitter in the wiki `View.vue` task-checkbox path — the safe-layer part of the View.vue split (#2300; template split deferred for the xpath-dependent e2e). Minor bump; launcher + markdown-plugin ranges swept to `^1.3.0`. npm publish is a follow-up (`/publish`).
- **`@mulmoclaude/markdown-utils@1.2.0`** (PR #2280) — released 2026-07-21. Moves the **mermaid renderer** (`renderMermaidNodes`, `mermaidExtension`, `adoptSvg`) into the shared package — the last markdown/image host↔plugin duplication. The per-diagram DOM id prefix is now a parameter (`renderMermaidNodes(root, labels?, idPrefix = "mulmo-mermaid")`) so host and plugin keep distinct prefixes (host default, plugin passes `"mulmo-mermaid-plugin"`) without duplicating the renderer; `useMermaid` stays per-side (its `vue-i18n` vs plugin-`useT` wiring is environment-specific). Behavior unchanged — the prefix only feeds mermaid's invisible SVG root id (verified rendering a live wiki page). jscpd (spreadsheet excluded): 2163 → 2036 duplicated lines (1.80% → 1.69%); the markdown-utils dedup took the repo from 2.74% → 1.69% overall. New peer dep `mermaid`; minor bump (no consumer sweep). Completes the markdown-utils dedup (`errors` deliberately left — a `@mulmoclaude/core` concern).
- **`@mulmoclaude/markdown-utils@1.1.0`** (PR #2278) — released 2026-07-21. Adds the image-resolution chain (`resolveImageSrc` + `setFilesRawUrl`, `rewriteMarkdownImageRefs`/`rewriteImgSrcAttrsInHtml` — the 237-line rewriter) that #2277 deferred. Removes the last big markdown/image host↔plugin clone (jscpd, spreadsheet excluded: 2419 → 2163 duplicated lines, 2.01% → 1.80%). The host wires `setFilesRawUrl(API_ROUTES.files.raw)` in `uiHost.ts` so `API_ROUTES` stays the single source of truth (default already matched, behavior unchanged). **Minor bump** — `^1.0.0` consumers pick it up with no range change (the 1.0.0-graduation payoff); only launcher + markdown-plugin ranges bumped `^1.1.0` for hygiene. New dep `marked`. Still deferred: the mermaid trio (`idPrefix` param) and `errors` (a `@mulmoclaude/core/utils` concern).
- **`@mulmoclaude/markdown-utils@1.0.0`** (PR #2277) — released 2026-07-21. New **browser-safe leaf** holding the markdown / image rendering utilities (`parseFrontmatter`/`mergeFrontmatter`, `extractFirstH1`, marp helpers, `renderTaskListItems`, `cacheBustUrl`, `transformResolvableUrlsInHtml`, `externalLinkAttrs`, filename helpers). Eliminates the near-complete COPY of `src/utils/{markdown,image,dom,files}` that `markdown-plugin` was carrying: 10 files moved (canonical = host version), 41 import sites + tests repointed, 21 duplicate copies deleted (net −931 lines). **jscpd: 3456 → 2591 duplicated lines (2.74% → 2.07%, −865 lines)** — the first change to meaningfully move the metric (the earlier bridge consolidations were sub-threshold). Deps `js-yaml`; peer `vue`. Also excludes `src/plugins/spreadsheet/engine/**` from the jscpd scan. Deferred to a follow-up (intentional drift): `image/resolve` (host `API_ROUTES` vs plugin settable URL), `rewriteMarkdownImageRefs`, the mermaid trio (plugin-specific DOM id prefix), `errors`.
- **`@mulmobridge/webhook-runtime@1.0.0`** (PR #2274) — released 2026-07-21. **Graduates to 1.0.0.** Adds Meta (Messenger / WhatsApp) webhook verification — `narrowChallenge(raw)` + `SAFE_CHALLENGE_RE`, the CodeQL `js/reflected-xss` sanitiser that narrows Meta's `hub.challenge` to a known base64url-nonce shape before it is echoed back — consolidated from two byte-identical bridge `verify.ts` copies (messenger, whatsapp). Both bridge copies + the two near-duplicate root regression tests were deleted; the comprehensive suite now lives in webhook-runtime. 6 consumer ranges swept `^0.1.0 → ^1.0.0`. Applies the "packages updated going forward start at 1.0.0+" policy to `@mulmobridge/*` too (leaves `client` 0.1.5 / `protocol` 0.1.4 on 0.x for now).
- **`@mulmoclaude/common@1.1.0`** (#2400, #2459, #2480, #2483, #2486, #2487) — released 2026-07-24. The version was claimed by #2400 but never published, so this release carries every `common` change since `1.0.0`; because all 27+ consumer ranges already declared `^1.1.0` — a range npm could not resolve while only `1.0.0` existed — publishing also repairs that gap with no range sweep. Contents: **`errorMessage(err, fallback?)`** (#2400), the isomorphic "unknown caught value → human-readable string" helper (Error → `.message`; non-Error object → non-empty string `details` (gRPC) or `message`, `details` wins; else `fallback`; else `String(err)`) — #2217 could only consolidate this for server code because `@mulmoclaude/core/utils` is server-only, so it lived as 4 byte-identical copies; `@mulmoclaude/core/utils` now re-exports it and the plugin copies are gone (the `x-plugin` / `mulmoscript` copies followed in #2461, `spotify` / `html` in #2483). **New `./ssrf` subpath** (#2459) holding the one CIDR deny-list plus `isBlockedIp`/`isBlockedIpv4`/`isBlockedIpv6`/`isBlockedHostname`/`parseSafeUrlShape`/`stripIpv6Brackets` — the mastodon bridge and core's feeds `httpClient` each carried a table and had already drifted (core was missing `192.0.0.0/24`, `198.18.0.0/15`, `224.0.0.0/4`, `240.0.0.0/4` and the hostname blocklist); the shared table is the union, and consolidating surfaced two real bypasses present in **both** copies, fixed here: WHATWG `URL` serializes `[::ffff:127.0.0.1]` as hex (`::ffff:7f00:1`) so a dotted-quad-only regex let IPv4-mapped loopback through, and the old string-prefix IPv6 check under-blocked `fe81::`–`febf::` inside `fe80::/10` (now mask-based). **`toUtcIsoDate`** (#2480, host + `x-plugin` copies folded; the `@receptron/task-scheduler` copy stays deliberate for leaf independence). **`escapeHtml`** (#2483). **`scanEnvOptions(env, { prefixes, allowKeys? })` + `snakeToLowerCamel`** (#2487) — the one two-tier env scraper behind `@mulmobridge/client`'s `readBridgeEnvOptions` and the host's `resolveRelayBridgeOptions`, with the relay's secret-exclusion allowlist (`RELAY_TOKEN` / `RELAY_URL`) preserved as the `allowKeys` parameter and pinned by a mutation-checked test. **`StructuredLogger` / `MinimalLogger` types** (#2486) — canonical shapes for the two logger interfaces that had been re-declared in eleven places; consumers alias them, so every public name and structure is unchanged. Still a zero-runtime-dependency browser-safe leaf.
- **`@mulmoclaude/common@1.0.0`** (PR #2272) — released 2026-07-21. **Graduates to 1.0.0** to escape the 0.x caret cascade (`^1.0.0` floats across minors). Adds `parseCsvList(raw, { lowercase? })` and `parseCsvSet(raw, { lowercase? })` — the canonical CSV/env allowlist helpers (empty set = "allow all" sentinel), consolidating ~17 hand-written `new Set(...split...map(trim)...filter)` builders across the bridges (~85 lines removed; telegram excluded for its opposite deny-all semantics). All 15 existing consumer ranges swept `^0.1.0 → ^1.0.0` (mandatory — a `^0.1.0` range rejects 1.0.0, so the workspace would fall back to the stale npm copy).
- **`@mulmoclaude/common@0.1.0`** (PR #2267, #2269) — released 2026-07-21. Initial release of the leaf, dependency-free package holding the general-purpose runtime type guards shared across the MulmoClaude host, bridges, and plugins. Promotes the guards that originated as `server/utils/types.ts` (#504) into their own package so they stop being re-hand-written in every bridge and plugin. Exports `isRecord`, `isObj`, `isNonEmptyString`, `isStringRecord`, `isStringArray`, `isUnknownArray`, `isErrorWithCode`, `hasStringProp`, `hasNumberProp`. Consumed by the host (`server/utils/types.ts`, `src/utils/types.ts`) from #2267; the 12 bridges + relay adopt it in #2269 (local `isObj` → `isRecord` consolidation). Publishing was required before any consumer's next npm publish because bridges build with `tsc` (no bundling) and ship raw runtime deps, so the package had to reach npm first.
- **`@mulmobridge/web-push@0.2.0`** (#2230, PR #2232) — released 2026-07-20. `SendWebPushOptions` gains `data?: Record<string, string>`, forwarded to FCM's `data` block so a receiver can route the tap. A push carrying only a title and body gives the receiver nothing to act on, so tapping the notification lands on the home screen; with `data` a host can open what the push is about — MulmoTerminal's case is `/terminals/{sessionId}` for the session that just finished. `buildSendPushBody(title, body, data?)` nests the map as `data.data` (the outer key is the Cloud Functions onCall envelope, the inner one is the FCM block). Omitted entirely when absent or empty, so an ordinary push serialises to exactly the 0.1.0 envelope — fully backward compatible. `data` is added **alongside** `notification`, never instead of it: both mulmoserver receivers return early when `payload.notification` is missing, so a data-only message would be silently discarded. The map is deliberately untyped beyond FCM's string-value requirement, since each host picks its own routing keys. Unblocks receptron/mulmoserver#75 and receptron/mulmoterminal#440, which were both waiting on this release.

Ships `@mulmoclaude/core@1.3.0`, `@mulmoclaude/collection-plugin@1.0.2`, `@mulmoclaude/accounting-plugin@1.0.2`, `@mulmoclaude/chart-plugin@1.0.2`, `@mulmoclaude/google-plugin@1.0.2`, `@mulmoclaude/html-plugin@1.0.2`, `@mulmoclaude/markdown-plugin@1.0.2`, `@mulmoclaude/mulmoscript-plugin@1.1.1`, `@mulmoclaude/form-plugin@1.0.1`, `@mulmoclaude/spotify-plugin@1.0.1`, `@mulmoclaude/x-plugin@1.0.0`, `@mulmoclaude/common@1.1.0`, `@mulmoclaude/markdown-utils@1.3.0`, `@mulmobridge/protocol@1.0.0`, `@mulmobridge/client@1.0.0`, `@mulmobridge/chat-service@1.0.0`, `@mulmobridge/web-push@1.0.0`, and `@receptron/task-scheduler@1.0.0`.

> **Note for npm users:** `mulmoclaude@1.4.0` shipped dep ranges pinned to `@mulmoclaude/core@^0.28.0` and `0.x` ranges for every other internal package. A caret range on a `0.x` package does not float across minors, so installs of 1.4.0 could not receive anything published since — which, this cycle, was everything: core 1.0.0 through 1.3.0, all 14 plugins, and the entire `@mulmobridge/*` 1.0.0 suite. 1.5.0 is the first launcher that actually delivers it. This is the second consecutive release with this footnote (1.4.0 carried it for 1.3.0); the underlying cause — `0.x` packages — is now gone, since every internal package is on the 1.x line.

---


## [1.4.0] - 2026-07-20

**Collections grow a map, and the npm launcher finally ships what it promises.** The `/collections` page gains an ontology graph, calendar events sync into collections, and — importantly for anyone installing from npm — this launcher is the first to carry the current `@mulmoclaude/*` line.

### Highlights

#### Collections — ontology graph panel (#2218)

The `/collections` page gains a **Map** tab that draws the ontology across your collections: each schema is a node, each `ref` field an edge, so you can see how records point at each other instead of inferring it from schema files. Reverse edges collapse by their declared `via`.

#### Collections — calendar sync, file query, flag fields, delete (#2095, #2182, #2184, #2200, #2204)

Google Calendar events now sync into a collection, incrementally after the first pass (#2182, #2184). `manageCollection` can delete items (#2200). New `flag` field type with its own chip styling (#2211, #2101). File-backed queries (`dataSource`) landed alongside storage virtualization for view images (#2204).

#### The `String()`-coercion family (#2208, #2210, #2211, #2213, #2215, #2223, #2225)

A `@typescript-eslint/no-base-to-string` sweep found seven places where a non-string value was being stringified into `"[object Object]"` on its way to a user, a filename, or a webhook signature check — collection scalar values, workspace dir names, MCP skill args, relay webhook secrets, the accounting router's action args, and two collection paths. Each was fixed at the source rather than papered over at the render site.

#### Relay — fail closed on a misconfigured signing secret (#2213)

A malformed or absent webhook signing secret now rejects the request instead of falling through to the handler. Credentials are read as strings-or-absent via `envSecret`, so a missing platform binding can no longer arrive as the literal `"undefined"` and be treated as configured.

#### Shared helpers consolidated into core (#2217, #2219)

`errorMessage` existed 14 times across 4 behaviours — gRPC-shaped errors surfaced as `"quota exceeded"` through the host copy and `"[object Object]"` through the core ones. `truncate`'s core copy had dropped the guard that keeps output inside `max`. Both now live once in the new browser-safe `@mulmoclaude/core/utils`, with the host re-exporting. `docs/shared-utils.md` gained a "Known duplicates" table, since the catalog's failure mode was naming one member of a family and hiding the rest.

#### Sandbox — the frozen-CLI failure mode is now self-diagnosable (#2202, #2214)

The sandbox image installs the Claude CLI unpinned, and neither an upstream release nor `docker rmi` refreshes it (the rebuild reuses the cached `npm install -g` layer). `error-recovery.md` now carries the symptom, the in-image version check, and the `docker builder prune -a -f` recovery; `docs/developer.md` no longer claims `yarn sandbox:remove` forces a rebuild.

#### Google sign-in — retry after abandoning browser consent (#2171)

Abandoning the browser consent screen previously left the link unretryable.

### Fixes

Chat sticky-bottom scroll (#2205), shadow-DOM-safe dropdown dismiss on `/collections` (#2212), collection live-refresh on direct writes (#2199), wiki summary schema left unwritten (#2226), Windows sandbox preset mount drift, floating promises across host and packages (#2191), unreachable type comparisons (#2207).

Ships `@mulmoclaude/core@0.28.0`, `@mulmoclaude/collection-plugin@0.14.0`, `@mulmoclaude/google-plugin@0.3.2`, `@mulmoclaude/accounting-plugin@0.3.3`.

> **Note for npm users:** `mulmoclaude@1.3.0` shipped dep ranges pinned to `@mulmoclaude/core@^0.23.0` and `@mulmoclaude/collection-plugin@^0.12.0`. A caret range on a `0.x` package does not float across minors, so installs of 1.3.0 could not receive anything published since — including most of the above. 1.4.0 is the first launcher that actually delivers it.

---

## [1.3.0] - 2026-07-18

**Your other calendars, in colour.** The Google tool now sees every calendar you've subscribed to — not just your primary — and carries each event's colour. Plus read-only CSV data collections backed by DuckDB.

### Highlights

#### Google Calendar — non-primary calendars & colours (#2162, #2164)

The `google` tool can now list the calendars you've added or subscribed to — primary, secondary, and shared — with `calendarListCalendars`, and read or create events on any of them by passing `calendarId` (default: your primary). Colours come through too: every event carries its `colorId`, each calendar its background/foreground hex, and `calendarColors` resolves the palette. Calendar listing follows pagination, so accounts with many calendars aren't truncated.

- Adds one minimal scope, `calendar.calendarlist.readonly`. **Existing users must re-link** (Settings → Plugins → Google) to grant it. Reading events on a known calendar id needs no re-link.

#### Collections — CSV dataSource via DuckDB (#2158, #2163)

Read-only collections backed by a CSV file, queried through DuckDB with a structured aggregation query DSL (`queryItems`).

Ships `@mulmoclaude/core@0.23.0`, `@mulmoclaude/collection-plugin@0.12.0`, `@mulmoclaude/google-plugin@0.3.0`.

---

## npm packages — 2026-07-20 (10)

`@mulmoclaude/core@0.28.0` — a wiki fix: two files the host reads on its own had no writer.

- **`@mulmoclaude/core@0.28.0`** (#2226) — `server/agent/prompt.ts` loads `data/wiki/summary.md` into the system prompt of **every session**, and points every role at `data/wiki/SCHEMA.md` when it exists. Both are declared `editPolicy: "agent-managed"`, but nothing ever instructed the agent to create or update them — they appeared only in a folder-layout diagram in the help, never in the Ingest or Lint operations. A wiki in real use for two months (202 pages) had neither file, and the failure is silent: with no `summary.md` the host falls back to a generic hint, so accumulated knowledge stops reaching ordinary conversations and nothing reports it. `assets/helps/wiki.md` now instructs Ingest to refresh `summary.md` (about a screenful — it costs context every session; topic areas and anchor pages, not a page list), makes Lint flag both files as missing or stale, marks both as agent-maintained in the layout, and adds a section on what belongs in each. That section also records why `summary.md` must never be phrased as instructions: the host wraps it in a `<reference>` block telling the model to ignore instructions inside it, because the summary derives from user-supplied sources and is therefore a prompt-injection surface. Help-only; no code changed.

---

## npm packages — 2026-07-20 (9)

Two behaviour fixes, one hardening fix, and a floating-promise sweep across the chat bridges. Shipped alongside `@mulmoclaude/core@0.27.0`, `@mulmoclaude/collection-plugin@0.14.0`, and `@mulmoclaude/google-plugin@0.3.2`.

- **`@mulmobridge/relay@0.2.1`** — the webhook signature check now **fails closed** when the signing secret is misconfigured, instead of falling through to the handler. Credentials for LINE, Messenger, Teams, Telegram and WhatsApp are read through `envSecret` (strings-or-absent) rather than `String()`-ing the platform binding, so a missing binding can no longer arrive as the literal string `"undefined"` and be treated as a configured secret.
- **`@mulmoclaude/accounting-plugin@0.3.3`** — the router no longer stringifies action arguments once they pass the service guard, so typed arguments reach the accounting service with their original types.
- **`@mulmobridge/slack@0.4.2`**, **`@mulmobridge/discord@0.1.2`**, **`@mulmobridge/mattermost@0.1.2`**, **`@mulmobridge/nostr@0.1.2`**, **`@mulmobridge/xmpp@0.1.2`** — unawaited promises in each bridge entry point are now handled explicitly, so a rejection surfaces rather than becoming an unhandled rejection. The lint rules covering this were ratcheted from warning to error across `packages/`.

---

## npm packages — 2026-07-17 (8)

- **`@mulmoclaude/mulmoscript-plugin@0.2.2`** — presentMulmoScript: updating a beat's `text` via the per-beat JSON source editor now drops that beat's cached narration audio, so the "Generate Audio" button reappears for the new text (previously only Play showed, with no way to re-generate). Audio files are content-addressed by text hash, so the view re-probes disk after the edit — reverting the text restores the existing audio without a paid TTS call.

---

## npm packages — 2026-07-17 (7)

presentMulmoScript `filePath` base clarified (the wire form `stories/<name>.json` has been **artifacts-relative, not workspace-relative**, ever since #284 moved the stories dir to `artifacts/stories/` — the tool description was never updated):

- **`@mulmoclaude/mulmoscript-plugin@0.2.1`** — tool schema no longer calls `filePath` "workspace-relative"; it now states the path is resolved against the workspace's `artifacts/` directory. Resolvers (`normalizeStoryPath`, server `resolveStory`) additionally accept the workspace-relative spelling `artifacts/stories/<rel>` the stale description taught, normalizing it to the canonical `stories/<rel>` wire form (responses always echo the canonical form). A bare `artifacts/foo.json` keeps its historical meaning (a file of that name under the stories dir).
- **`@mulmoclaude/core@0.22.1`** — `helps/mulmoscript.md` now states where relative `{ "kind": "path" }` media sources resolve from: the script file's own directory (`<workspace>/artifacts/stories/`), not the workspace root.

---

## npm packages — 2026-07-17 (6)

Package release riding PR #2137 (presentMulmoScript extraction, phase 3a of `plans/done/feat-mulmoscript-plugin.md`):

- **`@mulmoclaude/mulmoscript-plugin@0.2.0`** — the entire server ops layer moves into a new Node-only **`./server`** entry so any host runs the SAME mulmocast orchestration: all op cores (probes, beat/character rendering, audio, uploads, movie/PDF pipelines, background `autoGenerateMovie`), the edge-triggered generation tracker + `pendingGenerations` snapshot, the dispatch kind router (`createMulmoScriptDispatchHandler`, carrying the realpath symlink-containment guard), and the GraphAI provider-error capture. Host transport is injected via `MulmoScriptServerBackend`; `mulmocast` + `graphai` become peers (must resolve to the host's single hoisted copies). Review hardening: `toStoryRef` relativizes against the realpath stories root; `fileToDataUri` reads asynchronously. MulmoClaude's four host-side files (`mulmo-script-ops.ts`, `mulmoscript-builtin.ts`, `events/mulmoscript-generation.ts`, `utils/mulmoErrorCapture.ts`) collapsed into one ~60-line binding (`server/plugins/mulmoscript-server.ts`). MulmoTerminal wiring is phase 3b.

---

## npm packages — 2026-07-17 (5)

Package release riding PR #2133 (presentMulmoScript extraction, phases 1+2 of `plans/done/feat-mulmoscript-plugin.md`):

- **`@mulmoclaude/mulmoscript-plugin@0.1.0`** — NEW shared package for the `presentMulmoScript` tool, extracted so MulmoTerminal can import it like `@mulmoclaude/{markdown,form,chart,html}-plugin` (phase 3 does that wiring). **Server core (`.`)**: tool definition, body validators (former `mulmoScriptValidate.ts`), and save / reopen / update-beat / update-script logic against the generic `files.artifacts` capability. **`./vue` + `./style.css`**: the 1,950-line storyboard View + Preview with their own 8-locale i18n; the View reaches every backend through kind-discriminated `useRuntime().dispatch` envelopes, hears generation progress on the plugin pubsub `generation` channel (SSE streams and the `useActiveSession()` watcher both retired; a `pendingGenerations` snapshot dispatch covers views mounted mid-generation), and takes host transport (`chatSessionId`, authenticated `fetchMediaBlob`) via the optional host-adapter injection. MulmoClaude's route bodies moved to shared ops (`mulmo-script-ops.ts`) backing both the legacy REST routes and the new dispatch handler. Review hardening on the way in: non-negative-integer `beatIndex` validation on both surfaces, string-typed query guards, realpath symlink containment restored host-side (`guardStoryWirePath`), edge-triggered (refcounted) generation events, and stale-response guards on every View probe/mutator.

Hosts wiring the package's save/update executes must apply a realpath symlink-containment guard on wire paths — the package's own guard is lexical (see the phase-3 notes in the plan).

---

## [1.2.0] - 2026-07-17

**Google, without the setup.** Linking now takes a click and a consent screen — no Google Cloud project, no client JSON. And the agent can reach Tasks and Drive, not just Calendar.

### Highlights

#### Link Google with no Cloud setup (#2131, #2135)

Google requires a client secret at its token endpoint even under PKCE, so users without their own Cloud project could not finish a link — the "OAuth クライアント認証情報が見つかりません" dead end. The **mulmoserver broker** (receptron/mulmoserver#54) now applies that secret. It is **stateless**: it stores no token and no authorization code, and its callback hands the *code* — never a token — back to your machine, which does the exchange itself. **Refresh tokens still live only on your machine** (`~/.config/mulmo/`), so there is no central store to breach.

- Bring your own OAuth client? A **desktop** client JSON in `~/.secrets/` still wins and keeps the entire flow local — self-hosters lose nothing.
- Tokens record which client minted them (`issuedVia`), so renewals use the right one. Existing links keep working untouched.
- Hardening: the broker URL must be HTTPS unless loopback, and the consent URL it returns must be `https://accounts.google.com` before any browser opens.

#### Google Tasks and Drive tools (#2115, #2132)

The `google` tool gains seven kinds: list task lists, list / add / complete tasks, and list / create / read Drive files. Drive is `drive.file`-scoped — the app only ever sees files **it** created, never your wider Drive.

> These shipped in packages on 2026-07-17 but could not reach `npx mulmoclaude@1.1.1` users: a 0.x caret range (`^0.1.1`) does not cross a minor, so the launcher never resolved them. This release is what actually delivers them.

#### Host-neutral link guidance (#2128, #2130)

The unlinked-state guidance named MulmoClaude-only flows, misdirecting MulmoTerminal users (the plugin runs on both). Wording is now host-neutral; each host's own help carries the specific steps.

Ships `@mulmoclaude/core@0.22.0`, `@mulmoclaude/google-plugin@0.2.1`, `@mulmoclaude/collection-plugin@0.11.4`.

---

## [1.1.1] - 2026-07-17

Follow-up to 1.1.0: the Google OAuth token store becomes host-neutral.

### Changed

- **Google token path** — the refresh token moves from `~/.config/mulmoclaude/google-token.json` to `~/.config/mulmo/google-token.json` (the engine is shared with MulmoTerminal, so the directory drops the app branding). Existing tokens migrate automatically on first read: an atomic non-clobbering copy (`COPYFILE_EXCL`, mode 600 preserved, TOCTOU-safe) plus a legacy-path fallback read so a failed migration never makes a linked account look unlinked. (#2122, #2124)

Ships `@mulmoclaude/core@0.20.1` and `@mulmoclaude/google-plugin@0.1.1`.

---

## [1.1.0] - 2026-07-17

**Google Calendar integration, end to end** — link once, then use it from the chat agent, the settings screen, and your phone. Plus per-beat controls for mulmoScript and collection engine consolidation.

### Highlights

#### Google Calendar integration (#2108 → #2110, #2111 → #2113, #2114 → #2120)

- **Local desktop OAuth (loopback + PKCE)**: the refresh token is stored only on your machine, never sent to any cloud — the gcloud / gh CLI trust model. One consent covers `calendar.events`, `tasks`, and `drive.file` (Tasks / Drive tools land later, #2115).
- **Settings → Plugins → Google**: link / status / unlink UI, with guidance when the OAuth client JSON is missing or ambiguous (#2113).
- **Chat agent `google` tool** (new `@mulmoclaude/google-plugin` preset, `personal` role): list upcoming events and create events by asking in plain language. When the account isn't linked, the agent reads the new error-recovery help and walks you through linking (#2120).
- **Phone remote commands** `google.calendar.createEvent` / `listEvents` over the Firestore command channel — the token stays on the host (#2110).
- Strict shared RFC3339 validation (offset required, impossible dates / out-of-range offsets rejected) hardened through four Codex review iterations.

#### mulmoScript: per-beat generate / play (#2119)

Generate or play each beat individually from the script editor, with real generation errors surfaced instead of silent failures.

#### Collections engine consolidation (#2116, #2118)

Collection rollups, and `manageCollection` extracted into `@mulmoclaude/core/collection/server` so both hosts share one engine.

### Fixed

- Malformed stored collection files downgrade to a row rejection instead of failing the whole merge-mode put (#2118).

### Docs / internal

- Collection egress documentation (#2117); multi-file attachment regression test (#2109); dependency refresh (#2106, #2123); shipped-plan archive sweep (#2112).

Ships `@mulmoclaude/core@0.20.0`, `@mulmoclaude/google-plugin@0.1.0`, `@mulmoclaude/collection-plugin@0.11.2`.

---

## npm packages — 2026-07-17 (4)

Package releases riding PR #2132 (Google Tasks / Drive tools, issue #2115):

- **`@mulmoclaude/core@0.21.0`** — new Tasks engine (list lists / list / create / complete / delete, `@default` list alias) and Drive engine under the `drive.file` scope (list / multipart create / text-only read / delete). Multipart uploads use a per-request random boundary re-derived until it collides with no part, and `assertSafeMimeType` refuses non-token MIME values (part-header injection). The Calendar REST plumbing is extracted into a shared `apiClient.ts` (timeout, per-API 403 hint, error truncation, field mapping). `assets/helps/error-recovery.md` gains per-API 403 guidance plus the "Drive only sees this app's files" explanation.
- **`@mulmoclaude/google-plugin@0.2.0`** — seven new kinds on the `google` tool: `taskListsList` / `tasksList` / `tasksCreate` / `tasksComplete` / `driveList` / `driveCreate` / `driveRead`. The description states the Drive visibility limit and the date-precision `due` so the agent can't over-promise.
- **`@mulmoclaude/collection-plugin@0.11.3`** — core peer range widened to `^0.21.0`; no functional changes.

Existing grants already carry `tasks` + `drive.file` (requested since core 0.20.0), so no re-link is needed.

---

## npm packages — 2026-07-17 (3)

Package releases riding PR #2130 (host-neutral link guidance, issue #2128):

- **`@mulmoclaude/core@0.20.2`** — the `getGoogleAccessToken()` not-linked error drops MulmoClaude-only wording; hosts' own help carries the specific link steps.
- **`@mulmoclaude/google-plugin@0.1.2`** — the tool prompt and `status` guidance say "link their Google account in this app's settings" (MulmoTerminal has no "Settings → Plugins → Google" and no `yarn google:auth`); the README documents both hosts' actual flows.

---

## npm packages — 2026-07-17 (2)

Package releases riding PR #2124 (host-neutral Google token path, issue #2122):

- **`@mulmoclaude/core@0.20.1`** — the Google token store moves to the host-neutral `~/.config/mulmo/google-token.json` (the engine is shared with MulmoTerminal). Pre-0.20.1 tokens migrate automatically via an atomic non-clobbering copy (`COPYFILE_EXCL`, mode 600 preserved, TOCTOU-safe) with a legacy-path fallback read so a failed migration never strands a linked user. `assets/helps/error-recovery.md` updated.
- **`@mulmoclaude/google-plugin@0.1.1`** — tool prompt / docs follow the new path; core range `^0.20.1`.

---

## npm packages — 2026-07-17

Package releases riding PR #2120 (agent-facing Google Calendar tool, issue #2114):

- **`@mulmoclaude/core@0.20.0`** — new server-only `./google` subpath: the local Google OAuth engine extracted from the host — loopback + PKCE consent (`authorizeGoogle`), token store at `~/.config/mulmoclaude/google-token.json` (mode 600, atomic writes with the Windows transient-rename retry), single-flight auth-flow manager, Calendar v3 REST helpers, and the strict shared RFC3339 validator (`isIsoDateTimeWithOffset`, rejecting offset-less / impossible / out-of-range values). Adds the Google recovery section to `assets/helps/error-recovery.md`; `google-auth-library` becomes a core dependency. Consent scopes: `calendar.events`, `tasks`, `drive.file`.
- **`@mulmoclaude/google-plugin@0.1.0`** — initial release. Server-only runtime plugin exposing one `google` tool to the chat agent (`status` / `calendarListEvents` / `calendarCreateEvent`), dispatching into `@mulmoclaude/core/google` so every surface shares one locally stored grant. Preset plugin, gated to the `personal` role.
- **`@mulmoclaude/collection-plugin@0.11.2`** — dependency alignment: `@mulmoclaude/core` range widened to `^0.20.0`; no functional changes.

---

## [1.0.0] - 2026-07-14

MulmoClaude reaches **1.0** — the first stable release. Functionally it builds directly on 0.9.7, adding **Web Push on task finish** (get a push on your phone the moment the answer to a question you asked is ready) and a launcher fix that loads `.env` from the directory you launch from. 18 non-merge commits since 0.9.7.

### Highlights

#### Web Push on task finish (#2086)

Enable **Settings → Notifications → Web Push** to get a push on your registered devices when a turn you started finishes — the "ask a question, step away, get pinged when the answer's ready" flow, working even with the browser tab closed as long as the host machine is up. Only **human-initiated** turns fire it (scheduler / skill / bridge / system turns are excluded), and only while the **RemoteHost** channel is connected (that's what supplies the Firebase sign-in) — otherwise it's a silent no-op. The send core is the new auth-agnostic **`@mulmobridge/web-push`** package, extracted so MulmoClaude and MulmoTerminal share one source of truth for the mulmoserver `sendPush` wire contract; device registration and delivery stay server-side (mulmoserver#46).

### Fixed

- **Launcher loads `<launch-dir>/.env`** (#2081) — `npx mulmoclaude` now reads a `.env` in the directory you launch from, so `GEMINI_API_KEY` (and other env vars) take effect without exporting them by hand. Previously only the isolated `~/mulmoclaude` workspace was consulted.

### Changed

- Dependency refresh (#2088).

### `@mulmoclaude/core@0.13.1` - 2026-07-14

- **Docs (#2081)**: the Gemini API-key help now tells users to put `GEMINI_API_KEY` in a `.env` file **in the directory they launch MulmoClaude from** (not the isolated `~/mulmoclaude` workspace), matching the launcher's new launch-dir `.env` loading. Ships via `assets/helps/gemini.md`.

📦 npm: [`mulmoclaude@1.0.0`](https://www.npmjs.com/package/mulmoclaude/v/1.0.0)

---

## [0.9.7] - 2026-07-14

Chat input no longer locks while the agent is running — messages you type are queued and flushed in order once the run finishes. RemoteHost (driving MulmoClaude from a phone) now persists its Firebase session in the browser and reconnects across server/browser restarts, without a re-login popup — bundled via `@mulmoclaude/core@0.13.0`. 25 non-merge commits since 0.9.6.

### Highlights

#### Chat input: queue sends while the agent runs (#2067)

The composer no longer disables while a run is in progress — messages you type are buffered and sent in order once the agent is free, instead of the input locking. The buffer is scoped per session, and Ctrl/Cmd+Enter inserts a newline without triggering the slash menu.

#### RemoteHost session persistence (#2073, #2075)

A host's Firebase session is now parked in the browser and restored after a server or browser restart, so a phone paired to the host stays connected without a re-login popup. Reconnect is non-destructive: a transient network failure keeps the live session, while an expired or malformed session blob is dropped rather than retried forever. Shipped in `@mulmoclaude/core@0.13.0` (see the sub-note below for the API surface).

### Fixed

- e2e-live CI: pinned the auth token to stop an intermittent 401 flake caused by a token-regeneration race (#2069).

### Documentation

- Documented the MCP stdio-under-Docker opt-in (`hostExecInDocker`, a per-server toggle) and environment-variable passthrough, propagated across all README translations, with a plain-language "Short version" lead and a Japanese edition of the sandbox guide (#2071). The feature itself shipped earlier (#1421); this release documents it.

### `@mulmoclaude/core@0.13.0` - 2026-07-13

RemoteHost session persistence (receptron/mulmoserver#50, case A'): a host's Firebase session is parked in the browser and restored after a server restart, without a re-login popup. First core release carrying this API (#2074) and the mulmoclaude-wiring hardening (#2076).

- **New API**: `createHostSessionPersistence()` (seed/export-able Firebase Auth persistence) and `createRemoteHostSession(config)` — `open(seedBlob?, validate?)` / `close()` / `exportSession()` / `onSessionChange()`. New exports: `isSeedableBlob`, `RemoteHostSessionValidate`, `HostAuthPersistenceClass`, `HostAuthPersistenceInstance`.
- **Fix (#2076)**: persistence is now a class as `initializeAuth` requires — fixes `INTERNAL ASSERTION FAILED: Expected a class definition` that broke `createRemoteHostSession.open()`. Non-destructive `(re)connect` via a pre-teardown `validate` hook (a failed sign-in / expired blob keeps the live session). Reconnect classifies expired/malformed blobs (drop) vs transient failures (keep), so a network blip no longer forces a re-login and a corrupt blob is not retried forever.

📦 npm: [`@mulmoclaude/core@0.13.0`](https://www.npmjs.com/package/@mulmoclaude/core/v/0.13.0)

---

## [0.9.6] - 2026-07-12

Resolves the `handlePermission not found` MCP-broker failure family end-to-end — one error symptom with three distinct root causes (#2052 / #2056 / #2057) — so the Docker sandbox and scheduled runs stop losing all their tools at once. Adds a mobile-PWA QR code to the remote-host popover. 95 non-merge commits since 0.9.5.

### Highlights

#### MCP broker `handlePermission not found` — full family fix (#2058)

The sandbox MCP broker could fail to come up, dropping every `mcp__mulmoclaude__*` tool at once — so the CLI reported the missing permission-prompt tool instead of the real cause. Fixed across two layers, each with regression tests (mapped in `plans/mcp-broker-availability-matrix.md`):

- **Windows junction fallback now covers every workspace scope (#2052)** — the `/app/pkg_modules` fallback previously covered only `@mulmoclaude/*`, so `@mulmobridge/*` dangled inside the Linux container and the broker died at load. Verified on real Windows CI (WSL2 + native `dockerd`, real NTFS junctions).
- **npx nested `node_modules` mounted (#2056)** — when npm nests deps in the launcher's own `node_modules` instead of hoisting them, they are now bind-mounted into the container.
- **Scheduler startup race (#2057)** — a spawned chat's broker can lose the startup race to the CLI's first tool call. Now same-minute firings are staggered (capped to half a tick), a lost race is auto-recovered by replaying the turn once (guarded against double-execution and aborts), and a spawned-but-failed run records its real error instead of a false `"success"`.

#### Remote host: mobile PWA QR code (#2054)

The remote-host popover now shows a QR code for the mobile PWA, so pairing a phone no longer requires typing the URL by hand.

### Fixed

- `isTestEnv` no longer misdetects any path containing "test" (which caused `yarn dev` 401s) — it exact-matches argv now (#2064).
- npm `file:` specifiers emit POSIX separators, fixing Windows CI installs (#2048).
- Whisper absorbs a late partial-file open error during model download instead of crashing the stream (#2046, #2047).

### Changed

- Large internal refactors to clear the `max-lines-per-function` lint ratchet across whisper, relay, and several composables (#2049, #2050, #2051, #2053, #2060, #2045, #2044, #2042, #2041, #2040, #2039).
- README / MANIFEST now lead with the product "nurture" vision (#2061, #2062).
- Dependency refresh (#2065).

---

## [0.9.5] - 2026-07-08

Windows Docker sandbox is now fully functional end-to-end (the ESM half of the resolver gap #1946 / #1982 landed alongside the CJS fix from 0.9.4), HEIC / HEIF attachments transparently convert to JPEG on upload with in-browser preview, and a **user-extensible sandbox CSP** lets the runtime whitelist third-party origins through `config/csp.json` instead of hard-coding them. Remote host gains offline queueing (mobile requests hold until the host comes back). The lint suite got a deep clean: `sonarjs/assertions-in-tests` is now `error`, so an assertion-less test can't slip in unnoticed. 23 non-merge commits since 0.9.4.

### Highlights

#### Windows Docker sandbox: end-to-end fix (#1982)
- New `server/agent/mcp-esm-loader.mjs` + `mcp-esm-bootstrap.mjs` — an ESM resolver hook registered via `tsx --import` on the MCP child in Docker mode. NODE_PATH is CJS-only per Node's spec, so the previous 0.9.4 fix restored preset loading but left static ESM imports (`import { readXPost } from "@mulmoclaude/x-plugin"`) broken. Now every `@mulmoclaude/*` specifier resolves.
- Windows CI probe (`test/sandbox-repro/probe.ts` + `.github/workflows/docker_sandbox_windows.yaml`) grew an ESM `import()` step, so this class of regression can't slip through again.
- **No-op on Linux / macOS** — the hook's fallback only fires when primary resolution fails; the ESM loader is unchanged everywhere else.

#### HEIC / HEIF / TIFF / BMP / AVIF attachments (#1996)
- Uploader auto-converts these formats to JPEG server-side before the chat surface sees them (heic-convert on the launcher deps).
- Pre-send preview chip decodes HEIC in the browser (#2000), so the confirmation thumbnail is legible instead of a broken image.

#### User-extensible sandbox CSP (#1989)
- Sandboxed collection views can now whitelist third-party origins via workspace `config/csp.json`.
- A CSP-violation notice + boot-time warnings surface misconfigurations to the user instead of failing silently.

#### Remote host offline queueing (step 1 of #1993)
- Mobile companion's `startChat` requests queue while the host is offline; the host + `@mulmoclaude/core` layer replay them once the presence doc goes live.
- `advertise host capabilities in the presence doc` (#1992) lands as the discovery half — mobile now knows what the host supports before submitting.

#### Lint: assertions-in-tests as an error (batches #1999 / #2001 / #2005)
- 26 flagged tests (server / utils / plugins node:test + e2e Playwright specs) rewritten to wrap the target call in `assert.doesNotThrow(...)` / `assert.doesNotReject(...)` — no semantic change, contracts made explicit.
- Includes a new real boundary test for `deleteProjectSkill`'s user-scope refusal path (was an empty placeholder before), driven by a `userDir` seam so the guard is actually exercised.
- Rule promoted to `error` in `eslint.config.mjs` — CI blocks a new assertion-less test.

#### Files: "Open in OS" button (#1985)
- Binary / unsupported previews get an OS-native open button so the file view isn't a dead end when MulmoClaude can't render inline.

#### Sandbox: allow collection view downloads (#1997)
- File downloads now work from sandboxed collection views (were being blocked by the iframe sandbox flags).

### Added
- ESM resolver hook + bootstrap for Windows Docker MCP child (#1982 / #1995).
- HEIC / HEIF / TIFF / BMP / AVIF → JPEG on upload + browser-side HEIC preview (#1996 / #2000).
- Sandbox CSP allowlist via `config/csp.json` + violation surface (#1989 / #1990).
- Remote host offline queue for `startChat` + host-capability advertisement (#1992 / #1993).
- Real unit coverage for `deleteProjectSkill` user-scope refusal via new `userDir` seam (#2001).
- Files view: "Open in OS" button for binary previews (#1985 / #1988).
- Smoke: resolve first-party deps from the workspace instead of public npm (#1994) — trims flakiness when a shared package is mid-publish.

### Changed
- `sonarjs/assertions-in-tests` promoted from `warn` to `error` (#2005). Every existing hit rewritten in advance across #1999 / #2001.
- Windows Docker CI probe now runs an ESM step (`docker_sandbox_windows.yaml`).
- `resolvePresetRoot` delegates to Node's resolver for NODE_PATH (#1984, tidies the fallback path #1974 introduced).
- `@mulmoclaude/collection-plugin` bumped to 0.7.4 in the workspace + published (#1987 for 0.7.1 → 0.7.4 range).
- Documentation: remote host guide (#1979) + launch plan re-centred on Collections (#1971).
- `remote-host` transport extracted into `@mulmoclaude/core` (#1980) — reusable across host + mobile pairs.

### Fixed
- Sandboxed collection view file downloads blocked by iframe flags (#1997).
- Ref-crossing derived fields in mobile `getItems` failing to resolve (#1978).
- The `mulmoclaude@0.9.5` launcher publish itself required a cascade publish of `@mulmoclaude/collection-plugin@0.7.4` (skill §2 drift check covers only `@mulmobridge/*` scope). PR #2006 updates the skill so the manual `@mulmoclaude/*` check is now a documented step.

### Security
- User-extensible sandbox CSP (#1989) narrows what a sandboxed collection view can reach — the default remains locked down; only origins explicitly listed in `config/csp.json` are allowed through.

---

## [0.9.4] - 2026-07-05

Retrospective release entry for the `mulmoclaude@0.9.4` npm publish that shipped without a matching GitHub release. Focused on **Windows Docker sandbox recovery** (root of #1946) and a batch of **remote host / mobile-companion** improvements (session-history summaries, listSkills, attachments over Storage, capability advertisement). 19 non-merge commits since 0.9.3.

### Highlights

#### Windows Docker sandbox: CJS-side fix (#1946)
- `packages/mulmoclaude/package.json` gets a NODE_PATH fallback so `@mulmoclaude/*` workspace packages resolve inside the Linux container even when the yarn workspace symlinks (Windows junctions) dangle.
- Follow-up ESM half landed in 0.9.5; the 0.9.4 fix restored the preset loader path only.

#### Remote host / mobile companion polish
- **Remote view attachments** (#1954): mobile can now share photos / videos / PDFs into a chat via Storage, without pulling them through localhost.
- **listSkills + free-form `startChat`** (#1947): mobile can enumerate host skills and start chats without picking a role first.
- **List accounting books + choose role on startChat** (#1962): mobile-side workflow selects a role at chat creation.
- **Popover UI help** (#1955): explanations for the presence popover so users understand the same-Google-account contract.

#### Collections + Files
- **Dynamic collection icons** based on data state (#1900 / #1957).
- **Hide agent-internal top-level dirs by default** (#1896 / #1963) — the file tree stops leaking `chat/` / `summaries/` unless the user opts in.

#### Session history: summary-first
- **Summary-first, hover for full** (#1958 / #1959) — the session list surfaces the LLM-generated summary; hovering reveals the full first message.
- **Journal + chat-index: configurable mode + always-on origin filter** (#1944 follow-ups: #1949 / #1951).

### Added
- Remote-view attachments via Storage (#1954).
- Mobile `listSkills` + free-form `startChat` (#1947); accounting book picker (#1962).
- Popover UI help copy on the remote-host presence indicator (#1955).
- Dynamic collection icons (#1957).
- Session-history summary-first with hover-for-full (#1959).
- Files: hide agent-internal top-level dirs by default (#1963).
- Docs: consolidate what runs in Docker vs host (#1966); Remote Access README section (#1970); CLAUDE.md rule forbidding preemptive launcher version bumps in `chore(release)` (#1948).

### Changed
- Journal + chat-index: configurable mode + always-on origin filter (#1944 / #1949 / #1951).
- `mulmocast` bumped to 2.7.0 (#1952).

### Fixed
- Collections: 409 on file-ancestor import path is Windows-safe (#1967).
- Windows cross-platform path bugs failing lint_test_windows (#1965).
- Address CodeRabbit review comments from #1951 (#1953).

---

## [0.9.3] - 2026-07-03

Two threads dominate this release: **writable remote custom views for the mobile companion** (phase 3–5 of the remote-view work — mobile-optimised LLM-generated views, update/delete over the Firestore channel, and inlined workspace image thumbnails so the phone doesn't reach localhost) and a **batch of correctness fixes** across chat UI, long-message rendering, collection deep-links, notification icon clashes, and the billing recipe. Plus the new CI gate that enforces launcher ↔ shared-package sync (root cause of #1920). 38 non-merge commits since 0.9.2.

### Added

- **Remote custom views — phase 3** ([#1932](https://github.com/receptron/mulmoclaude/pull/1932)) — collection views can now specify `target: "mobile"`, and the desktop shows a phone-frame preview. `getRemoteView` handler lets the mobile companion (mulmoserver) fetch these views over the Firestore command channel.
- **Remote custom views — phase 4** ([#1933](https://github.com/receptron/mulmoclaude/pull/1933)) — writable mobile views: `mutateRemoteView` handler supports update/delete of records from the phone, with derived-field resolution + clone-safe preview pages so edits round-trip cleanly.
- **Remote custom views — phase 5** ([#1938](https://github.com/receptron/mulmoclaude/pull/1938)) — workspace image thumbnails inlined into the mobile response (via `sharp`), so the phone never has to reach localhost. Includes thumbnail budget mutation, invalid-id reporting on update, and log hygiene per review.

### Changed

- **launcher-sync CI gate — strict lockstep** ([#1927](https://github.com/receptron/mulmoclaude/pull/1927)) — added invariants 4 (launcher range lower bound == workspace source, strict) and 5 (`gui-chat-protocol` peer dep major.minor == launcher pin major.minor) to `scripts/mulmoclaude/launcherSync.mjs`. Enforces the class of drift that caused [#1920](https://github.com/receptron/mulmoclaude/issues/1920) at PR time.
- **`bin/mulmoclaude.js` reads version from `package.json`** ([#1925](https://github.com/receptron/mulmoclaude/pull/1925)) — no more hardcoded string that silently drifts every publish. `--version` now always matches the shipped `package.json`.
- **Chat-index scheduler skips unchanged sessions** ([#1930](https://github.com/receptron/mulmoclaude/pull/1930), tracking [#1929](https://github.com/receptron/mulmoclaude/issues/1929)) — before this fix, the hourly `system:chat-index` scheduler re-summarised every session every hour regardless of whether the jsonl had changed. Now only sessions whose jsonl mtime is newer than the last index get re-processed; the CLI call rate drops from `O(sessions × 24)` to `O(actually-touched sessions × 24)` per day on a busy workspace.
- **billing-clients-worklog recipe reconciles pre-existing data** ([#1941](https://github.com/receptron/mulmoclaude/pull/1941), tracking [#1626](https://github.com/receptron/mulmoclaude/issues/1626)) — the recipe now includes a mandatory reconcile step that inventories existing worklog rows, slugifies non-slug `clientId` values (with slug-contract enforcement + empty/oversize fallbacks + collision detection), and rewrites worklog rows in lockstep. Prevents the "setup looks done but ref links break" trap when a user has legacy worklog data with display-name `clientId` values.
- **Session role icons** ([#1942](https://github.com/receptron/mulmoclaude/pull/1942), tracking [#1684](https://github.com/receptron/mulmoclaude/issues/1684)) — General → `auto_awesome`, Debug → `bug_report`, unknown-role fallback → `smart_toy`. Was `star` on all three, colliding with the PinToggle's ★ (favourite) glyph for collection shortcuts.

### Fixed

- **Chat UI silently loses events mid-turn** ([#1934](https://github.com/receptron/mulmoclaude/pull/1934), tracking [#1915](https://github.com/receptron/mulmoclaude/issues/1915)) — three complementary fixes so the "考え中…" indicator can never stick when the server actually finished. Immediate `isRunning=false` on `session_finished`, new `usePubSub().onReconnect()` API for socket.io reconnect catch-up, and a `document.visibilitychange` handler that covers Safari's silent tab throttling (WS stays "connected" server-side while delivery stops client-side).
- **Safari freezes on model degenerate-repetition output** ([#1936](https://github.com/receptron/mulmoclaude/pull/1936), tracking [#1863](https://github.com/receptron/mulmoclaude/issues/1863)) — cap the string fed into `marked()` at 100k chars in the text-response view. Opus 4.8's repeat-word bug could produce 30k `<p>` elements per message; Safari's layout/paint froze for minutes. Now shows a truncation banner + preview slice; the full raw text is still one click away via the Copy button. Localised across all 8 locales.
- **`?selected=<id>` deep-link no longer forces calendar view** ([#1939](https://github.com/receptron/mulmoclaude/pull/1939), tracking [#1675](https://github.com/receptron/mulmoclaude/issues/1675)) — Bell-notification deep-links now open the record modal in the user's saved view mode (table / kanban / calendar) instead of always switching to calendar and writing "calendar" into localStorage. e2e tests updated to assert the new contract.
- **`sharp` was missing from launcher `dependencies`** ([#1938](https://github.com/receptron/mulmoclaude/pull/1938)) — the remote-view thumbnail flow added a `sharp` import to `server/*` but the launcher `package.json` never declared it, so `npx mulmoclaude` would `ERR_MODULE_NOT_FOUND` on the first thumbnail request. `deps.mjs` gate would have caught it; adding the entry closes the gap.
- **CodeQL false-positive in remote-view sessionId sanitisation** ([#1937](https://github.com/receptron/mulmoclaude/pull/1937)) — switched to `path.basename` as the CodeQL-recognised path sanitizer; sessionId is now sanitised at every entry point.
- **`chat-index` scheduler interval relaxed to 6h** ([#1931](https://github.com/receptron/mulmoclaude/pull/1931)) — hourly was excessive given the skip-unchanged optimisation; 6h keeps the summary fresh enough for the picker without CLI cost.

### Internal

- **Root ↔ launcher ↔ plugin peer dep sync gate** ([#1923](https://github.com/receptron/mulmoclaude/pull/1923)) — new `scripts/mulmoclaude/launcherSync.mjs` audits every PR for three invariants (root ↔ launcher common dep range identical, workspace source satisfies launcher range, plugin `peerDependencies` satisfied by launcher pins). Catches the [#1920](https://github.com/receptron/mulmoclaude/issues/1920) class of bug at PR time.
- **CHANGELOG.md for 0.9.2 with PR / issue links** ([#1926](https://github.com/receptron/mulmoclaude/pull/1926)) — retroactive entry documenting the 30 PRs shipped in 0.9.2.
- **Fix plan archived** ([#1935](https://github.com/receptron/mulmoclaude/pull/1935)) — `plans/done/fix-1915-chat-ui-stuck-mid-turn.md` → `plans/done/` after merge.

### Cascade publishes

- `@mulmoclaude/core` 0.7.0 → 0.7.1 → 0.8.0 → 0.8.1
- `@mulmoclaude/collection-plugin` 0.6.0 → 0.7.0
- `@mulmobridge/client` 0.1.4 → 0.1.5

---

## [0.9.2] - 2026-07-02

Two threads dominate this release: a **critical fresh-install regression on npm** (#1920 — bundled plugins silently dropped by `ERESOLVE overriding peer dependency`), and the first two phases of a **mobile remote channel** so a companion app can browse a workspace over Firestore. Plus share-as-zip landing in three phases, mermaid diagrams inside markdown finally rendering as diagrams, session-role continuity across `/switch` and HTTP `/connect`, a wiki-engine extraction into `@mulmoclaude/core/wiki`, and a new CI gate that catches the class of drift that caused #1920 in the first place. 30 PRs merged since 0.9.1.

### Added

- **Mobile remote — Firestore command channel, phase 1a** ([#1909](https://github.com/receptron/mulmoclaude/pull/1909)) — login UI, presence heartbeat (60 s), and host runner lifecycle (`connect` / `disconnect`, atomic status transitions, listener-death → offline reconciliation). Commands live under `users/{uid}/hosts/mulmoclaude/commands` and are isolated per user by the standard `request.auth.uid == uid` Firestore rule.
- **Phase 1b — `listCollections` handler + popover auto-close** ([#1914](https://github.com/receptron/mulmoclaude/pull/1914)) — the mobile remote can list a workspace's collections; the connect popover auto-closes on connect / disconnect.
- **Phase 2 — read-only paginated data handlers** ([#1918](https://github.com/receptron/mulmoclaude/pull/1918)) — `getCollection(slug, offset?, limit?)`, `getFeed(slug, offset?, limit?)` (identical shape so mobile reuses one card renderer), `listShortcuts()`, `listFeeds()`. Pagination is mandatory because Firestore caps a single command document at 1 MiB; `limit` clamped to `[1, 200]` (default 50).
- **Phase 2 — `startChat` handler** ([#1922](https://github.com/receptron/mulmoclaude/pull/1922)) — the mobile remote can start a chat targeting either a collection or a specific record. Rejects unknown slugs before spawning; refuses feeds (no slash-command surface); validates slug / itemId as whitespace-free string tokens.
- **Share as zip — phase 1** ([#1892](https://github.com/receptron/mulmoclaude/pull/1892)) — bundle an HTML artifact + its assets (images, CSS, JS) into one self-contained zip.
- **Share as zip — phase 1b** ([#1901](https://github.com/receptron/mulmoclaude/pull/1901)) — Download (zip) button in the HTML view.
- **Share as zip — phase 1c** ([#1907](https://github.com/receptron/mulmoclaude/pull/1907)) — Download (zip) in the file-explorer HTML preview.
- **Share as zip — phase 3** ([#1910](https://github.com/receptron/mulmoclaude/pull/1910)) — markdown pages and wiki pages export as self-contained HTML zips, so a shared markdown note travels with its images and diagrams intact.
- **Mermaid fenced blocks render as diagrams** ([#1906](https://github.com/receptron/mulmoclaude/pull/1906), tracking [#1904](https://github.com/receptron/mulmoclaude/issues/1904)) — ` ```mermaid ` in any markdown-rendered surface (chat, wiki, markdown plugin) draws the diagram instead of showing raw source.
- **Session query counter + long-running (24 h+) filter** ([#1885](https://github.com/receptron/mulmoclaude/pull/1885)) — per-user query counter and a picker filter to isolate multi-day sessions.
- **Exclude scheduler sessions from long-running filter** ([#1887](https://github.com/receptron/mulmoclaude/pull/1887), tracking [#1886](https://github.com/receptron/mulmoclaude/issues/1886)) — background scheduler-triggered sessions no longer clutter the long-running view.
- **`chat-index` summaries use Sonnet + wider input window** ([#1884](https://github.com/receptron/mulmoclaude/pull/1884)) — better summaries for long chats.
- **Accounting: any month-end as fiscal year end** ([#1890](https://github.com/receptron/mulmoclaude/pull/1890)) — previously locked to quarter-end months; now any month.

### Changed

- **Wiki engine extracted into `@mulmoclaude/core/wiki`** ([#1875](https://github.com/receptron/mulmoclaude/pull/1875)) — pure engine (parse, link resolution, backlinks, snapshot policy) moved into shared core so mulmoclaude, mulmoserver, and downstream tools all share one implementation.
- **Wiki fs / YAML server read-engine extracted into `@mulmoclaude/core/wiki/server`** ([#1876](https://github.com/receptron/mulmoclaude/pull/1876)) — follow-up to #1875 that finishes the extraction on the server side.
- **`CHAT_DIR` sourced from `WORKSPACE_DIRS`** ([#1903](https://github.com/receptron/mulmoclaude/pull/1903), tracking [#1902](https://github.com/receptron/mulmoclaude/issues/1902)) — one single source of truth for the chat directory path.
- **`publish-mulmoclaude` skill pins the public npm registry** ([#1924](https://github.com/receptron/mulmoclaude/pull/1924)) — avoids install-time picking up a scope-override registry.
- Routine dependency + tooling updates: [#1872](https://github.com/receptron/mulmoclaude/pull/1872), [#1873](https://github.com/receptron/mulmoclaude/pull/1873), [#1877](https://github.com/receptron/mulmoclaude/pull/1877), [#1919](https://github.com/receptron/mulmoclaude/pull/1919).

### Fixed

- **Bundled plugins fail to load on fresh install ([#1920](https://github.com/receptron/mulmoclaude/issues/1920) / [#1921](https://github.com/receptron/mulmoclaude/pull/1921))** — `mulmoclaude@0.9.1` pinned `gui-chat-protocol@0.4.0` but three bundled plugins declared `peerDependencies.gui-chat-protocol: ^0.3.0`. npm papered over the conflict with a silent `ERESOLVE overriding peer dependency` override; the plugins then failed their runtime handshake and were dropped from the registered plugin set (`[plugins/preset] loaded requested=4 succeeded=1`, followed by `mcp__mulmoclaude__handlePermission not found`). All 8 workspace plugins (`form`, `markdown`, `spotify`, `email`, `recipe-book`, `bookmarks`, `debug`, `edgar`) bumped their `gui-chat-protocol` peer dep to `^0.4.0` with a patch bump. Enormous thanks to [@drippinghydrangea-a11y](https://github.com/drippinghydrangea-a11y) for the extremely detailed reproduction that pinpointed the peer-dep gap.
- **Bridge chat turns serialize per external chat** ([#1879](https://github.com/receptron/mulmoclaude/pull/1879), tracking [#1878](https://github.com/receptron/mulmoclaude/issues/1878)) — two rapid messages from the same external chat no longer race each other into the same session.
- **`/switch` preserves session role** ([#1893](https://github.com/receptron/mulmoclaude/pull/1893), tracking [#1888](https://github.com/receptron/mulmoclaude/issues/1888)) — reconnecting an existing chat via `/switch` no longer resets its role to the default.
- **HTTP `/connect` resolves target session's role** ([#1895](https://github.com/receptron/mulmoclaude/pull/1895), tracking [#1894](https://github.com/receptron/mulmoclaude/issues/1894)) — when a bridge reconnects a chat by session ID, the role is looked up server-side instead of being redeclared client-side.
- **`/connect` rejects unsafe `chatSessionId`** ([#1905](https://github.com/receptron/mulmoclaude/pull/1905)) — defense-in-depth follow-up to [#1895](https://github.com/receptron/mulmoclaude/pull/1895) — early reject at the handler entry point with a matching test.
- **Canonical `dataPath` threaded into ingest / action seed prompts** ([#1897](https://github.com/receptron/mulmoclaude/pull/1897), tracking [#1891](https://github.com/receptron/mulmoclaude/issues/1891)) — action templates and ingest steps now receive the collection's canonical `dataPath` instead of re-deriving it, with cross-platform (Windows POSIX) + ReDoS defenses in the sanitiser.
- **Mermaid quoted labels + HTML in SVG labels** ([#1917](https://github.com/receptron/mulmoclaude/pull/1917), tracking [#1916](https://github.com/receptron/mulmoclaude/issues/1916)) — fixed a double-encoding bug that made `<foo>` in Mermaid labels arrive at the renderer as `&lt;foo&gt;`; unlocked HTML fragments inside labels.
- **Duplicate close-comments on auto-triaged PRs** ([#1871](https://github.com/receptron/mulmoclaude/pull/1871), follow-up to [#1869](https://github.com/receptron/mulmoclaude/issues/1869)) — CI no longer double-comments when the auto-triager closes a PR.

### Internal

- **New CI gate — root ↔ launcher deps + plugin peer dep sync** ([#1923](https://github.com/receptron/mulmoclaude/pull/1923)) — every PR that touches `packages/mulmoclaude/package.json`, the root `package.json`, or any plugin's `peerDependencies` runs an auditor with three invariants: (1) root ↔ launcher common deps have identical version ranges, (2) launcher `@mulmoclaude/*` / `@mulmobridge/*` ranges satisfy the workspace source version, (3) bundle-target plugin `peerDependencies` are satisfied by the launcher's pins. The gate catches the exact class of drift that caused #1920.

### Removed

- **Shared-package version-bump CI guard** — the `Shared package version bump` workflow (and its `scripts/check-shared-pkg-bumps.mjs`) required every PR touching a shared `@mulmoclaude/*` package to also bump that package's `version`. In practice this forced every core-touching PR to edit the same `version` line, so any two such PRs raced into a merge conflict on it. The guard is removed; keeping shared packages bumped before publish is now a convention (see CLAUDE.md), not a CI gate. (Reverts the guard added in [#1737](https://github.com/receptron/mulmoclaude/pull/1737) / [#1788](https://github.com/receptron/mulmoclaude/pull/1788).)

### Cascade publishes

- `@mulmoclaude/form-plugin` 0.1.3 → 0.1.4
- `@mulmoclaude/markdown-plugin` 0.1.7 → 0.1.10
- `@mulmoclaude/spotify-plugin` 0.1.0 → 0.1.1
- `@mulmoclaude/email-plugin` 0.1.3 → 0.1.4
- `@mulmoclaude/recipe-book-plugin` 0.1.0 → 0.1.1
- `@mulmoclaude/bookmarks-plugin` 0.1.0 → 0.1.1
- `@mulmoclaude/debug-plugin` 0.2.0 → 0.2.1
- `@mulmoclaude/edgar-plugin` 0.1.1 → 0.1.2

### Known cosmetic issue

- `npx mulmoclaude@0.9.2 --version` prints `mulmoclaude 0.9.1` — the version string was hardcoded in `bin/mulmoclaude.js` and missed the sync bump. All runtime behaviour is correct. [#1925](https://github.com/receptron/mulmoclaude/pull/1925) makes the CLI read the version from `package.json` at runtime; the next release will pick it up.

---

## [0.9.1] - 2026-06-28

Three threads run through this release: **multi-registry collections**, **collection-import path unification**, and **agent self-service troubleshooting**. Plus a stack of UX / i18n polish, the Contribute side of the registry going GA with sanitisation + a confirm dialog + dummy-data prompt + fork flow, custom-view i18n in all 8 locales, accounting plugin self-contained i18n, CJK font fixes for both code blocks and PDFs, the Discover tab landing fully, and a feeds package extraction. The shared `@mulmoclaude/core` ratchets to 0.2.12 with cascade publishes for `bookmarks-plugin`, `recipe-book-plugin`, and `debug-plugin` (initial), plus `collection-plugin` 0.5.16. Workflow: 48 PRs since 0.9.0.

### Added

- **Multi-registry Discover** (#1837) — Discover tab now reads `~/mulmoclaude/config/collections-registries.json` to add custom registries alongside the official one. Each entry: `{ name, indexUrl, rawBaseUrl }`. The Discover cards carry an origin badge so users can tell which registry an entry came from; `previewCollection` and `performImport` accept the registry name to disambiguate collisions. Per-registry cache + stale-on-failure backoff keyed by `(name, indexUrl, rawBaseUrl)`, so editing URLs invalidates the cached index. `docs/collection-registries.md` documents file format + validation rules + per-registry isolation semantics.
- **Curated registry, Discover, and import-as-rename** (#1815 + #1817 + #1818 + #1819) — the official `receptron/mulmoclaude-collections` registry, the `/collections/discover` tab that lists it, server-side import into the workspace's `.claude/skills/`, and rename-on-collision (`movies-2`, `movies-3`, …) with an "Imported as" label.
- **Contribute (registry export) flow** (#1828 + #1830 + #1832 + #1835 + #1845) — Contribute icon on each Installed-tab collection card seeds a new chat with a sanitised template prompt. The agent generates 3-5 synthetic dummy records based on `schema.json` (privacy-safe by default — never copies real user records), builds the contribution bundle, runs `build-index.mjs` + `validate.mjs`, and opens a PR to the registry after user confirmation. A confirm dialog wraps the icon button so a stray click doesn't launch the agent.
- **Field-driven spawn from a record field** (#1820) — collection schema `spawn.every` accepts `{ fromField: "interval" }` so weekly / monthly branches off a record's own dropdown without splitting schemas.
- **Custom-view i18n** (#1842) — the custom-view HTML wrapper threads the host locale through to the sandboxed view via a `<meta name="mulmoclaude:locale">` tag and `document.documentElement.lang`, so views can pick up the user's language at render time.
- **Accounting plugin self-contained i18n** (#1838) — `@mulmoclaude/accounting-plugin` now ships its own 8-locale i18n inside the package instead of borrowing from the host, removing the runtime dependency on host i18n resources.
- **Feeds package extraction** (#1840 + #1843) — feeds engine + schema + paths moved to a dedicated subpath of `@mulmoclaude/core` (`./feeds`, `./feeds/server`, `./feeds/paths`), enabling MulmoTerminal to consume the feeds runtime. Plus shareable feed refresh registration so the same feed can be triggered from multiple surfaces.
- **Agent error-recovery help** (#1846) — new `config/helps/error-recovery.md` indexes the documented fix for common tool failures (gh/git/SSH in the sandbox, Marp PDF, registry import, build/workspace, plugin runtime). The system prompt now points the agent at it BEFORE asking the user a clarifying question on a failed tool call. CLAUDE.md rule mandates appending new diagnostics to that file.
- **Collections export bundle generation** (#1825) — `performExport` produces the `{ SKILL.md, schema.json, meta.json, manifest.json, [seed/items/*] }` bundle that the Contribute flow ships up to the registry, with strict input validation.
- **Imported-collection custom-view fallback** (#1836) — the custom-view file reader falls back to `data/skills/<slug>/views/` for project-source collections, so an imported collection's views render even though the bundle didn't mirror them through skill-bridge.

### Changed

- **Imports write to `data/skills/<slug>/` first** (#1839) — refactor unifies authored and imported collections on disk: both live at `data/skills/<slug>/`, mirrored to `.claude/skills/<slug>/` via the same skill-bridge allowlist (`SKILL.md`, `schema.json`, `templates/<safe>`). `.origin.json` (the imported-vs-authored marker) lives only on the data side. Editing an imported collection is now identical to editing an authored one; `rm -rf data/skills/<slug>/` deletes either kind through the existing bridge hook.
- **Write-then-prune mirror ordering** (#1839 follow-up) — mirror writes happen before pruning stale files, so a transient mirror failure can no longer leave `.claude/skills/<slug>/` empty.
- **Collections Contribute dummy data** (#1835) — replaces the "include my own records as seed?" question with an unconditional "generate 3-5 synthetic dummy records based on `schema.json`". Privacy-safe by default; the published bundle never contains real user data.
- **`packages/mulmoclaude/README.md` refresh** (#1849) — the npm-shown README catches up with the last year of features (collections, Marp, sandbox credentials, full bridges list). Also adds a `/publish-mulmoclaude` skill step to verify the README each release so this doesn't drift again.
- **CJK monospace fonts in code blocks** (#1829) — adds Windows CJK monospace fonts (`MS Gothic`, `BIZ UDGothic`) to the monospace stack across `src/index.css` and 11 plugin View files, plus the JSON editor's CodeMirror theme. Japanese inside code blocks renders correctly on Windows (was tofu). Bumps `@mulmoclaude/html-plugin` and `@mulmoclaude/markdown-plugin` for the shared CSS.
- **CJK fonts in PDF render** (#1826) — adds Hiragino / Yu Gothic / Meiryo / Noto Sans CJK JP fallback to the `MARKDOWN_CSS` body + Marp inline style so PDF exports of Japanese decks render the glyphs.
- **Custom view help — default fields hint** (#1834) — the addView prompt clarifies that referenced fields must exist on the schema before authoring the view.
- **e2e test consolidation** (#1809 + #1812 + #1813) — three audits trimmed redundant specs, consolidated four redundant cases, split two mega-specs.

### Fixed

- **Delete of imported collections** (#1841) — the `isDataDirSafe` guard rejected `data/collections/<slug>/items` (the normalised dataPath for imports) as "outside the per-collection subtree". Now accepts both `data/<slug>/` (authored) and `data/collections/<slug>/` (imported) as valid per-slug subtrees. Imported collections can finally be deleted through the UI.

### Internal

- **Accounting plugin refactor + page** (#1811 + #1816) — accounting moves to `@mulmoclaude/accounting-plugin` with a dedicated `/accounting` page in the toolbar.
- **Plans archive sweep** (#1810) — 25 shipped plans moved under `plans/done/`.
- **CI: cache puppeteer browsers** (#1749) — speeds up the test job.

### Cascade publishes

- `@mulmoclaude/core` 0.2.7 → 0.2.12
- `@mulmoclaude/collection-plugin` 0.5.11 → 0.5.16
- `@mulmoclaude/html-plugin` 0.2.4 → 0.2.5
- `@mulmoclaude/markdown-plugin` 0.1.6 → 0.1.7
- Initial publishes: `@mulmoclaude/bookmarks-plugin@0.1.0`, `@mulmoclaude/debug-plugin@0.2.0`, `@mulmoclaude/recipe-book-plugin@0.1.0`

---

## [0.9.0] - 2026-06-25

Three things shape this release: **local voice input** (push-to-talk via on-device `whisper.cpp`, macOS first); a wave of **collection runtime power** (custom views can open records in a host modal *and* start chats with seed prompts referencing a specific record, live view updates over pubsub, field-driven spawn intervals, `manageCollection` schema management); and the **plugin-extraction sweep** that lifts the entire `presentCollection`, `presentHtml`, `presentForm`, `presentDocument` (markdown / marp), `presentChart`, and X-tools surfaces — server core, Vue View / Preview, 8-locale i18n — into standalone npm packages so MulmoTerminal can run them end-to-end with no MulmoClaude code reuse. A separate `packages/services/*` tree carves out headless-backend services on the same logic. Whisper input also lands as a shared `@mulmoclaude/whisper`. Side dishes: 16-connector claude.ai allowlist, a critical MCP handlePermission race fix that could lose the first turn of a fresh session, Windows `claude.exe` spawn, Docker broker path, attachment traversal hardening, vite pinned to 8.0.13 to dodge a dual-runtime e2e crash, CI dev-server pre-warming, Playwright/puppeteer browser caches, and the `mc-zenn` preset skill.

### Added
- **Local voice input — push-to-talk via on-device `whisper.cpp`** (#1773 + #1775) — toggle the mic icon in chat input, hold to talk, release to send. Audio is streamed to a sidecar `whisper.cpp` process bundled with the launcher, so transcription stays on-device (no cloud STT). macOS is the first-class target. Sticky session mic with auto-resume each turn, pause-based segmentation, single-flight guard on mic start, residual-duplicate-sidecar guard, in-memory armed-mic reset on session change. Extracted as the shared `@mulmoclaude/whisper` package (also published at 0.1.2) so MulmoTerminal can reuse the same core; the launcher declares it as a dependency instead of carrying the sidecar code inline. Model validation, graceful shutdown, stale-error handling live in the package.
- **Pre-allowlist 16 additional claude.ai connectors** (#1711) — agent-side pre-allowlist expansion covering the new connectors the user can configure in claude.ai (Gmail, Drive, Calendar, Slack, GitHub, Linear, Notion, Asana, Atlassian, etc.). Removes the per-connector approval friction on first use.
- **Collection custom views can open records in the host modal** (#1748) — a custom view button can now navigate the host into the same record-detail modal the table/calendar uses (instead of being limited to in-iframe rendering). The view dispatches `openItem` and the host pops the modal.
- **Collection custom views can start a draft chat with a seed prompt** (#1752) — a button can dispatch `startChat` with a templated body referencing the record, and the host opens a new draft chat in a chosen role with that seed text. Composable with the open-item view (#1755) — open a record, kick off a chat about *that specific record*.
- **Field-driven spawn interval** (#1738) — collection schema `spawn.every` can now read its interval from a record field (`every.fromField` + `map`), so a single recurrence definition handles "weekly / biweekly / monthly" branching off a record's own dropdown rather than splitting into separate schemas.
- **Live view updates via pubsub** (#1740) — built-in `table` / `calendar` and **custom views** now subscribe to a per-collection pubsub channel, so a record change from any tab / session / agent ticks instantly into the open view. Removes the "edit in chat, switch to view, no update until refresh" surprise.
- **`manageCollection` schema management** (#1734) — extends the MCP tool with `schemaDocs` / `getSchema` / `putSchema` actions so Claude edits collection schemas through a validated surface instead of raw file writes. Wired through `@mulmoclaude/workspace-setup@0.1.2`'s `collection-skills.md` help doc.
- **Collection chat about a specific record** (#1755) — open-item flow has a "chat about this" affordance that drafts a chat seeded with the record's contents, in the role you pick. Pairs with #1752 to close the "I'm in a collection, talk to me about this row" loop.
- **Collection instant-present** (#1785) — when a slash-command chat references a collection, the collection's canvas card now appears **instantly** on the chat draft path (before the agent finishes its first round), not after. Includes a synthetic-seed guard against a fast-agent race when the synth-seed arrives while the agent is still booting.
- **`mc-zenn` preset skill** (#1786) — bundled `mc-*` preset to publish work as a [Zenn](https://zenn.dev/) article (Japanese dev-blog). Discover via the skills launcher. Ships in `@mulmoclaude/workspace-setup@0.1.8`.
- **Headless-backend `packages/services/*` carve-out** (#1733) — services that don't need the Vite frontend (collection-watchers, scheduler, journal, notifier, plugin-host, skill-bridge, whisper, workspace-setup) move to a sibling `packages/services/*` workspace tree with its own `tsconfig.packages.json` entry + CI cache key. Independent versioning, independent publishing, no implicit coupling to the launcher.

### Plugin extraction (NEW shared packages)
- **`@mulmoclaude/form-plugin`** (#1713) — `presentForm` tool's schema + execute logic extracted into a MulmoTerminal-consumable package. MulmoClaude host shrinks to a thin adapter.
- **`@mulmoclaude/markdown-plugin@0.1.0 → 0.1.4`** (#1715 + #1717 + #1719) — `presentDocument` extraction. **0.1.0**: server core. **0.1.2**: shared `renderMarp` + image-fill render core. **0.1.4**: Marp directive slides emit a title-prompt image generation request so the slide isn't left blank when the directive doesn't pre-supply an asset.
- **`@mulmoclaude/x-plugin` + `@mulmoclaude/chart-plugin`** (#1721) — X tools + `presentChart` extraction into shared packages. Both follow the chart-plugin / form-plugin server-then-Vue extraction pattern.
- **`@mulmoclaude/html-plugin@0.1.0 → 0.2.2`** (#1731 + #1732) — NEW shared package for the `presentHtml` tool. **0.1.0**: server-core (schema + save/validate against the generic gui-chat-protocol `files.artifacts` capability). **0.2.0**: Vue View / Preview + `./style.css` move into the package's `./vue` entry, MulmoClaude's `src/plugins/presentHtml/` loses 449 lines, i18n keys move into the package's own 8 locales. **0.2.1 / 0.2.2**: review hardening — `previewUrl ?? htmlArtifactPreviewUrl(filePath)` fallback for the PDF print button, `path`/`html` string validation in `executeHtmlDispatch`, `..` / empty-segment rejection in `htmlArtifactPreviewUrl`.
- **`@mulmoclaude/collection-plugin@0.3.0 → 0.5.2`** (#1723, #1725, #1729, #1730) — extraction sweep. **0.3.0** (#1723 Phase 1 + #1725 Phase 2 first pass): six View components move into the package's `./vue` entry behind `configureCollectionUi()`. **0.4.0** (#1729): extraction COMPLETE — every View component (incl. `CollectionView`, record / config / custom-view modals, `CollectionsIndexView` / `FeedsView` index pages) plus a self-contained vue-i18n instance (all 8 locales) live in the package. **0.4.1**: missing `common.close` key + locale-sync hardening. **0.5.0** (#1730): consumable by a router-less host — refs / file cell links + record modal teleport go through host bindings instead of `<router-link>` / `body` teleport. **0.5.1**: keyboard a11y + `navigate`-absent guard on those host-bound links. **0.5.2**: record ids accept interior dots (new `safeRecordId`) — natural keys like a Slack ts (`1718900000.123456`) or a SemVer (`1.2.3`) are addressable via `manageCollection` (#1735); `..`, path separators, leading / trailing dots stay rejected.
- **`@mulmoclaude/collection-watchers@0.1.1`** — `trigger date unparseable` now warns only for a present-but-malformed value; absent/empty optional trigger date is silent instead of logging a WARN every reconcile tick.
- **`@mulmoclaude/workspace-setup@0.1.2 → 0.1.8`** — bundles the new `mc-zenn` preset; `collection-skills.md` help doc steers schema edits through `manageCollection` `schemaDocs` / `getSchema` / `putSchema` instead of raw file edits, and documents the record-id charset rule referencing `safeRecordId` as the single source of truth.

### Changed
- **`mulmocast 2.6.22`** — diagnostic-error sweep from receptron/mulmocast-cli #1452-#1457 + #1459 picks up. TTS Gemini no longer masks ffmpeg SIGABRT as `"TTS Gemini Error"`; Whisper CLI splits ffmpeg / OpenAI / fs into 3 phases; Replicate image / lipsync / movie + OpenAI image + TTS ElevenLabs agents now interpolate `error.message` into catch-all throws so the underlying provider message reaches mulmoclaude server logs instead of a generic opaque label (the original `error="TTS Gemini Error"` report at mulmocast-cli #1451 motivated this).
- **e2e dev-server pre-warming** — Playwright's `globalSetup` now warms the Vite dev server before any test starts so the first `page.goto` doesn't pay the on-demand compile penalty and the e2e `(1)` / `(2)` shards stop occasionally timing out on the first navigation.
- **`tsconfig.json` `types: ["vite/client", "node"]`** — adds `"node"` so `vue-tsc` resolves the `node:*` imports in `src/lib/wiki-page/*` (Node-only files that happen to live under `src/`). Unblocks the lint_test typecheck step on lockfile-only PRs.
- **gui-chat-plugin minor bumps** (#1780 / #1781 / #1782) — `@gui-chat-plugin/browse@0.5.0`, `@gui-chat-plugin/google-map@0.6.0`, and friends; included via the rolling dep-update PRs.
- **`puppeteer-core@25.2.1`** (#1783), **`undici@7.28.0`** (#1753), dependabot bumps for `hono@4.12.25` (#1716), `nodemailer@9.0.1` (#1726), `dompurify@3.4.11` (#1727), and other routine refreshes (#1714 / #1736 / #1741 / #1778 / #1787).
- **CI bump guard** (#1737 + #1788) — a CI guard script blocks PRs that change a shared package's `src/` but forget to bump its `version`. #1788 exempts non-shipping `package.json` diffs from the guard so doc-only or comment-only `package.json` changes don't require a version bump.

### Fixed
- **MCP `handlePermission` race could lose the first turn of a fresh session** (#1712 / #1698) — `handlePermission` is now served immediately so session start can't race MCP load. The fresh-session failure mode was: send a message before MCP finished registering tools → the first tool call returned a permission error and the session sat stuck.
- **Windows `claude.exe` spawn** (#1769 / #1757) — cross-platform `claude` CLI resolver via a typed `ClaudeCliNotFoundError`, Windows shell for the spawn probes, `try/catch` around `spawnClaude` to surface the real error, and pnpm global probing made version-agnostic.
- **MCP broker path in Docker** (#1771 / #1770) — broker source path resolves relative to `config.ts` and the same fix applies under Docker bind mounts too.
- **Attachment companion-file traversal** (#1756 + #1760 + #1762 + #1765) — path validator factory + `..` strictness restoration so attachment companion files can't escape their parent dir, with a consolidated `hasTraversalSegment()` shared across the host. Closes a class of issues opened during the chat-input multi-attach work in 0.8.0.
- **Vite pinned to exactly 8.0.13** (#1750) — newer vite 8.x breaks the e2e suite with a dual-runtime crash (`vue-i18n` / `runtime-dom` resolved through two paths). Pinning to 8.0.13 + refreshing committed dispatcher artifacts (#1746) unbreaks main CI.
- **Marp image-fill regression** (#1719) — Marp directive slides without a pre-supplied image left the slide blank instead of emitting a title-prompt image generation request. Markdown-plugin 0.1.4 restores generation.
- **`renderMarpDeck` PDF dimensions test gap** (#1718) — explicit test coverage for the PDF sizing path; drops dead `extractSlideDimensions` along the way.
- **Vue pin dispatcher artifact refresh** (#1746) — main CI was broken because committed dispatcher bundles were stale relative to the vue 3.5.34 resolution; regenerated and committed.
- **`fix-vite-workspace-path`** (#1570) — dev token plugin honours `MULMOCLAUDE_WORKSPACE_PATH` instead of assuming `$HOME/mulmoclaude`.

### Infrastructure
- **Cache Playwright browsers in the e2e job** (#1728) and **cache puppeteer browsers in the test jobs** (#1749) — drops the per-job 60-90s Chrome download to a sub-second cache hit. Also de-flakes against the puppeteer CDN's occasional `End-of-central-directory signature not found` ZIP corruption.
- **Collection View move + UI-context plumbing** (#1729 / #1725) — the host injects collection-aware navigation, modal teleport target, recordHref, and i18n through a single `configureCollectionUi()` binding instead of N separate props. Same pattern the chart/form plugins already use.

### Docs
- **`collections-vibe-crafting-help.md`** (#1758) — new help doc on the iterative "vibe-craft a collection from a sample" workflow. Surfaces collections + custom views as the headline feature.

### Refactor
- **frontend `toError` helper** (#1766) — single helper for `unknown → Error` narrowing on the frontend.
- **`errorMessage` codemod sweep** (#1767) — replaces the inlined `err instanceof Error ? err.message : String(err)` pattern across 12 sites with the shared `errorMessage(err)` helper. No behaviour change.
- **Consolidate `hasTraversalSegment()`** (#1760) and **`makePathValidator()` factory** (#1762) — both feed the attachment traversal fix above.

---

## [0.8.0] - 2026-06-16

Collections graduate from "spreadsheets with bells" into a real DSL platform. The headline change is **custom views** — LLM-authored HTML pages that render alongside the built-in table/calendar, sandboxed in an iframe with the collection's records JSON injected for live filtering, charting, dashboards, even podcast players. A companion **`manageCollection` MCP tool** gives Claude the same affordances the host has — computed-aware reads + schema-validated writes — replacing the previous "Claude writes JSON files directly via Write" pattern. **`spawnBackgroundChat`** lands as a generic parallel-chat primitive that underpins collection-level actions and broader fan-out workflows. Side dishes: per-column sort with localStorage persistence, multi-file attach in the chat input (up to 10), expandable notification bodies, and a fistful of UI / scheduler / CSP fixes.

### Added
- **Custom views for collections** — drop an `views/<slug>.html` (or `.html.tmpl`) under a collection's data folder and a new view picker appears next to table/calendar. The page renders inside a sandbox iframe with the records JSON injected, so vanilla JS / CSS / chart libraries / `<audio>` / `<video>` all work end to end. A view config modal in the CollectionView header lets users reorder, rename, and delete views without leaving the canvas. The (rarely-used) built-in dashboard view is replaced by "author one as a custom view". (#1686, #1687)
- **`manageCollection` MCP tool** — LLM-callable read/write API symmetric to CollectionView. Reads include computed / derived fields; writes go through the same schema validator the UI uses, so a bad record is rejected at call time rather than silently corrupting the data folder. Becomes the canonical way for LLMs to mutate collection records. (#1681)
- **`spawnBackgroundChat` agent primitive** — any tool can now spawn a sibling chat in a different role with a templated seed prompt and get a handle back for status polling. Foundation for the new collection-level actions and broader fan-out workflows (e.g. an invoice action spawning a parallel payment-recording chat). (#1678)
- **Tracked-lessons collection recipe + collection-level actions** — second canonical collection recipe (after invoicing). Demonstrates a *collection-level* action button (vs. the existing per-record kind), the `presentHtml` action target, and the schema-validated write contract end to end. (#1669)
- **Per-column sort in CollectionView's table** — clickable column header cycles ascending → descending → off; the choice persists per (workspace × collection) in localStorage so revisits restore the same order. (#1674, #1677)
- **Multi-file attach in chat input** — paste / drop / file-picker up to 10 attachments per turn (was 1). Each attachment renders in the composer with its own remove button; the send-enabled rule treats text *or* any attachment as a valid send. (#1660)
- **Notification body expansion** — clicking a bell entry now expands its full body (markdown / record snapshot) inline. Faster triage for the daily news brief and collection completion bells. (#1619)

### Changed
- **Dashboard view mode removed** — the fixed, enum-driven dashboard rarely earned its keep; anyone who wants one can now author a custom view tuned to their schema. A persisted `dashboard` value in localStorage falls through to `table` via the existing unknown-mode safety net. All dashboard i18n keys are dropped from the 8 locales. (#1687)
- **CollectionView header shorter** — shaves ~24px off the chrome so on small canvas cards the table body gets more rows visible above the fold without scrolling. (#1689)
- **`MarpSplitEditor` extracted as a shared component** — the marp split-pane editor moves into a reusable component so other markdown surfaces can adopt the same chrome. (#1665)

### Fixed
- **Scheduler state persistence race** — replaced the static `scheduler.tmp` write path with a unique-tmp helper so two scheduler ticks landing in the same millisecond can no longer trample each other's writes (one would publish a half-written JSON). (#1693)
- **CSP blocked audio/video in custom views** — the custom-view CSP omitted `media-src`, so a podcast-feed custom view's `<audio src="https://...mp3">` fell through to `default-src 'none'` and the browser refused to load. Added a `media-src` with the same `https:` + `data:` + `blob:` allowlist as the existing iframe CSP. (#1688)

### Docs / Research
- **"DSLs as Harnesses"** arXiv pre-print — theoretical scaffolding for the collections-as-DSL bet: a DSL can serve as a harness that constrains, validates, and structures an agent's reasoning. CC BY 4.0 + a revision after external review. (#1691, #1692, #1694)
- **"The Workspace Is the Self-Improving Agent"** arXiv pre-print — companion paper framing the workspace + collection corpus as the substrate for "owning the learning loop", from single user up to firm scale. (#1683, #1695, #1696)
- **"Software for an Audience of One"** essay — refines the collections-and-custom-views thesis: applications are data, the schema is the harness, Claude is the runtime. (#1690)
- **Terminal-native chat plan** — design doc for eliminating `claude -p` in favour of a terminal-native chat surface, with permissions also moving terminal-native. (#1697, #1699)

---

## [0.7.0] - 2026-06-10

Three large built-ins move out of the launcher in favour of the schema-driven collections model: **Calendar**, the **Todo plugin**, and the **Encore** recurring-obligation built-in are all removed; their use cases are now expressed as collections (`calendarField` for dated items, `config/helps/todo-collection.md` for todo lists, `triggerField` + `spawn` for recurring obligations). The bundled **invoicing suite** moves the same way — from preset skills to on-demand help-file recipes. No data is deleted; the records on disk are left in place.

### Changed
- The **invoicing suite** (`clients`, `worklog`, `invoice`, `profile`) moved from bundled `mc-*` preset skills to on-demand **help-file recipes** (`config/helps/billing-clients-worklog.md` + `config/helps/billing-invoice.md`), discoverable via two Personal-role sample prompts ("Set up client and time tracking…", "Set up invoicing…"). New workspaces no longer carry the four presets in the skill catalog; the recipes scaffold bare-slug collections (`/collections/invoice`, etc.) over the same prefix-free `data/*/items` record folders. On launch, any lingering starred `mc-{clients,worklog,invoice,profile}` skill is **removed** from `.claude/skills/` (records under `data/*/items` are left untouched), and a one-time bell explains the change — re-running a recipe re-attaches to the same data, so existing records reappear. No data is ever deleted.

### Removed
- The standalone **Calendar view** and the **`manageCalendar`** tool have been removed. Dated items are now modelled as schema-driven collections with a `calendarField` (the collection-native calendar view) — see `config/helps/collection-skills.md`. The `/calendar` launcher button, the `/calendar` route (now redirects to `/automations`), and the `data/scheduler/items.json` file-preview special case are gone. **Automations is unaffected** — `manageAutomations`, the `/automations` view, the `/api/scheduler` routes, and the task-manager all keep working (automations now owns the shared scheduler API namespace). Existing `data/scheduler/items.json` is left in place on disk.
- The **Todo plugin** (`@mulmoclaude/todo-plugin`, the `manageTodoList` tool, the `/todos` route, and the `TodoExplorer` kanban / table / list view) has been removed. Todo lists are now built as schema-driven collections via the `config/helps/todo-collection.md` recipe (status enum + `done` toggle + priority bells), which is the canonical replacement. Existing todo-plugin data (`data/plugins/%40mulmoclaude%2Ftodo-plugin/todos.json`) is left in place on disk and is **not** migrated automatically — re-author the list as a collection following the recipe.
- The **Encore** built-in (recurring-obligation DSL, hourly tick, dashboard, `defineEncore` / `manageEncore` tools, `/encore` route) has been removed. Collections now covers recurring obligations via time-driven bells (`triggerField` / `triggerLeadDays`) and host-driven recurrence (`spawn`); the only Encore-unique capability left was graduated multi-phase severity escalation, which did not justify maintaining a second time-driven harness.

---

## [0.6.5] - 2026-05-26

Fixes a production regression where `npx mulmoclaude@latest` failed to load the ToDo and Spotify runtime plugins (e.g. "ToDo の読み込みに失敗しました" on first launch) because the published tarball did not ship them. They now travel with `mulmoclaude` as regular npm dependencies, so a fresh `npx` install boots with ToDo and Spotify available out of the box. Other runtime plugins (`debug`, `edgar`) stay dev-only by design and no longer log misleading `preset package not resolvable` warns in production.

### Fixed
- `npx mulmoclaude` no longer fails to mount ToDo / Spotify on first launch — `@mulmoclaude/todo-plugin@^0.1.0` and `@mulmoclaude/spotify-plugin@^0.1.0` are now real npm dependencies of `mulmoclaude` (#1513, #1515).
- Preset loader downgrades the missing-package log to `debug` for entries flagged `devOnly: true`, so legitimately dev-only presets stop scaring production users (#1513).

### Added
- Two new published npm packages backing the runtime plugins:
  - [`@mulmoclaude/todo-plugin@0.1.0`](https://www.npmjs.com/package/@mulmoclaude/todo-plugin/v/0.1.0)
  - [`@mulmoclaude/spotify-plugin@0.1.0`](https://www.npmjs.com/package/@mulmoclaude/spotify-plugin/v/0.1.0)

---

## [0.6.4] - 2026-05-20

Four-day patch focused on a new **Encore** built-in (cycle-state planning + bell-reconciled todos), a **CodeMirror-based inline JSON editor** for workspace configs, **Docker-aware MCP catalog with stdio→HTTP shim** (so stdio-only MCP servers run inside the sandbox), and a **role split** that pulls personal-assistant workflows out of `General` into a dedicated `Personal` role. Plus the system-prompt build path was rearchitected (literals out to files, helps-injection deleted, topic-memory context index-only) and a handful of UI polish wins (srcset rewriter, app version in Settings, notification-history collapse, TODO kanban done-column menu).

### Highlights

#### Encore — cycle-state planning + bell-reconciled todos
- New **`/encore` dashboard page** with an icon-only top-bar entry, backed by an Encore built-in plugin (#1427, #1443).
- Split **structural `defineEncore`** (one-shot schema definition) from **operational `manageEncore`** (ongoing ticket ops) so the LLM can't confuse the two (#1437).
- Single-reconciler bell-state model with **unsnooze**, timezone-correct triggers, directory hygiene, ticket-rename support, and ghost-ticket rescue (#1433, #1440, #1441).

#### CodeMirror-based inline JSON editor (#833 Phase 1)
- Workspace JSON configs now open in an in-page editor (Files view, #1418).
- Lazy-loaded CodeMirror 6 backend with syntax-aware editing replaces the textarea (#1450, #1448).

#### MCP catalog becomes transport-aware (#1421)
- Docker-only stdio MCPs get a clear **"this won't run inside the sandbox"** note in the catalog; GitHub MCP now points at the HTTP transport (#1422).
- Opt-in **stdio→HTTP shim** lets stdio-only MCP servers run inside the Docker sandbox via a side-process bridge — covers the previous gap (#1436).

#### Role split — General + Personal (#1430)
- `General` is split into a lean `General` (research / coding) and a new **`Personal`** role (memory, journal, calendar, TODO, photos). Encore's seed role is pinned to Personal.
- Roles now rely directly on the per-role prompt files; the old `helps`-injection layer is deleted (#1431).

#### Wiki / image / UI polish
- `<img>` / `<source>` **`srcset` rewriter** in both wiki and PDF surfaces (#1407, closes #1275).
- Wiki external/workspace markdown links restyled for clarity (#1453).
- TODO kanban **done-column menu** with check icon and click-outside dismiss (#1452); plugin-seeded first turns render as a **skill-style card** (#1447).
- Settings modal shows the **app version** (#1412, closes #1410).
- NotificationBell **collapses history beyond 5 rows** behind a toggle (#1439); notifier gains an **update op + action-style priority alerts** for todos (#1451).

#### Skill catalog UX
- Add-repo flow now offers **fill-form suggestions**, repo link, and expandable description for each preset (#1415, closes #1413).

### Added
- **Encore** built-in: dashboard page, `defineEncore` / `manageEncore` tools, unified bell reconciler with unsnooze (#1427, #1437, #1433, #1443).
- CodeMirror 6 JSON editor for workspace files (#1418, #1450).
- MCP transport-aware catalog + stdio→HTTP shim (#1421 / #1422 / #1436).
- New `Personal` role split off from `General` (#1430).
- Skill add-repo suggestions UX (#1415, closes #1413).
- `srcset` rewriting on `<img>` / `<source>` for wiki + PDF (#1407, closes #1275).
- App version surfaced in Settings (#1412).
- NotificationBell history collapse + notifier update op / priority alerts (#1439, #1451).
- TODO kanban done-column menu polish (#1452).
- Plugin-seeded text-response renders as a skill-style card (#1447).

### Changed
- System prompt internals refactored: static literals extracted to `server/prompts/`, `helps`-injection deleted, topic-memory context is index-only, dead readLegacyMemoryFile / buildWikiContext branches removed (#1425, #1431, #1434, #1435).
- Wiki external-link styling distinguishes workspace vs external (#1453).
- `Skill` tool added to the agent allowlist so user-installed `.claude/skills/` are invokable (#1445).
- Built hook dispatcher relocated to `server/build/`, sourcemap dropped (#1449).

### Fixed
- `optionalDeps` notification title/body wording (#1429).
- e2e-live `L-ERR` / `L-15b` flakiness on real-Claude runs (#1446).
- `publish smoke` Puppeteer Chromium download + plugin-probe race (#1442, #1428).
- Encore review P0s + form-schema validation LLM-trap (#1441).
- Skill `flex-1` restored after StackView selector was scoped (#1408, follow-up to #1277).
- Playwright browsers auto-installed via the test script chain (#1411).

### Security
- Opt-in stdio→HTTP shim (#1436) lets stdio MCP servers run inside the Docker sandbox via a bridged HTTP transport, closing a gap where catalog entries were silently host-only.

---

## [0.6.3] - 2026-05-16

Three-day patch centred on the **external skill catalog** (a multi-PR `#1383` / `#1335` track), an **MCP reliability trio**, and **graceful degradation when optional host tools are missing**. Skills are now browsable / star-able / preview-able from a hierarchical catalog that can pull from external Git repos. MCP servers get boot-time preflight, a runtime failure monitor, and catalog-derived error hints. Missing `ffmpeg` / `docker` no longer crash startup — the app degrades and tells you which features are off.

### Highlights

#### External skill catalog (#1383 / #1335)
- Skills are split into **catalog** (browsable, not in the system prompt) vs **active** (loaded). Star to activate; Preview and Run-once before committing.
- Catalog can pull skills from **external Git repos** (backend C1, hierarchical UI C2, per-repo Update button C3). Recommended presets seeded, including `obra/superpowers`.
- `/skills` legend now shows inline category icons; nested preset scanning.

#### MCP reliability trio
- **Boot-time preflight (#1352)** — catalog-backed MCP servers with missing required config are skipped with a warning instead of spawning a subprocess that fails every call silently.
- **Runtime failure monitor (#1353)** — a server that fails repeatedly raises a bell notification.
- **Error hint chip (#1354)** — MCP tool errors in the right sidebar carry a catalog-derived "how to fix" hint.

#### Graceful degradation for optional host dependencies (#1385)
- Missing `ffmpeg` / `docker` / other optional host tools degrade gracefully (clear notification + affected-feature list) instead of hard-exiting at startup.
- New `--disable-sandbox` flag plus bundled boolean CLI flags (#1089 / #1397).

#### Multi-day calendar events (#1368)
- Calendar now renders events that span multiple days.

#### Role-aware empty state
- A fresh chat shows clickable starter queries tailored to the active role.

#### Investor role gains X (Twitter) access
- `searchX` / `readXPost` added to the Investor role.

### Added
- External skill catalog: catalog/active split, Star, Preview, Run-once, external Git repo install + update (#1383, #1335).
- MCP boot preflight (#1352), runtime failure monitor (#1353), error-hint chip (#1354).
- Optional-dependency graceful degradation + `--disable-sandbox` / bundled boolean CLI flags (#1385, #1089, #1397).
- Multi-day calendar events (#1368).
- Role-aware empty state with clickable starter queries.
- `searchX` / `readXPost` for the Investor role.
- `liveIsRunning` session predicate (#1195).
- Scheduled Claude-free e2e-live workflow (daily 03:00 JST) + expanded fake-echo scenario coverage.

### Changed
- Dropped `?result=` URL persistence — sessions default to the latest result on load.
- `helps` model names aligned with the `presentMulmoScript` canonical structure (#1009).
- `auth-token` persistence across server restarts documented (#1351); ffmpeg prerequisite documented.

### Fixed
- `presentMulmoScript`: silent beats now advance by duration during Play (#1073); inline error chip + retry on movie-generation failure (#1197).
- `StackView`: `flex-1` neutralisation scoped to vertical flex only (#1277).
- CodeRabbit sweep follow-up — starter-query key collision, magic-number / hardcoded-path cleanup, and a pre-existing `@types/which` typecheck break on `main` (#1379 / #1364 / #1371).

### Security
- MCP boot preflight (#1352) stops half-configured catalog servers from spawning subprocesses that would otherwise fail every tool call silently (401 / missing-credentials), reducing the chance of a misconfigured server being mistaken for a working one.

---

## [0.6.2] - 2026-05-13

Three-day patch focused on **Settings UX**, **agent control surface**, and **bridge security hardening**. The Settings modal is now a grouped sidebar (4 categories) and exposes a new **Model** tab for tuning Claude's reasoning effort. New built-in plugins (`presentSVG`, `edgar`) and an **Investor** role land alongside a re-shaped preset-skill system (`mc-settings`, `mc-cooking-coach`). All 6 webhook bridges grow rate limiting + trust-proxy hardening, and several reflected-XSS paths are closed.

### Highlights

#### Configurable reasoning effort (#1320 / #1323)
- New **Model** tab in Settings exposes the `claude --effort` level (`low` / `medium` / `high` / `xhigh` / `max`). Persisted under `<workspace>/config/settings.json`; unset → Claude's default. Settings reload per-run, so the change applies on the next message without restart.

#### Settings menu reorganised (#1333)
- The horizontal tab strip is now a **grouped left sidebar** (LLM / Servers / Workspace / Plugins). Modal grows from 36rem to 52rem but caps at 95vw on smaller viewports. Existing `data-testid` selectors preserved — no e2e breakage. Active item carries `aria-current="page"`; nav label is fully translated.

#### File drop on the chat panel (#1289)
- Drag-and-drop now lights up the entire chat panel (was: just the input), with a clear visual affordance. The window default guard prevents the browser from navigating away when the drop lands outside the panel.

#### EDGAR + SEC built-in plugin
- New `edgar` plugin (server-only — no Views) gives the agent direct access to SEC EDGAR filings. Bundled into a new **Investor** role alongside Yahoo Finance instructions.

#### presentSVG plugin
- New built-in plugin renders generated SVGs as inline canvas surfaces. Roles can opt in via `availablePlugins`.

#### Preset skills replace fixed roles
- `cookingCoach` role → `mc-cooking-coach` preset skill (#1286). `settings` role → `mc-settings` preset skill (#1283), then split into 3 focused skills. Preset skills are user-editable and version-controllable; fixed roles aren't.

#### Agent permission scaffolding
- Workspace-scoped allow rules are now provisioned at server startup, so first-run permission prompts no longer block routine tool invocations.

### Added
- `effortLevel` field in app settings + `--effort` CLI plumbing (#1323).
- Settings **Model** + **Sidebar** UI; nav `aria-label` localised across all 8 locales.
- `presentSVG` and `edgar` built-in plugins.
- `Investor` role with EDGAR + Yahoo Finance instructions.
- Preset skills: `mc-settings` (3 focused subskills) and `mc-cooking-coach`.
- Workspace-scoped agent permission provisioning at startup.
- File-drop visual affordance + chat-panel-wide drop target (#1289 Step 1 + Step 2).
- `docs/shared-utils.md` catalog + CLAUDE.md guardrail (#1304).
- Stdio-MCP-under-Docker warning surfaced in the MCP settings UI (#1334).

### Changed
- Settings modal: top tabs → sidebar with 4 groups (#1333).
- Accounting amount formatting consolidated into one helper (#1308).
- Date formatting in plugin Views routed through `src/utils/format/date.ts` (#1307).
- `truncate()` callsites consolidated into `server/utils/text.ts` (#1306).
- Inline error normalisation migrated to `errorMessage()` helper (#1305).
- New shared `formatBytes()` helper (#1309).
- Wiki bullet `[[slug|display]]` rows now share the same parser as inline wiki links.
- DOM-pure wiki-page helpers relocated under `src/lib/wiki-page/` (#1297).
- `uuid` bumped to 14.0.0.

### Fixed
- pdf.ts: switched to `waitUntil: "load"` for Puppeteer 24 type compatibility.
- wiki: score-based fuzzy resolve replaces iteration-order matching (#1194).
- chat: generated-file references in LLM replies now linkify reliably (#1300).
- pdf responses: skip Content-Security-Policy header (#1299).
- chatinput: drop overlay clears on window-boundary `dragleave` (#1327 follow-up).
- Docker sandbox: stdio MCP entries are dropped (they can't run inside the minimal image — #1334).
- runtime-plugin: HEAD probes on plugin assets bypass bearer auth.
- hooks: atomic mirror write + API_ROUTES constant in tests.
- Codex/Sourcery follow-ups across #1316, #1318, #1325, #1326, #1328, #1331.

### Security
- All 6 webhook bridges: express-rate-limit added on POST + `env`-driven trust-proxy.
- Bridges: `hub.challenge` echoed as `text/plain` with whitelisted shape (CodeQL `js/reflected-xss`).
- wiki: HTML-escape target + display in `renderWikiLinks` (XSS).
- `keyGenerator` routed through `ipKeyGenerator` for IPv6-safe rate-limit keys.

---

## [0.6.1] - 2026-05-10

Two-day patch with several visible additions: a **wiki-syntax embed** family (`[[amazon:...]]`, `[[isbn:...]]`, `[[youtube:...]]`) usable across every markdown surface, **photo location capture** that pulls lat/lng from EXIF on every saved/forwarded image, and the **Map plugin** wired up to `@gui-chat-plugin/google-map`. Notifications fired by the `notify` MCP tool inside a chat now carry a click target back to the source session.

### Highlights

#### Wiki-syntax embeds (#1221)
- Author markdown can now write `[[amazon:B00ICN066A]]`, `[[isbn:9780062316097]]`, or `[[youtube:dQw4w9WgXcQ]]` instead of raw URLs and get a clickable card / link / inline player. The renderer is registry-driven so future prefixes plug in cleanly.
- **YouTube** plays inline via `youtube-nocookie.com` (no profile cookies until click), wrapped in a 16:9 box. **Amazon** shows the product cover thumbnail and links to the user's locale-appropriate storefront (`amazon.co.jp` for `ja`, `amazon.de` for `de`, …, falls back to `.com`). **ISBN** links to OpenLibrary.
- External markdown links across wiki / files / chat artifact / sources / skill body now open in a new tab on click instead of being dead-clicks.

#### Photo locations (#1222)
- Every photo MulmoClaude saves (chat attachments, bridge-forwarded images, file uploads) now has its EXIF parsed: lat/lng + timestamp + camera + lens captured into a sidecar JSON under `data/photo-locations/`. HEIC / HEIF / TIFF supported alongside JPEG.
- New built-in `managePhotoLocations` plugin lets the agent and user list / search / open photos by date, place, or camera.
- Photos tab in Settings exposes the auto-capture toggle.
- LINE bridge now forwards inbound image messages to the agent for the same processing.

#### Map plugin (#1227)
- Integrated `@gui-chat-plugin/google-map@0.4.0`. Add a Google Maps API key under Settings → Map and the agent can show locations, add markers, find places, and request directions inline in the chat canvas.
- Available in `general` / `guide` / `debug` roles.

#### Notifications open the source chat (#1262)
- When the `notify` MCP tool fires from inside a chat session (typically a scheduled background chat reporting completion), the bell entry now carries a navigate target. Clicking opens that chat session instead of just dismissing.

### Added
- `[[amazon:...]]` / `[[isbn:...]]` / `[[youtube:...]]` wiki-embed renderers + extension registry (#1252 / #1261 / #1265 / #1269).
- `managePhotoLocations` built-in plugin + Photos settings tab (#1247 / #1250 / #1251).
- Map plugin wiring + Settings → Map tab + role enablement (#1241 / #1255 / `4c5b3e1`).
- LINE bridge: inbound photo forwarding (#1264, `b3aab94`).
- `notify` MCP tool: chat-session linkback via `navigateTarget` (#1262).
- Plan files for #1221, #1222, #1244, and Encore Phase 2 (DSL + compiler + runtime architecture).

### Changed
- Runtime plugins relocated from `packages/<name>-plugin/` to `packages/plugins/<name>-plugin/` for a cleaner monorepo layout (#1242). No npm package names change.
- `marked` config: external links inject `target="_blank" rel="noopener noreferrer"` automatically — wired into all 6 markdown / sheet renderers (#1252).
- Roles now gate runtime plugins by `availablePlugins` (#1266); previously runtime plugins were universally exposed regardless of role.
- DOMPurify call sites for skill body / manageSkills / sources description now go through a shared `sanitizeMarkdownHtml` wrapper that selectively allows YouTube embeds while keeping every other iframe stripped.

### Fixed
- StackView no longer over-grows iframes on remeasure or in stack layout — postMessage height path now caps at the viewport (`a2017c4` / `0ae82df` / `5817790` / `4aa6461`).
- Map plugin: `googleMapKey` flows through StackView; View force-remounts when the key transitions null → set; key gated to `mapControl` only so other plugins can't read it (`f45067c` / `894ef3c` / `79a7cbf` / `1b04a34`).
- presentMulmoScript: beat edits now persist across page reload + in-SPA nav (#1074, `adcca77` / `7dc74b0`).
- Workspace links: percent-encoded image self-repair + multibyte URL routing fixed (#1102, `b8899fb` / `c8b14e0`).
- Photo EXIF: lat/lng rescue path covers more vendor variants; HEIC/HEIF/TIFF registered for capture (#1222, `8c9aea7`).
- mulmoclaude launcher deps: `@gui-chat-plugin/google-map` and `exifr` declared so the published tarball boots (`c798a20` / `5e17513`).
- CI cache path now includes `packages/plugins/*/dist` after the workspace move (`830a5145`).

### Security
- DOMPurify wrapper enforces a strict allowlist for iframes — only `https://www.youtube-nocookie.com/embed/<11-char-id>` survives the hook; foreign hosts and the cookie-tracking `youtube.com` host are stripped.
- Map plugin: `googleMapKey` only reaches the `mapControl` plugin; other plugins receive `null` (`1b04a34`).

---

## [0.6.0] - 2026-05-08

A two-week release. The themes: a usable **Accounting plugin**, the start of the **personal-use plugin sets** (recipe-book, reading-list / articles / quotes, map), a **Memory system** with proactive recall and edit UI, the **Notifier (Encore) prototype**, the **Spotify plugin**, **MulmoScript** quality-of-life polish, and a swarm of dev-experience wins.

### Highlights

- **Accounting plugin** — bookkeeping with batch journal entry, invoice-system T-number handling, BS/PL shortcuts, time-series view, account naming with codes, dedicated Accounting role.
- **Memory system** — proactive recall during turns + in-app edit UI for memory entries.
- **Personal-use plugin sets begin shipping** — recipe-book (Cooking Coach PR-A), reading-list / articles / quotes (My Library PR-A/B/C), map plugin scaffold. Roadmap in #1169.
- **Skill body collapsed in canvas** (#1220) — invoking a skill shows a card (name + description), expandable to the full markdown body. No more wall-of-text in the canvas.
- **Spotify plugin** — OAuth + listening data + search + player controls.
- **Notifier (Encore) prototype** — early cross-channel notification surface.
- **MulmoScript polish** — lightbox toolbar (#918), background-movie load (#888 / #889), General role can author MulmoScripts (#887).
- **MCP catalog expansion** — Spotify, YouTube, GitHub, Linear, Google OAuth presets out of the box (#867 / #868 / #869 / #872 / #873).

### Added

- **Wiki edits show inline in chat** (#989) — when the LLM `Write`s/`Edit`s a `data/wiki/pages/*.md`, the canvas renders the page automatically from the snapshot taken at that exact moment.
- **Wiki page history UI** (#917 / #946) — browse a page's edit history and roll back.
- **`presentHtml` becomes editable** (#988 / #1001 / #982) — the agent can iteratively edit a generated HTML doc instead of regenerating from scratch.
- **Copy chat as Markdown** (#1065) — one-click copy of the whole conversation.
- **Skills tab in suggestions** (#886) — invoke saved skills from the suggestions panel.
- **Today's journal shortcut** (#879) — sidebar shortcut to today's journal entry.
- **Session bookmark + delete** (#953) — pin or remove sessions from the sidebar.
- **Bridge skill shortcut** (#967) — bridge messages starting with `/<slash>` route to the matching saved skill, so phone-side users can invoke skills with one keystroke.
- **`tool_result` payloads carry an `artifactPath`** field (#983) — cards link directly to the underlying file.
- **Image rendering unified across PDF, presentHtml, and the chat canvas** (#969 / #972 / #974) — workspace-relative `![]()` references resolve consistently everywhere.
- **Translation service** for role queries (#1172 / #1173).
- **`/debug` page** (#1192) and dev-mode debug role (#1186), gated on `VITE_DEV_MODE=1`.
- **`create-mulmoclaude-plugin` CLI** (#1163) — scaffolder for new runtime plugins.
- **Preset skills** shipped with the launcher (#1211).
- **Plugin error boundary** (#1147) — when a plugin crashes, the canvas shows a fallback card instead of breaking the whole pane.
- **Tool-call history persists across reloads** (#1101) — the right-sidebar history pane reconstructs from the session JSONL.

### Changed

- **`manageWiki` MCP tool removed** — wiki edits auto-render via Write/Edit. Browse / lint flows direct the user at the `/wiki` UI. View-only `PluginEntry` retained so historical sessions still render their `manageWiki` cards (#989).
- **Todo plugin migrated to `packages/todo-plugin/`** runtime-plugin shape; existing `~/mulmoclaude/data/todos/{todos,columns}.json` auto-migrates on first launch (#1149).
- **`yarn dev` skip-if-fresh package build** (#1208) — cold-restart 8.5s → 0.04s when source is unchanged.
- **`yarn package`** one-liner builds a publishable `mulmoclaude-X.Y.Z.tgz` with stale-tarball cleanup (#1230).
- **MCP server presets** — Spotify / YouTube / GitHub / Linear / Google OAuth available without manual registration (#867 / #868 / #869 / #872 / #873).
- **Atomic writes v2** (#885 / #890) — workspace files (wiki pages, journal, todos, …) write via tmp-and-rename so a kill -9 mid-save can't leave a half-written file.
- **`gui-chat-protocol` bumped to 0.3.0** (#1123) → 0.3.2 mid-cycle (typed runtime endpoints).
- **`zod` v4** for built-in plugins (#1204).

### Fixed

- **Sandbox mode silently disabled in published npm package** — `Dockerfile.sandbox` and `sandbox-entrypoint.sh` are now bundled (carried over from 0.5.3 with extra tarball asserts).
- **`presentHtml` iframe height** (#1228) — long HTML docs scroll naturally instead of clipping at the pane bottom.
- **`presentHtml` Safari CSP** (#991) — Safari's inline bootstrap scripts no longer blocked.
- **`/files` HTML preview relative paths** (#980), **`artifacts/html` sibling images resolve** (#981).
- **Wiki page-edit publish failure no longer 500s** the snapshot route — the snapshot is already on disk; a publish error logs a warning instead of failing the response.
- **Notifier validation + emit safety** (#1199 / #1223).
- **Chat attachment leak** (#1069) — attachment uploads no longer carry over between chats.

### Security

- **Strict data gating** for plugin scope roots (#1181) — plugins can only read/write inside their scoped data directory; lexical traversal checks prevent `..` escapes.

### Breaking Changes

- **`manageWiki` MCP tool definition removed** (#989). Custom roles listing it still load (lenient zod parse silently drops the name) but the LLM can no longer call it. Agents that needed `manageWiki action='page'` to display a page in the canvas no longer need that call — wiki Writes/Edits auto-render.
- **Built-in todo plugin moved to `packages/todo-plugin/`** (#1149). Existing data auto-migrates on first launch. Custom code importing from `src/plugins/todo/` will fail to resolve — switch to `@mulmoclaude/todo-plugin/{shared,composables,vue}`.

### Packages published during this cycle

- `@mulmobridge/client@0.1.5` (#994), `@mulmobridge/chat-service@0.1.3` (#993).

---

## [0.5.3] - 2026-04-29

### Fixed

- **Sandbox mode silently disabled in published npm package** — `Dockerfile.sandbox` and `sandbox-entrypoint.sh` were not bundled into the `mulmoclaude` tarball, so on `npx mulmoclaude` the server logged `Failed to set up sandbox, running unrestricted` and fell back to unrestricted execution. Both files are now copied by `prepare-dist.js` and listed in `files`, and `scripts/mulmoclaude/tarball.mjs` asserts their presence in the packed tarball to prevent regressions.
- **`mulmoclaude --version` printed stale `0.5.1`** — the launcher had a hard-coded version string that drifted from `package.json` after 0.5.2. Now matches the published version.

---

## [0.5.2] - 2026-04-29

### Fixed

- **Image rendering in HTML / PDF** — LLM-generated content emitting `<img src="/artifacts/images/…">` (web-rooted convention) now renders correctly. The path-traversal hardening from #384 was correct but didn't recognise the leading-slash form, so:
  - PDF generation logged `image path escapes workspace` and produced a broken `<img>`.
  - presentHtml plugin's iframe srcdoc 404'd the image because `/artifacts/` isn't served at the SPA origin.
  Both paths now treat leading-slash as workspace-rooted while keeping the workspace boundary check intact (e.g. `/etc/passwd` is still rejected). (#961)

---

## [0.5.1] - 2026-04-27

### Fixed

- **MCP catalog Notion entry** — switched from the legacy `OPENAPI_MCP_HEADERS` JSON-string form (with a hardcoded `Notion-Version: 2022-06-28`, three years stale) to the official `NOTION_TOKEN` env var, which the upstream README marks as recommended. Users who installed Notion via the catalog before this change still work, but their `~/mulmoclaude/config/mcp.json` keeps the old shape — re-install from Settings → MCP to pick up the new env shape and access the 2025-09-03 API features (data sources, 7 new tools). (#852 / #860)
- **Wiki / sources help text**: align on-disk YAML key names so the help-file driven hints match the keys the agent emits (#855 / #861).
- **E2E**: stop flakiness in the chat-target notification test (#863); update Notion catalog test for the new `NOTION_TOKEN` env shape.

### Changed

- **CI**: shard e2e across 2 parallel runners; add `restore-keys` + `packages/dist` cache for Windows speedup; skip `lint_test` + `e2e` on docs / plans / markdown-only PRs (#862, #864).

---

## [0.5.0] - 2026-04-27

### Highlights

- **Notifications grew up** — macOS Reminders sink (Darwin-only, opt-out by default via `MACOS_REMINDER_NOTIFICATIONS=0`); `notify` exposed as an MCP tool so the agent can fire notifications directly; deep-link permalinks let a notification jump to its target todo / wiki page / chat session; per-item read state — clicking or dismissing a single notification decreases the badge count.
- **Sources got its own page** — `/sources` replaces the Source Manager built-in role with a page-scoped chat composer plus filter chips by fetcher kind / schedule. Suggested queries on the Sources view start chats already aware of the active filter.
- **News viewer (`/news`)** — unread management UI, per-article chat composer that scopes the new session to that article.
- **`manageScheduler` split into `manageCalendar` + `manageAutomations`** (#824) — clearer per-surface tools; legacy view-only fallback keeps pre-split chat sessions readable.
- **MCP catalog UI** (#823) — Phase 1 ships a curated list of preset MCP servers with checkbox install for config-free entries; Phase 2 adds a per-server config form and 6 new entries.
- **`presentForm` in General role** (#826) — choice / yes-no / feature-toggle prompts surface as clickable forms; submit text reads as a markdown bullet list (`- {label}: {value}`) instead of a JSON wrapper, so chat history stays human-readable.
- **Wiki**: tag-based filtering on the index, "Create this wiki page" empty-state CTA, "Lint My Wiki" button, interactive GFM task checkboxes that round-trip to disk, Unicode hashtags accepted in index bullets.
- **Session history side panel** (#728) — independent toggle (canvas and history can coexist), expand-to-full-width, badge moved onto the toggle button. The standalone `/history` route is retired in favor of the panel.
- **Files view** (#832) — system-managed file description banner; file-tree icons tinted by edit policy (read-only / system-managed / writable).
- **Thinking… indicator** (#839, #731 PR2) — shared across slide and stack views, per-tool elapsed time, gated on whether _this_ session is running rather than the global isRunning.
- **Server observability** (#779) — structured `log.{error,warn,info,debug}` audit; layered logging on 10+ routes (plugin / files / todos / chart / config / html / roles / sessions / skills / image).
- **Smoke-tested `mulmoclaude` tarball in CI** (#667) — pre-publish smoke workflow verifies the npm package boots before release.
- **Slack ack reaction** (`@mulmobridge/slack@0.4.0`) — `SLACK_ACK_REACTION=1` adds 👀 on receive so the user sees the bot saw the message before the agent finishes (#695).
- **Per-platform default role for relay** — `RELAY_<PLATFORM>_DEFAULT_ROLE` lets relay assign different default roles per platform (#739).

### Added

- **`/news`** viewer with unread management; per-article chat composer.
- **`/sources`** page with chat composer + filter chips by fetcher kind / schedule; suggested-queries list.
- **macOS Reminders notification sink** — Darwin-only, on by default, disable with `MACOS_REMINDER_NOTIFICATIONS=0`; title/body passed via argv (not osascript attribute) to close a string-injection vector (#789).
- **`notify` MCP tool** — agent can fire push-style notifications directly.
- **Notification permalinks** — every notification deep-links to its target item (#762).
- **`manageCalendar` + `manageAutomations`** plugins (split from `manageScheduler`, #824).
- **MCP catalog UI** — preset server list, checkbox install, per-server config form, 6 curated entries (#823).
- **`presentForm` in General role** with prompt nudge for choice questions and `required: true` instruction (#826).
- **Wiki**: tag filter chips on index, "Create this wiki page" CTA on empty pages, "Lint My Wiki" header button, interactive GFM task-checkbox toggle (#775), Unicode hashtag support, per-page chat composer extracted into reusable `PageChatComposer`.
- **Files**: system-managed file description banner, edit-policy-tinted file-tree icons (#832).
- **`fetchWithTimeout` helper** — `AbortController`-based; wired into MCP + X API call sites (#722).
- **Layered logging** on plugin routes / files / todos / chart / config / html / roles / sessions / skills / image (#779).
- **Smoke-test workflow** for the published `mulmoclaude` tarball — dep audit, drift check, tarball smoke, CI artifact upload (#667).
- **Slack ack reaction** — opt-in `SLACK_ACK_REACTION` env (#695).
- **Per-platform default role** — `RELAY_<PLATFORM>_DEFAULT_ROLE` (#739).
- **Artifact directory sharding** by `YYYY/MM` to keep folders manageable (#764).
- **Side-panel expand toggle** — full-width session-history view (#728 follow-up).
- **History filter via URL path param** — `/history/unread`, `/history/scheduler`, … bookmarkable (#677).
- **Suggestions trigger** moved into the composer button column for closer reach.
- **Tab-bar origin badge overlaid on role icon**; bold unread labels.

### Changed

- **`manageScheduler` is now split** into `manageCalendar` + `manageAutomations`. Pre-split sessions render via a legacy view-only fallback (#824). See **Breaking Changes** below.
- **`/history` retired** — history is now the side panel only; the route + entrance composable were removed.
- **Source Manager and Role Manager built-in roles removed** — sources live on `/sources`, roles on `/roles`.
- **`currentRoleId` is user-owned**; `RoleSelector` ownership refactored so role state isn't trapped in a chat composable (#714).
- **`presentForm` submit text** — JSON `{"formSubmission":{...}}` → markdown bullet list (`- {label}: {value}`). Free-form text values use indented continuation; checkbox selections render as a nested sub-list to avoid comma-ambiguity (#826).
- **Slug rule unified** across journal / todos / wiki / files (#732). Single canonical `slugify` (`server/utils/slug.ts`) — non-ASCII deterministically hashed (16-char base64url SHA-256 prefix), ASCII lowercased + hyphenated. `isValidSlug` and the slug-output cap both moved from 64 → 120 chars. **Breaking** — see below.
- **`FilterChip` component** unified across panels — Sources, History, Wiki tag filter all share one chip implementation.
- **Top-bar and panel-header control sizing** standardized (`h-8` square / `h-8 px-2.5 pill` / `flex items-center gap-2 px-3 py-2` row container). Panel-header layouts collapse into one row to match.
- **`@mulmobridge/slack`** v0.3.0 → **v0.4.1** — ack reaction, then a stable-version bump as part of the bridge package sweep.
- **`@mulmobridge/protocol`** → **v0.1.4**, **`@mulmobridge/chat-service`** → **v0.1.2**, **`@mulmobridge/client`** → **v0.1.3** → **v0.1.4** — opaque `options` passthrough from bridge env to the host app, narrower `bridgeOptions` types.
- **`@mulmobridge/cli`** → **v0.1.3**, **`@mulmobridge/telegram`** → **v0.1.3**, all other 22 bridges → **v0.1.1** — workspace-dep range tightening + README catch-up sweep.

### Fixed

- **Wiki**: per-entry tag chips set the filter (no longer toggle the active filter off); index-table images resolve under `data/wiki/`; distinguishes missing vs empty page; route GET `/api/wiki?slug=...` through `buildPageResponse`; backtick-stripped index-table headers; tag filter cleared on Index/Log/Lint navigation; toolbar padding + frontmatter visibility cleaned up.
- **Files**: large audio/video preview in `/files` + audio-file icon; PDF filename derived from content with `yyyy-mm-dd` suffix (#831).
- **Image plugin**: workspace-rooted refs + bridge timeout (#782); legacy `markdowns/` and `spreadsheets/` paths migrated and rejected at the validator (#773).
- **Notifications**: per-item read state — click or dismiss decreases the badge; chat-target test pre-seeds a session to avoid the `/chat` auto-create race; agent-completion bell muted (duplicate of session panel badge).
- **Sessions**: `isRunning` split into global vs active-session scoped; URL query preserved when `activateSession` runs on URL-driven path; current session id cleared off `/chat` so unread doesn't clear on background finish.
- **Skills Run button** routes through `startNewChat` so the user sees the response.
- **Spreadsheet preview cards** simplified; e2e canonical paths under `artifacts/spreadsheets/`.
- **i18n**: 6 user-facing English strings translated (closes #713); German typographic-quote handling rule added (`„` U+201E / `"` U+201C in `de.ts`); aria-labels on send/attach/suggestions buttons.
- **Settings**: reference + workspace dirs auto-save on add/remove (#716); modal-level Save/Cancel dropped (Tools tab keeps its own); MCP form serializes `persistMcp` and updated E2E for new save UX.
- **Wiki self-heal**: `taskPersistChain` recovers when `persistWikiPage` rejects (#795).
- **Build / CI**: i18n cache reset between wiki page-save tests (Windows / Node 24 flake); Playwright runs on dedicated port 45173; ci-stub for Claude Code CLI in launcher pre-flight; smoke-verified mulmoclaude tarball uploaded as workflow artifact.
- Many follow-up commits addressing Codex / CodeRabbit / human review feedback across ~30 PRs.

### Security

- **macOS Reminders sink**: title/body now passed via argv to `osascript` instead of the system attribute, closing a string-injection vector that could land in a Reminder if a notification body contained `osascript`-meta characters (#789).
- **Sandbox + smoke**: smoke driver runs with `DISABLE_SANDBOX=1` on CI (no `~/.claude` available), but ships sandbox-on for end-users.

### Breaking Changes

- **`manageScheduler` is split into `manageCalendar` + `manageAutomations`** (#824). Pre-split chat sessions still render their tool-results via a view-only legacy fallback (`legacyManageSchedulerEntry`), but agents can no longer call `manageScheduler` — new prompts must target the right half (`manageCalendar` for events / `manageAutomations` for recurring tasks).
- **Source Manager and Role Manager built-in roles removed**. Existing chat sessions keep working; new manageSource / manageRoles calls flow through their respective dedicated pages (`/sources`, `/roles`) and any role still on the legacy id falls back to `general`.
- **Slug rule unification (#732)** — same impact as documented in the prior `[Unreleased]`:
  - **Journal topics with non-ASCII names**: `slugify` previously dropped non-ASCII characters and collided distinct Japanese names onto a single `topic.md`. After #732 each distinct name maps to a unique `<hash>.md`. **Migration**: none — old `topic.md` files become orphans under `<workspace>/conversations/summaries/topics/`; the journal regenerates fresh summary files on the next pass and operators may delete the orphans at their own pace.
  - **Todo columns**: default column id `in_progress` becomes `in-progress`, new custom-column ids use the hyphen separator. Existing `data/todos/columns.json` is read as-is so workspaces keep their stored ids; the new defaults apply only to fresh workspaces.

### Packages published during this cycle

- `mulmoclaude@0.5.0` (this release)
- `@mulmobridge/slack@0.4.1`, 0.4.0, 0.3.0
- `@mulmobridge/protocol@0.1.4`
- `@mulmobridge/chat-service@0.1.2`
- `@mulmobridge/client@0.1.4`, 0.1.3
- `@mulmobridge/cli@0.1.3`
- `@mulmobridge/telegram@0.1.3`
- `@mulmobridge/{bluesky,chatwork,discord,email,google-chat,irc,line,line-works,mastodon,matrix,mattermost,messenger,nostr,rocketchat,signal,teams,twilio-sms,viber,webhook,whatsapp,xmpp,zulip}@0.1.1`

---

## [0.4.0] - 2026-04-23

### Highlights

- **13 new messaging bridges** bring the total bridge count to 20+ — bots can now talk to Mastodon, Bluesky, Chatwork, XMPP / Jabber, Rocket.Chat, Signal, Microsoft Teams, Viber, LINE Works, Nostr, plus three generic connectors (Webhook / Twilio SMS / IMAP-SMTP Email).
- **Path-based URLs** for Wiki (`/wiki/index`, `/wiki/pages/<slug>`), Files (`/files/<path>`), History (`/history`), and Chat (`/chat/:id`, lands on the latest session when naked). Back/forward/bookmark work everywhere; the browser history IS the navigation source of truth.
- **Internationalization goes live** — vue-i18n skeleton (#559), auto-detect locale from the browser, and **8 locales** ship out of the box (en, ja, zh, ko, es, pt-BR, fr, de). Dozens of components had hard-coded strings extracted into the locale files across 17 extraction batches.
- **Agent respects the user's timezone** — requests now carry the browser's IANA zone, and the system prompt tells the model to interpret bare times ("15:00") in that zone without re-asking every turn. Scheduler UI mirrors the change — daily triggers render in the viewer's local zone (`Daily 05:00 GMT+9`) instead of UTC.
- **Favicon rebuilt around the mascot** (#470 follow-up): mascot logo in the rounded frame, background color carries state (idle / running / done / error), red dot surfaces **any** unread session, not just the active one.
- **Dev-server port fallback** — `yarn dev` no longer crashes when 3001 is already in use; the walk-forward logic from `npx mulmoclaude` now lives in a shared `server/utils/port.mjs` and drives both entry points.

### Added

- **Bridges** (13 new; all new packages, `v0.1.0` each):
  - `@mulmobridge/mastodon` — subscribes to the user notification stream (WebSocket), handles DMs and optionally public mentions, inherits visibility on reply, forwards image attachments, chained thread replies for long output, proactive direct-visibility push mentions the recipient.
  - `@mulmobridge/bluesky` — polls `chat.bsky.convo.getLog` via the atproto-proxy header, forwards DMs, auto-refreshes the session JWT on 401, cursor-at-startup for missed DMs.
  - `@mulmobridge/chatwork` — Japanese business chat, polls unread messages per room via REST, strips Chatwork markup.
  - `@mulmobridge/xmpp` — XMPP / Jabber over TLS with JID + password.
  - `@mulmobridge/rocketchat` — personal-access-token auth, paginated `im.list` + `im.history`, seeds cursor to `now - pollInterval` on first discovery so the message that created the DM room isn't lost.
  - `@mulmobridge/signal` — talks to a local [signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api) daemon, groups routed to `group.<id>` chatIds (not mixed with DMs), E.164 source validation, module-scoped exponential backoff on reconnect.
  - `@mulmobridge/teams` — Microsoft Teams via Bot Framework (`botbuilder` SDK). Conversation-reference cache for push, AAD object-id allowlist. Requires a public URL.
  - `@mulmobridge/webhook` — generic HTTP bridge; POST JSON, get the AI reply in the response body. Optional `x-webhook-secret`.
  - `@mulmobridge/twilio-sms` — Twilio Programmable Messaging, `X-Twilio-Signature` HMAC-SHA1 verification, number-based allowlist.
  - `@mulmobridge/email` — IMAP poll / SMTP reply with threading preserved (`In-Reply-To` + `References`).
  - `@mulmobridge/line-works` — enterprise LINE via service-account JWT → OAuth, separate from consumer LINE.
  - `@mulmobridge/nostr` — NIP-04 encrypted DMs across multiple relays, periodic resubscribe after relay drops, last-seen cursor persisted to `~/.mulmoclaude/nostr-cursor.json` so restarts don't lose messages, hex / nsec key input with pubkey allowlist.
  - `@mulmobridge/viber` — Viber Public Account bot, `X-Viber-Content-Signature` HMAC-SHA256.
- **Wiki**: per-page chat composer (`pages/<slug>` leaf view) that spawns a new session scoped to the page; back-arrow now walks browser history instead of forcing index; slug path-traversal rejection; empty-slug guard; exact-title lookup for non-ASCII pages.
- **Files view**: path-based URL (`/files/<path>`) with query-form back-compat, internal workspace link router routes markdown-embedded links to the right view.
- **History view**: promoted to `/history`, "unread only" filter pill, session-origin filter (human / scheduler / skill / bridge).
- **Chat**: naked `/chat` lands on the most recent session; MulmoClaude logo/title click resumes the latest session; `/chat/:id` push via `router.push` (no replace).
- **i18n**: vue-i18n skeleton, auto-detect locale from `navigator.language` when `VITE_LOCALE` unset, 7 new locale files (ja, zh, ko, es, pt-BR, fr, de — en remains the source of truth), vue-i18n lint wiring via `batch/i18n-dump.ts`.
- **UI**: MulmoClaude mascot-based favicon with state-colored background + red unread dot, scheduler frequency hints, ChatInput attach-file discoverability, source labels on preview cards.
- **Server**: session-origin tag on every session, chat-index + journal force-run env flags, reference directory mounts into Docker sandbox.
- **Canvas**: PNG file as source of truth so drawings survive reload; POST `/api/canvas` + PUT `/api/images/:filename` endpoints with unit tests.
- **Prompt**: compact plugin bullets, per-section size monitoring with threshold warning, summary-only inlining for large help files.
- **Tests**: E2E right-sidebar hidden on plugin views, `/files/<path>` character coverage, workspace link routing unit + E2E, ChatInput attach discoverability, internal-link-navigation assertion for path-based Files, regression tests for session behavior fixes.

### Changed

- **`@mulmobridge/slack`** (v0.2.0 → **v0.3.0**): `SLACK_SESSION_GRANULARITY=thread` auto-creates a Slack thread on the first bot reply to a top-level channel post; unrelated top-level messages now get one thread per topic. `channel` (default) and `auto` unchanged; DMs unaffected (#661 / closes #658).
- **`@mulmobridge/client`** (v0.1.1 → **v0.1.2**): exports `chunkText` from `./text`; required by every new bridge.
- **`@mulmobridge/mock-server`** (v0.1.0 → **v0.1.1**): internal refactor + README catch-up.
- **`@mulmobridge/relay`** (v0.1.0 → **v0.2.0**): four new platform plugins — WhatsApp, Messenger, Google Chat, Microsoft Teams — plus Durable Object hibernation recovery and subpath exports.
- Dev server port resolution: shared `server/utils/port.mjs` drives both `yarn dev` and the `npx mulmoclaude` launcher; explicit `PORT=3099` exits on conflict, default walks forward through 20 slots.
- Scheduler UI: daily triggers render in viewer's local timezone (e.g. Tokyo sees `Daily 05:00 GMT+9` instead of `Daily 20:00 UTC`).
- Agent prompt: new `## Time & Timezone` section instructs the model to default bare time expressions to the user's browser timezone and only clarify for explicit cross-zone mentions. "Today's date" is now computed in that zone.
- Wiki tabs (Index / Log / Lint) styled to match PluginLauncher; PDF download button aligned with TextResponse view; index rows condensed to single line.
- Bridges moved from `packages/<name>/` into `packages/bridges/<name>/` subdirectory.
- CLAUDE.md: i18n rule — all 8 locales must move in lockstep; `id-length` lint promoted to `error`.
- ChatInput: focus expansion dropped, padding tightened, buttons equalized.
- Tool-results card timestamps overlaid on top border instead of inline.
- Express request-id header normalization (CRLF stripped before multi-paragraph plugin check).

### Fixed

- **Wiki**: back arrow walks browser history instead of resetting to index (#wiki-nav); same-origin markdown links no longer trigger full page reloads; relative links in text-response don't navigate the SPA; cross-route query bleed; redundant mount fetch on `/wiki` cancelled; `navError` hoisted above the immediate URL watcher; originating page retained in history when starting a chat.
- **Session**: role switch from a non-chat page no longer creates a phantom chat session; sidebar preview links don't spawn new sessions; re-selecting the active session from a non-chat page navigates correctly; fall back to a new session when top-session resume fails; URL session id read directly to avoid watcher timing race.
- **Right sidebar**: hidden along with its toggle on non-chat views (#652).
- **Mastodon**: image-only DMs no longer dropped; chunked replies chain into one readable thread; fail loudly on a create-status response missing `id` (previously left stale `prevId` chaining onto the wrong parent).
- **Rocket.Chat**: `im.history` / `im.list` pagination (previously silently trimmed past 50 / 100 entries); cursor rewind on first DM discovery.
- **Signal**: E.164 source check (UUID-only senders would 400 on reply); `backoffMs` hoisted to module scope so reconnect actually backs off; `dataMessage.groupV2.id` / `groupInfo.groupId` routing so group chats don't collapse into the sender's DM.
- **Nostr**: auto-resubscribe every 5 min to survive relay WebSocket drops; last-seen cursor persisted so a >60 s restart doesn't lose DMs.
- **Bluesky**: cursor-at-startup so DMs delivered while the bridge was down still flow in on first poll.
- **Teams (relay)**: webhook auth hardened against SSRF and impersonation — `serviceurl` claim cross-check, `channelId === "msteams"` check, JWK endorsement check for MultiTenant, fail-closed allowlist when `aadObjectId` missing.
- **Scheduler / prompt**: plugin-prompt paragraph detection normalizes CRLF.
- **i18n**: pluginWiki schema drift across pt-BR / fr / de / es / ko / zh fixed in multiple rounds; literal `@` in stdio argsPlaceholder escaped (the Intl linked-message compiler was turning `@modelcontextprotocol/...` into a runtime error); silence vue-i18n HTML warning; missing chatPlaceholder / chatSend / pdf keys aligned across all locales.
- **E2E**: IME Enter test deflaked by collapsing the `compositionstart → compositionend → keydown` dispatches into a single `page.evaluate()` (per-hop latency was blowing past the 30 ms race window on CI webkit).
- **Slack**: session-granularity env invalidation now rejects invalid values up front; id-length lint clean-up across the package.
- **Settings / MCP**: stdio form rendering regression (vue-i18n link-compile error).
- **Roles**: role switch on non-chat pages no longer creates a session.
- **Build**: i18n cache location and `dumpi18n` wired into lint so the rule can see every locale.

### Security

- **`@mulmobridge/relay`**: Teams webhook auth — reject bodies whose `serviceUrl` doesn't match the JWT's `serviceurl` claim (SSRF prevention), enforce `channelId === "msteams"`, require `msteams` in JWK `endorsements` for MultiTenant keys, fail-closed allowlist.
- **`@mulmobridge/nostr`**: Tight IANA regex + `Intl.DateTimeFormat` round-trip validation on any timezone string before it lands in the system prompt, so a hostile client can't inject newlines or instructions via a crafted payload.
- **`@mulmobridge/signal`**: E.164 source validation — the `/v2/send` API requires a phone number, and a UUID-only sender would quietly 400; now we drop instead.
- **Agent prompt**: IANA timezone string sanitisation before it reaches the system prompt.

### Packages published during this cycle

- `mulmoclaude@0.4.0` (this release)
- `@mulmobridge/slack@0.3.0`
- `@mulmobridge/slack@0.2.0`
- `@mulmobridge/client@0.1.2`
- `@mulmobridge/mock-server@0.1.1`
- `@mulmobridge/relay@0.2.0`
- `@mulmobridge/mastodon@0.1.0`
- `@mulmobridge/bluesky@0.1.0`
- `@mulmobridge/chatwork@0.1.0`
- `@mulmobridge/xmpp@0.1.0`
- `@mulmobridge/rocketchat@0.1.0`
- `@mulmobridge/signal@0.1.0`
- `@mulmobridge/teams@0.1.0`
- `@mulmobridge/webhook@0.1.0`
- `@mulmobridge/twilio-sms@0.1.0`
- `@mulmobridge/email@0.1.0`
- `@mulmobridge/line-works@0.1.0`
- `@mulmobridge/nostr@0.1.0`
- `@mulmobridge/viber@0.1.0`

---

## [0.3.0] - 2026-04-22

### Highlights

- **`npx mulmoclaude` one-command launch (#533, #535)** — self-contained npm package that ships server TypeScript + Vite client; runs via `tsx`, opens the browser, auto-falls back to the next free port if 3001 is busy. Prints a ready banner once the HTTP endpoint actually responds.
- **MulmoBridge Relay (#456)** — Cloudflare Workers + Durable Object webhook proxy; server-side WebSocket client with hibernation recovery. `/setup-relay` skill for interactive deploy.
- **Bridge session switching (#489)** — `/sessions`, `/switch`, and `/history` commands from inside a bridge. Session list scales to 200 with pagination.
- **Session origin tracking (#486)** — sessions tagged `human` / `scheduler` / `skill` / `bridge`; origin icons + filter UI in the history sidebar.
- **Scheduler Phase 3+** — task dependencies (`dependsOn` for ordered execution, #465 Phase 3), system task schedule overrides via config file (#493), live-update API for overrides.
- **Source auto-discovery (#469)** — arXiv pipeline keyed off user interests; news notification + concierge prompt (#466).

### Added

- `npx mulmoclaude` launcher: port fallback, ready-banner probe, graceful shutdown, `--port` validation
- `/publish-mulmoclaude` skill: dep audit + workspace drift check + tarball test + cascade publish flow
- `/setup-relay` skill: interactive Cloudflare Workers deploy + MulmoClaude connection
- `/setup-wizard` skill (#474): conversational automation setup via manageScheduler / manageSkills / manageSource
- `@mulmobridge/relay` package: Workers webhook proxy with platform plugin architecture (LINE / Telegram)
- Bridge commands: `/sessions`, `/switch`, `/history`, bridge session pagination
- Session origin field + isSessionOrigin guard; origin icons + history filter UI
- Dynamic favicon reflecting agent state (#470)
- MulmoClaude logo in top-left header
- Canvas entry timestamps (time-only for today, date+time otherwise)
- File tree Name/Recent sort toggle
- Browse reference directories in file explorer (#472)
- User-configurable read-only reference directories (#455)
- manageSource tool in General + Office roles
- Background generation for MulmoScript image / audio / movie
- Create + rename custom roles directly from the manageRoles view
- `presentDocument` requires sanitized filenamePrefix
- `/history` command; session list limit raised to 200

### Changed

- App.vue split into 10+ composables (`useChatScroll`, `useSessionSync`, `useSessionDerived`, `useMergedSessions`, `useFaviconState`, `useViewLayout`, `useDebugBeat`, `useFileTree`, `useFileSelection`, `useMarkdownMode`, `useContentDisplay`, `useMarkdownLinkHandler`)
- 50+ inline type checks migrated to shared guards in `src/utils/types.ts` (#504)
- FilesView extracted into `FileTreePane` + `FileContentHeader` + `FileContentRenderer` (#507)
- id-length lint enabled as warn repo-wide; short identifiers renamed across src / server / packages
- Defer new session tab creation until first message (#533 et al.)
- `mulmoclaude` npm package layout: ships `server/` TS + `client/` dist + `src/` shared; `prepublishOnly` hook runs `prepare-dist.js`
- CI: Windows runner pinned to `windows-2022`, node_modules caching enabled, job-level timeouts

### Fixed

- Express 5 wildcard route (`app.get("*")` → `/{*splat}`) — previously crashed only in NODE_ENV=production
- Session-store: gate storeless publish to generation events only; type-guard generation payloads; await persistHasUnread in storeless drain
- StackView auto-scroll during assistant text streaming
- Role selector reverting to prior session's role on tab switch
- manageRoles rename now deletes the built-in-id override file
- manageRoles hardened against two hostile payload shapes
- Relay client: survive Durable Object hibernation via `getWebSockets()`; response queue + URL builder hardening; try/catch around dispatch
- Generation map key collision fix (delimiter hardening)
- Merge sessions: OR `live.isRunning` into merged summary so active bridge sessions surface correctly

### Packages published during this cycle

- `mulmoclaude@0.3.0` (aligned to app version — initial npm publish with port fallback, ready banner, tsx runtime)
- `@mulmobridge/protocol@0.1.3` (adds `GENERATION_KINDS` export chain)
- `@mulmobridge/chat-service@0.1.1` (catches up with protocol 0.1.3)
- `@mulmobridge/relay@0.1.0` (new)

---

## [0.2.0] - 2026-04-20

### Highlights

- **Unified Scheduler (#357)** — persistence, catch-up after downtime, skill scheduling via SKILL.md frontmatter, user-created tasks with CRUD API + MCP tool + Tasks UI
- **Notification Center (#144)** — bell icon with unread badge, dropdown panel, agent completion triggers, click-to-navigate
- **12 Messaging Bridges** — Slack, Discord, LINE, WhatsApp, Matrix, IRC, Mattermost, Zulip, Messenger, Google Chat (LINE verified)
- **User-Defined Workspace Directories (#239)** — custom data/ and artifacts/ subdirectories via Settings UI
- **Magic Number Elimination** — all time literals and scheduler string literals replaced with named constants

### Added

- Scheduler Phase 1: `@receptron/task-scheduler` pure library with catch-up algorithm + execution logs
- Scheduler Phase 2: `schedule:` frontmatter in SKILL.md for automatic skill execution
- Scheduler Phase 3: user task CRUD API (`POST/PUT/DELETE /api/scheduler/tasks`), MCP tool (`createTask/listTasks/deleteTask/runTask`), Tasks tab UI
- Notification center: `NotificationBell.vue` + `NotificationPayload` type + `publishNotification()` server API
- Agent completion → notification trigger (P0)
- User-defined workspace directories: `config/workspace-dirs.json` + Settings "Directories" tab
- `CANVAS_VIEW` constants for view mode literals
- `NOTIFICATION_KINDS` / `NOTIFICATION_ACTION_TYPES` / `NOTIFICATION_VIEWS` / `NOTIFICATION_PRIORITIES` constants
- `SCHEDULER_ACTIONS` constants for MCP tool actions
- Time constants: `SUBPROCESS_PROBE_TIMEOUT_MS`, `SUBPROCESS_WORK_TIMEOUT_MS`, `CLI_SUBPROCESS_TIMEOUT_MS`
- `CanvasViewMode` extended with `todos` / `scheduler` for URL-driven plugin access (#418)
- `@mulmobridge/mock-server` for bridge integration testing

### Changed

- Minimum Node.js version: 18 → 20 (24 recommended)
- All time literals (`1000`, `60000`, `3600000`) replaced with `server/utils/time.ts` constants across 13 files
- All scheduler string literals (`"interval"`, `"daily"`, `"success"`, etc.) replaced with `@receptron/task-scheduler` constants
- `WORKSPACE_FILES` reunified to shared `src/config/workspacePaths.ts`
- Date/time formatting helpers consolidated into `src/utils/format/date.ts`

### Fixed

- Tool Call History not updating after page reload (#432)
- `?path=` URL param cleanup when file is closed or view changes (#434)
- MCP server crash in Docker — missing require export + packages mount (#429)
- Attachment parsing: count + size limits added (#425)
- Security: `.session-token` blocked from file API, `timingSafeEqual` for token comparison (#447)
- Broken plan links in docs (plans moved to plans/done/)
- LINE bridge status updated to "Verified"

### Security

- Token handling hardened: `timingSafeEqual`, file API blocklist
- Webhook bridges: 1MB body limit, per-IP rate limiting, PII redaction
- Google Chat: JWT/OIDC verification
- Workspace custom dirs: path traversal prevention, reserved dir protection, prompt injection defense

---

## [0.1.2] - 2026-04-19 (package release)

> **Note**: This was a package-only release for `@mulmobridge/*` npm packages. The MulmoClaude app version was v0.1.1 at this time.

### Added

- `@mulmobridge/slack` (v0.1.0) — Slack bot bridge (Socket Mode, no public URL needed)
- `@mulmobridge/discord` (v0.1.0) — Discord bot bridge (Partials.Channel for DMs)
- `@mulmobridge/line` (v0.1.0) — LINE bot bridge (webhook + HMAC signature)
- `@mulmobridge/whatsapp` (v0.1.0) — WhatsApp Cloud API bridge (webhook + HMAC)
- `@mulmobridge/matrix` (v0.1.0) — Matrix bridge (matrix-js-sdk, end-to-end encryption ready)
- `@mulmobridge/irc` (v0.1.0) — IRC bridge (irc-framework, TLS, channel + DM)
- `@mulmobridge/mattermost` (v0.1.0) — Mattermost bridge (WebSocket + REST, auto-reconnect)
- `@mulmobridge/zulip` (v0.1.0) — Zulip bridge (long-polling events API)
- `@mulmobridge/messenger` (v0.1.0) — Facebook Messenger bridge (webhook + x-hub-signature-256 HMAC)
- `@mulmobridge/google-chat` (v0.1.0) — Google Chat bridge (webhook + JWT/OIDC verification)
- `@mulmobridge/mock-server` (v0.1.0) — Lightweight mock server for bridge integration testing

### Fixed

- Google Chat webhook now verifies JWT tokens against Google's JWKS endpoint (iss/aud/exp claims)
- Webhook bridges (Messenger, Google Chat) enforce 1MB body size limit and per-IP rate limiting
- PII redaction in bridge logs — sender IDs are partially masked

---

## [0.1.1] - 2026-04-18

### Highlights

- **Monorepo & npm packages (#360)** — Extracted shared code into publishable `@mulmobridge/*` packages under yarn workspaces:
  - `@mulmobridge/protocol` (v0.1.1) — shared types and constants
  - `@mulmobridge/client` (v0.1.0) — socket.io client library, bearer token reader, MIME utilities
  - `@mulmobridge/chat-service` (v0.1.0) — server-side chat service
  - `@mulmobridge/cli` (v0.1.1) — interactive terminal bridge (`npx @mulmobridge/cli@latest`)
  - `@mulmobridge/telegram` (v0.1.1) — Telegram bot bridge (`npx @mulmobridge/telegram@latest`)
- **Real-time text streaming (#392, #393)** — Claude responses stream token-by-token in the Web UI
- **Workspace restructure (#284, #314)** — layout reorganized into 4 semantic buckets: `config/`, `conversations/`, `data/`, `artifacts/`
- **File I/O consolidation (#366)** — all workspace file operations centralized into domain-specific I/O modules under `server/utils/files/`
- **Telegram bridge (#321, #322, #355)** — full Telegram bot with photo support, allowlist, message chunking, server push

### Added

- Sandbox enhancements: opt-in host credential forwarding (#327), macOS SSH agent support (#347), gh CLI with auth (#353)
- Image & PDF in chat: paste/drag-and-drop image (#379), PDF attachment support (#385)
- Auto-expand chat input (#387), unread session highlights (#343), launcher active highlight + badge tooltips (#362)
- Skills system: render SKILL.md as formatted markdown (#339), direct editing in UI (#342), update via chat (#344)
- Incremental session fetch with server cursor (#338)
- Notification scaffold: time-delayed push fan-out (#331)
- GitHub workspace: standardize github/ directory + .gitignore filter (#358, #365)

### Changed

- Server reorganized into 6 topical dirs (#328)
- Extracted `useImeAwareEnter` composable (#378)
- Attachment protocol: `imageDataUrl` replaced with `Attachment[]` (#383)
- Pre-commit hook + `/precommit` review skill (#388, #389, #391, #398)
- ESLint flat config scoped correctly for all packages

### Fixed

- Bearer token wired to MCP subprocess (#325) and frontend plugin launcher (#326)
- Agent resume failover on stored session ID rejection (#324)
- Wiki path references updated for post-#284 layout (#354, #359)
- PresentDocument images broken by bearer auth + path migration (#372)
- Re-fetch transcript on session_finished to recover missed events (#351)
- Post-#284 workspace paths in markdown + spreadsheet plugins (#348)
- Lock popup overflows left edge of viewport (#356)

### Breaking Changes

- Workspace layout changed (#284) — run migration script before upgrading
- `bridges/` directory removed — use `@mulmobridge/*` packages or `yarn cli` / `yarn telegram`
- `imageDataUrl` field removed from bridge protocol — use `attachments: Attachment[]`

### Test Coverage

- 2400+ unit tests, session-store, image-store, plugin paths, workspace shape, chat-index, markdown-store (#367, #370, #373, #375)

---

## [0.1.0] - 2026-04-14

### Highlights

First tagged release. GUI-chat with Claude Code — chat with Claude and get back not just text but interactive visual tools, persistent knowledge, and a growing library of skills.

### Added

- 9 specialised roles — General / Office / Guide & Planner / Artist / Game / Tutor / Storyteller / Musician / Role Manager
- Personal wiki long-term memory with `[[wiki link]]` cross-references
- Skills (phase 0) — list and invoke `SKILL.md` from the canvas
- Charts — Apache ECharts plugin (bar / line / candlestick / sankey / network / heatmap, PNG export)
- Documents / Spreadsheets / Forms / Mind maps / 3D / Music / HTML plugins
- Image generation — Gemini 3.1 Flash Image
- MulmoScript storyboards — multi-beat presentations with audio + image + movie
- Docker sandbox by default (`--cap-drop ALL`, non-root)
- Web settings UI — manage allowed tools and MCP servers from the browser
- X (Twitter) tools — `readXPost` + `searchX`

### Architecture

- vue-router with history mode for deep-linkable session URLs
- Server-side session state with pub/sub channel (multi-tab sync)
- Per-session pluggable MCP server (role-scoped tool list)
- Tool trace persistence in `chat/<id>.jsonl`
- Wiki backlinks — pages auto-link to originating chat
- Auto-journal — daily summaries under `summaries/`
- Structured server logger with console + rotating file sinks

### Quality

- 1300+ unit tests (node:test) + 140+ E2E tests (Playwright)
- ESLint with cognitive-complexity gate (>15 = error)
- Cross-platform CI (Ubuntu / macOS / Windows x Node 22 / 24)
- TypeScript strict mode end-to-end

### Security

- Localhost-only bind (`127.0.0.1`)
- CSRF guard on state-changing routes
- Path-traversal-safe slug validation
- Sandbox isolation for Claude CLI (Docker mode)

---

[0.1.2]: https://github.com/receptron/mulmoclaude/releases/tag/v0.1.2
[0.1.1]: https://github.com/receptron/mulmoclaude/releases/tag/v0.1.1
[0.1.0]: https://github.com/receptron/mulmoclaude/releases/tag/v0.1.0
