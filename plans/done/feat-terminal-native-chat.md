# feat: terminal-native chat — eliminate `claude -p`

## Goal

Replace MulmoClaude's headless **`claude -p` (stream-json)** chat with the
**interactive `claude` CLI running in a PTY** (the mechanism proven in the
sibling `mulmoterminal` project), and **eliminate every `claude -p` invocation**
from the codebase.

**Success criterion (binary):** `grep -rn '"-p"\|--print\|stream-json' server`
returns zero hits over `claude` spawns. The chat is a real interactive terminal;
the GUI chat protocol still works.

> This is a large, multi-milestone change executed on a long-lived `staging`
> branch (see [Strategy](#strategy-long-lived-staging-branch)). It depends on a
> de-risking spike in `mulmoterminal` — see that repo's
> `docs/gui-protocol-spike.md`. **Spike status:** the GUI chat protocol is
> **validated against a real interactive `claude`** (`presentMarkdown` one-way
> and `presentForm` round-trip both work), and **permissions are decided
> terminal-native** (see [Decisions](#decisions-made)) — so M3 has no open risks.

## Motivation

We drive Claude Code through `-p --output-format stream-json --input-format
stream-json` and parse the stream into `AgentEvent`s that render both the chat
transcript and the GUI. That stream is a **semi-internal protocol** that shifts
between CLI versions (cf. `plans/done/feat-drop-strict-mcp-config-1617.md`, the
`#1043`/`#1617` MCP-merge saga). The interactive CLI is the real, full-fidelity
product — slash commands, skills resolution, plan mode, native session
management — and it owns conversation history itself (`~/.claude/projects/<cwd>/
*.jsonl`, resumable via `--resume`). Moving onto it removes a whole class of
protocol-tracking maintenance and a parallel history store we maintain by hand.

## Background

### Why the GUI survives the move (the load-bearing fact)

MulmoClaude's GUI is **not** rebuilt by parsing claude's stdout. It is driven by
two **transport-agnostic** channels that work identically whether `claude` runs
headless or interactive:

- **MCP tools** — `server/agent/mcp-server.ts` pushes structured tool results to
  internal API routes (`postJson(API_ROUTES.agent.internal.toolResult, …)`).
  `presentForm`, `presentDocument`, `manageCollection`, `notify`,
  `spawnBackgroundChat` all run **server-side** and reach claude via
  `--mcp-config` regardless of transcript transport. (Permissions are the
  exception — we drop `handlePermission` in favor of terminal-native prompts;
  see [Decisions](#decisions-made).)
- **Hooks** — e.g. the `page-edit` toolResult is published by a **PostToolUse**
  hook (`MULMOCLAUDE_CHAT_SESSION_ID`, see `config.ts` ~#963), not by stream
  parsing.

The stream parser's real job is the **chat transcript** — exactly the part we
are replacing with a terminal. So the layers split cleanly:

| Layer | Today | After |
|---|---|---|
| Chat transcript | parsed `stream-json` → chat bubbles | **interactive PTY → xterm** |
| GUI artifacts | MCP tools + hooks (`data` payloads) | **unchanged** |
| Conversation history | MulmoClaude session store | **Claude `.jsonl`** (`--resume`) |
| GUI history | in session-store timeline | **separate `data` store keyed by session id** |
| Sandbox/Docker spawn | `buildDockerSpawnArgs` | **reused** (+ `-t`, `pty.spawn`) |

### The complete `claude` surface (the entire scope to eliminate)

| Site | What it is | Seam | Fate |
|---|---|---|---|
| `server/agent/backend/claude-code.ts` | **The chat** — `spawn(claude\|docker, -p stream-json)` | `LLMBackend` / `getActiveBackend()` (`backend/index.ts`) | → interactive PTY backend |
| `server/workspace/journal/archivist-cli.ts` → `runClaudeCli` | One-shot `Summarize`. Fronts **all** of `journal/*` + `memory/*` (topic-run, llm-classifier, migrate, dailyPass, …) | `type Summarize` (DI, test-faked) | reroute via `startChat` |
| `server/workspace/chat-index/summarizer.ts` → `defaultSummarize` | One-shot session **title/summary** | `type SummarizeFn` (DI) | reroute via `startChat` |
| `server/services/translation/llm.ts` → `defaultTranslateBatch` | One-shot **i18n** translation | `type TranslateBatchFn` (DI) | reroute via `startChat` |
| `server/system/credentials.ts` → `renewTokenViaPty` | **Already** `pty.spawn("claude")` for OAuth refresh | — | **reference impl** (no `-p`) |

Two facts that make this far safer than its size suggests:

- **Every non-chat `-p` call is already behind a small dependency-injected
  function type** (`Summarize` / `SummarizeFn` / `TranslateBatchFn`), each
  already swapped for fakes in tests. We replace **three implementations**, not
  scattered spawns. (The earlier `plans/done/refactor-llm-backend-abstraction.md`
  already enumerated these "auxiliary CLI calls" as injectable.)
- **The PTY-claude pattern already lives in this repo** — `renewTokenViaPty`,
  including the node-pty native-module dynamic-import guard. We extend a proven
  pattern.

### The chat-spawn primitive is already unified

`startChat()` (`server/api/routes/agent.ts:136`) is already fire-and-forget — it
kicks off `runAgentInBackground()` (`~:873`, not awaited) and returns once
launched. "Foreground" vs "background" is **visibility (`origin`)**, not a
different execution model. `spawnBackgroundChat` is just the LLM-callable MCP
wrapper around `startChat` (`hidden→origin`, plus no-nesting + a concurrency
cap). So foreground chat, background chat, and mobile-input all **collapse onto
one primitive** — we change what `runAgentInBackground` spawns (interactive PTY
instead of `-p`), not the call sites.

## Target architecture

```
 startChat → runAgentInBackground
        │ pty.spawn(claude  [--mcp-config] [--settings hooks] [--resume id])  (or docker run -it)
        ▼
 interactive claude in PTY
   ├── raw TTY bytes ──ws /ws──►  Terminal (LEFT panel, xterm)
   └── MCP tool data ──/api/...──►  GUI data store (keyed by session id)
                                       └──pub/sub──►  GUI (RIGHT panel)
 history: session list ← Claude `.jsonl`;  GUI replay ← data store
```

- **Left panel** = terminal (ported from `mulmoterminal`): raw WS `/ws`, output
  buffer, reattach-on-reconnect, idle reaping.
- **Right panel** = GUI rendered from the MCP tool `data` field — same plugins
  (`src/plugins/*`), same `data`, new transport into them.
- **History** = Claude `.jsonl` for the transcript (`--resume`) + a separate
  persisted `data` store keyed by chat session id for GUI replay.

## Strategy: long-lived `staging` branch

`main` stays pristine; the entire migration lands on `staging`, built in
milestones where **each milestone is a fully working app** that can be tested in
isolation (not a half-wired dual path). All PRs target `staging`. **Sync
`main → staging` at every milestone boundary** so the final reconciliation is the
chat layer, not chat layer + weeks of drift. When everything works, **merge
`staging → main` (BIG MERGE).**

### Milestones

| M | Milestone | Why here |
|---|---|---|
| M1 | `staging` = copy of `main`; PRs target it | branch |
| M2 | **Bare terminal chat** — no roles/docker/plugins | foundation, fully tested in isolation |
| **M3** | **Plugins + GUI chat protocol** (two-panel, `data` store, history replay) | port the spike's proven pattern; permissions are terminal-native (no GUI intercept) |
| M4 | **Docker** sandbox (`pty.spawn docker -it`, reuse arg builder) | low-risk, mechanical |
| M5 | **One-shots** rerouted through `startChat` | needs M3's terminal-backed `startChat` |
| M6 | `spawnBackgroundChat` terminal-backed + **mobile pure-input** | |
| M7 | Final sweep (`fake-echo`/e2e rework, `grep '-p'` == 0) → **BIG MERGE** | |

**M2 — Bare terminal chat.** Out: `claude-code.ts` headless backend, stream-json
transcript parsing, chat-bubble UI, `--mcp-config`/plugin wiring, roles,
`--permission-prompt-tool`. In: PTY server (raw WS `/ws`, buffer/reattach/reap),
`Terminal.vue`, `.jsonl`-based session list, `--settings` hooks for
working/waiting. Result: `mulmoterminal` embedded in MulmoClaude's shell —
interactive `claude` in the workspace, no right panel. **Test bar:** start/resume
sessions, sidebar lists `.jsonl` sessions, activity dots from hooks, reconnect.

**M3 — Plugins + GUI chat protocol** (port the pattern proven by the
`mulmoterminal` spike). Restore `--mcp-config`, the GUI plugins, the unified
two-panel layout, the `data` store keyed by session, and history replay. **No
permission-intercept work** — permissions are terminal-native (see Decisions), so
`handlePermission`, `--permission-prompt-tool`, and the
`AskUserQuestion → presentForm` redirect are **dropped, not ported**. The spike
already validated this milestone's core end-to-end against a real interactive
`claude`, so M3 carries no open risk.

**M4 — Docker.** `pty.spawn("docker", [...buildDockerSpawnArgs, "-t"])` →
`docker run -it`. node-pty supplies the host TTY; `-t` allocates the container
TTY and proxies. **`buildDockerSpawnArgs` reused unchanged** — every mount
(`.claude`, `.claude.json`, workspace), `host.docker.internal` callback, and
`--user`/`--cap-drop ALL` posture is TTY-agnostic. Add resize propagation
(`pty.resize` → container SIGWINCH). Safe first step: `docker run -it --rm` per
session (mirrors today). Later optimization: one long-lived container +
`docker exec -it`.

**M5 — One-shots.** Each of `runClaudeCli` / `defaultSummarize` /
`defaultTranslateBatch` is reimplemented to **reroute through `startChat`**: a
worker writes its result to disk and finishes silently; the caller awaits the
file. Same DI seam, new implementation — call sites untouched. Watch the
latency/concurrency cost (see risks).

**M6 — Background + mobile.** `spawnBackgroundChat` becomes terminal-backed,
visible, **no bold completion notification**. Mobile = **pure input**: always
starts a new chat session, no response rendered back. **Permission policy for
terminal-less sessions:** a fully hidden worker (`hidden=true`) or an autonomous
mobile-spawned session has no terminal for anyone to answer a permission prompt,
so it must run with **pre-authorized tools** (broad `--allowedTools` / a
permissive settings profile) and never stop to ask. Sessions a human will open
(foreground, visible background) simply let the prompt wait in their terminal.

**M7 — Final sweep.** Remove the `-p` backend, rework `fake-echo` + event-based
e2e for the terminal world, flip any flag default, delete dead code, confirm the
grep is zero, then **BIG MERGE → main**.

## Decisions made

- **Drop "roles" entirely.** All MCP/plugins are always available; remove
  role-scoping and role-switch RPCs.
- **Unify view modes** into one two-panel layout (left terminal, right GUI).
- **One-shots reroute through `startChat`** (not eliminated).
- **GUI validated early** — M3 precedes M4 (docker) deliberately.
- **Permissions are terminal-native.** Don't intercept permission prompts into
  the GUI — Claude's native "May I?" renders in the real terminal and the user
  answers there. Drops `handlePermission`, `--permission-prompt-tool`, and the
  `AskUserQuestion → presentForm` redirect. Terminal-less sessions (hidden
  workers, autonomous mobile) instead run with pre-authorized tools (see M6).
- **Telegram/CLI bridges: out of scope this round** (see risks) — so "zero `-p`"
  is the gate for chat + the three one-shots, with bridges handled separately.

## Open risks

- **R1 — permissions in interactive mode — RESOLVED by decision.** Rather than
  probe whether `--permission-prompt-tool` fires interactively, we chose
  **terminal-native permissions** outright (see Decisions). What remains is a
  *policy*, not a risk: terminal-less sessions (hidden workers, autonomous
  mobile) need pre-authorized tools (M6).
- **One-shot reroute cost.** A full `claude` session per call is heavier than a
  headless one-shot; `memory/migrate.ts` runs many classifies in parallel
  (`classifyInParallel`). Bound concurrency; consider keeping the cheapest ones
  (titles) lightweight.
- **Test rework.** `fake-echo` backend and event-based e2e assume the headless
  stream. M7 needs a terminal-world testing strategy.
- **Bridges deferred.** Telegram/CLI consume `AgentEvent`s from the stream;
  eliminating `-p` breaks their current mechanism. Out of scope now, but tracked
  — true "zero `-p`" repo-wide isn't met until they're reworked or dropped.

## Out of scope

Bridges (this round), alternative backends (Ollama/Gemini), mobile beyond
pure-input, durable multi-device GUI sync. No `main` changes until the BIG MERGE.

## Dependencies

- **`mulmoterminal` GUI-protocol spike** (`mulmoterminal/docs/gui-protocol-spike.md`)
  — Phase I `presentMarkdown` (one-way) and Phase II `presentForm` (round-trip),
  both **validated against a real interactive `claude`**. Produces the reference
  implementation M3 ports; permissions decided terminal-native there too.
- Existing **`LLMBackend` abstraction** (`server/agent/backend/`) and the
  **DI'd one-shot seams** — the levers that keep call sites untouched.
