# feat(auth): MULMOCLAUDE_AUTH_TOKEN server-side override

Tracks issue #316.

## Goal

Let the operator pin a fixed bearer token via the environment instead
of having one regenerated on every server startup. Specifically: honour
`MULMOCLAUDE_AUTH_TOKEN` in `generateAndWriteToken()`, matching the
name the client-side helpers (`bridges/cli/token.ts`, the Vite dev
plugin) already use.

## Why

`PR #315` (socket.io bridge) surfaced an operational quirk during
manual testing: every server restart invalidates the in-memory token
every bridge is holding. A CLI bridge — and later, Telegram / LINE /
… bridges — silently die until they're relaunched. This has always
been the behavior (since #272), but adding more bridges makes it
more visible.

Setting the same env var on both sides means the token survives
server restarts for as long as the shell / docker-compose / CI
environment holds it.

## Design

1. `server/system/env.ts` — extend the frozen `env` snapshot with
   ```ts
   authTokenOverride: process.env.MULMOCLAUDE_AUTH_TOKEN
   ```
   (stored as `string | undefined` so the default-generation code can
   do a plain truthy check). This is the "one place env vars live"
   that `docs/developer.md` already points at.

2. `server/api/auth/token.ts` — `generateAndWriteToken()` gets an optional
   second parameter `override?: string` for testability. In production
   `server/index.ts` passes `env.authTokenOverride`. Inside the
   function:
   - If `override` is a non-empty string: use it verbatim as
     `currentToken`, then write the file atomically with mode 0600.
     Emit one warning log line if the override is shorter than
     32 chars (cheap operator sanity check; we don't block startup).
   - Otherwise: existing `randomBytes(32)` path.
   - The file-write / in-memory-state path is unchanged regardless —
     the Vite plugin and the CLI bridge both read from disk by default
     (`readBridgeToken()` falls back to the file).

3. `server/index.ts` — pass `env.authTokenOverride` at the one site
   that calls `generateAndWriteToken()`. No other callers in prod
   code.

4. Tests (`test/server/test_auth_token.ts`) add:
   - override is used verbatim and written to disk
   - override does not rotate across calls (same value in, same value
     out)
   - explicit empty-string override behaves like no override
     (random-generation path)
   - unset → still random (regression guard for #272)

5. Docs — `docs/developer.md` Auth section grows an "env-var
   override" subsection calling out the tradeoff (env-var leak
   surface vs. restart pain) and the symmetry with the client-side
   override that already exists.

## Validation stance

- Non-empty check only. Same as the client-side override since #272.
- Warning log when length < 32 — operator mistake detector, not a
  hard rule.
- No charset restrictions: someone using a word-based pass-phrase
  in dev shouldn't have to hex-encode it.

## Out of scope

- Rotation while the server runs (`POST /api/auth/rotate`) — separate
  ticket.
- Client-side changes — `readBridgeToken()` and the Vite plugin
  already read the env var.
- Hard length / charset enforcement — callers who want that can wrap
  their own check around the env var before exporting.
