# Changelog

All notable changes to MulmoClaude are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions use [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Changed

- `@mulmobridge/slack` (v0.3.0 → **v0.4.0**) — Opt-in ack-reaction feature. When `SLACK_ACK_REACTION` is set, the bridge adds an emoji reaction to every inbound message it processes, giving the user an immediate "the bot saw me" signal before the agent finishes thinking. Single dual-purpose env var — `1` enables with the default `:eyes:` 👀, any other emoji shortcode selects a custom emoji. Off by default; requires the `reactions:write` Bot Token Scope when enabled. Fire-and-forget: failures (missing scope, rate limit, etc.) log a warning without blocking the handler. Reaction is not removed when the reply arrives — it stays as a "seen" marker (#696, closes #695).

### Packages published during this cycle

- `@mulmobridge/slack@0.4.0`

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
