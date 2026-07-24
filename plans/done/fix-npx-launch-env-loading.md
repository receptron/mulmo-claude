# Fix: `npx mulmoclaude` never loads a workspace `.env` (GEMINI_API_KEY silently ignored)

Issue: https://github.com/receptron/mulmoclaude/issues/2081
Date: 2026-07-14

## Problem

Under `npx mulmoclaude`, `GEMINI_API_KEY` set in a `.env` file is never
loaded, so image/audio/movie generation fails with
`Google GenAI API key is required (GEMINI_API_KEY)` and there is no clear
diagnostic.

Root cause (verified in code):

- `bin/mulmoclaude.js` spawns the server with `cwd: PKG_DIR` and
  `env: { ...process.env, ... }` — it never loads any `.env`.
- `server/index.ts:1` is `import "dotenv/config"`, which resolves `.env`
  relative to `process.cwd()` = `PKG_DIR`. Under `npx`, `PKG_DIR` is the
  npx cache (`~/.npm/_npx/<hash>/node_modules/mulmoclaude`) — no `.env`
  there. Under a cloned repo (`npm run dev`) `PKG_DIR`/cwd is the repo
  root, so the documented flow happens to work.
- There is no Settings-UI field for the key (it is read-only from
  `process.env`), so the ONLY working path today is exporting the var in
  the shell before launch.

## Design decision (why the launch dir, not the workspace)

The MulmoClaude workspace (`server/workspace/paths.ts`) resolves to
`~/mulmoclaude` (or `$MULMOCLAUDE_WORKSPACE_PATH`) — an **isolated,
agent-managed data space** ("the workspace is the database"). Secrets
like an API key must NOT live there. Therefore the correct place for a
user's `.env` is **the directory they run `npx mulmoclaude` from**,
which is decoupled from the workspace on purpose:

- secrets / config → launch-dir `.env`
- agent-managed data → `~/mulmoclaude`

This also unifies dev and npx: in dev you launch from the repo root, so
"the directory you launch from" already means the repo root there.

## Changes

1. **`server/utils/launch-env.mjs` (+ `.d.mts`)** — new, pure/testable:
   - `parseEnvFile(path, { readFileSync?, dotenv? })` → `{ exists, parsed }`,
     never throws on a missing file.
   - `mergeLaunchEnv(baseEnv, parsed)` → `{ env, loadedKeys, skippedKeys }`;
     existing (shell) vars WIN over `.env` (dotenv's no-override
     semantics), so `export GEMINI_API_KEY=…` still takes precedence.
   Plain `.mjs` because the launcher runs before tsx is wired (same
   reason as `port.mjs` / `cli-flags.mjs`).

2. **`packages/mulmoclaude/bin/mulmoclaude.js`** — before building
   `serverEnv`, load `<launch-cwd>/.env` via the bundled `dotenv` and use
   the merged env as the base. Log the loaded key NAMES only (never
   values) + how many were overridden by the shell env.

3. **`server/index.ts` (`initBootDiagnostics`)** — emit a one-line
   startup warning when `!isGeminiAvailable()`, pointing at the launch-dir
   `.env`. Covers dev / npx / docker uniformly. (optional-but-included.)

4. **`packages/core/assets/helps/gemini.md`** — rewrite the "repository
   root `.env`" instruction to "the directory you launch MulmoClaude
   from", correct for both dev and npx. Per repo rule, editing
   `assets/helps/*` bumps `@mulmoclaude/core` (0.13.0 → 0.13.1) + the
   launcher dep range (`^0.13.0` → `^0.13.1`) + `yarn.lock`. The actual
   `npm publish` of core@0.13.1 happens later via `/publish`.

## Tests

`test/utils/test_launchEnv.ts` (node:test):
- parseEnvFile: missing file → `{ exists:false }`; present file parses.
- mergeLaunchEnv: shell var wins; new keys applied; empty parsed; keys
  reported correctly; base env not mutated.

## Out of scope

- Settings-UI field to write the key (relates to #871 web-managed
  credentials) — noted, not implemented here.
