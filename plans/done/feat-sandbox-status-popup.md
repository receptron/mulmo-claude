# Sandbox status popup + explainer query (#329)

## Goal

Make the opt-in host-credential forwarding added by #327 visible in the UI so users can confirm what's actually attached to the sandbox without reading startup logs. Plus give Claude enough context to answer "what's my sandbox setup?" in chat.

## Design

### 1. New endpoint `GET /api/sandbox`

Deliberately separate from `/api/health` — health stays a minimal boot probe; sandbox state is lazy-loaded only when the popup opens.

**Return shape:**

```ts
// Sandbox disabled (no Docker, or DISABLE_SANDBOX=1):
{}

// Sandbox enabled:
{
  sshAgent: boolean,
  mounts: string[]   // e.g. ["gh", "gitconfig"] — names only
}
```

Empty object when disabled: the popup already renders a distinct "No sandbox" branch, so any extra fields would be dead pixels.

**Security posture:** payload is minimum. No host paths, no skip reasons, no unknown-name lists. All of that already lands in `server/system/logger` via the existing `log.warn` / `log.info` calls in `resolveSandboxAuth` — which is the right channel for debugging.

**Implementation location:**

- `src/config/apiRoutes.ts` — add `sandbox: "/api/sandbox"` under a new `system` group (or top-level alongside `health`; decide during implementation).
- `server/index.ts` — add the handler inline next to the `health` route (it reads the same `sandboxEnabled` module-level boolean and the env vars from `env`).
- New module `server/api/sandboxStatus.ts` — pure builder `buildSandboxStatus(params): SandboxStatus` so the handler stays thin and tests can drive the builder directly. Mirrors the pattern already used by `buildInlinedHelpFiles` / `resolveSandboxAuth`.

### 2. Lock popup rendering

Two changes in `src/components/LockStatusPopup.vue`:

1. Lazy-fetch the sandbox state when the popup opens (`watch(() => props.open, async (isOpen) => { if (isOpen && !state.value) state.value = await apiGet(...)` — cache for the session; refresh requires a page reload, same as the rest of the health data).

2. Render a new block between the existing "Sandbox enabled" paragraph and the "Test sandbox isolation:" heading:

```
Credentials attached to the sandbox:
🔑 SSH agent        forwarded   (or ✗ not forwarded)
📁 Mounted configs  gh, gitconfig   (or — none)
```

Emoji keeps it compact; no colours beyond what the rest of the popup already uses. The block is hidden when `sandboxEnabled` is false.

A fresh composable `useSandboxStatus` (sibling to `useHealth`) owns the fetch + caching. Keeps `LockStatusPopup.vue` focused on rendering.

### 3. New sample query + helps doc section

**Query entry** (added to `SANDBOX_TEST_QUERIES` in `LockStatusPopup.vue`):

> `Explain my current sandbox and credential setup`

Claude handles this with its built-in tools: `Read config/helps/sandbox.md` for conceptual background, run `whoami` / `ssh-add -l` / check env if curious about live state, then summarise. No dedicated MCP tool needed (Option 1 from the decomposition discussion).

**Helps doc update** (`server/workspace/helps/sandbox.md` — post-#323 location, copied into `~/mulmoclaude/config/helps/sandbox.md` at startup):

Add a section titled "Checking the current sandbox state" covering:

- How to read the lock-icon popup.
- What the env vars mean (`SANDBOX_SSH_AGENT_FORWARD`, `SANDBOX_MOUNT_CONFIGS`).
- How to verify from inside a chat session (Bash: `ssh-add -l`, `ls /home/node/.config/gh`, `cat /home/node/.gitconfig`).
- What info is exposed where (UI popup = minimum, server log = full detail).

This is what the sample query points Claude at.

## Non-goals

- **No copy-to-clipboard button** in the popup — discussed and rejected as MVP scope creep.
- **No structured `describeSandbox` MCP tool** — Option 2 deferred until an LLM-driven workflow actually needs it.
- **No host path exposure** via the API — log-only.
- **No live refresh** — a restart is required for env-var changes anyway, so a cache that holds for the session is fine.

## Touched files

| Layer | File | Change |
|---|---|---|
| Server | `server/api/sandboxStatus.ts` | NEW — `buildSandboxStatus` pure builder |
| Server | `server/index.ts` | mount `GET /api/sandbox` handler |
| Shared | `src/config/apiRoutes.ts` | add `sandbox` route constant |
| Client | `src/composables/useSandboxStatus.ts` | NEW — lazy fetch + cache |
| Client | `src/components/LockStatusPopup.vue` | render state block + new sample query |
| Docs | `server/workspace/helps/sandbox.md` | add "Checking the current sandbox state" section |
| Tests | `test/api/test_sandboxStatus.ts` | NEW — builder: disabled → {}, enabled variants |
| Tests | `test/components/test_LockStatusPopup.ts` | extend — state block renders / hides correctly |

Existing `test/agent/test_sandboxMounts.ts` unchanged (its concern is docker-argv generation; we're consuming a different slice of the same state).

## Implementation order

1. **Pure builder + API** — land `buildSandboxStatus` + `/api/sandbox` with tests. Small, mechanical, independently verifiable.
2. **Composable** — `useSandboxStatus`, typed against the API response. Can unit-test the cache-on-open behaviour.
3. **Popup** — wire the composable, render the state block, add the sample query.
4. **Helps doc** — write the "Checking the current sandbox state" section last, so the verification steps match what the popup actually shows.
5. **Manual verify** — run with / without Docker, with / without each env var, confirm popup + query both surface the expected info.

## Open questions

- Keep the sandbox status cached for the whole page lifetime, or re-fetch on every popup open? First is cheaper + env vars only change on restart anyway; second is friendlier if the docker daemon is stopped mid-session. Lean toward page-lifetime cache — simpler, matches `useHealth`.
- `apiRoutes.ts` grouping: the file already has small top-level entries (`health`, etc.). Add `sandbox` at top-level or create a new `system` group for both? Suggest top-level to match `health`.

## Out of scope / follow-ups

- Exposing the "what's NOT forwarded" side (host private keys, `.git-credentials`) as explicit negative rows in the popup — could be added later if users report confusion.
- Watching `docker ps` to detect sandbox going down mid-session — relevant only if the cache TTL turns out to be wrong in practice.
