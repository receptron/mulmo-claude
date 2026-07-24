# fix #1596 — `isTestEnv` misdetects any path containing "test"

## Problem

`server/workspace/paths.ts` computes `isTestEnv` with a **substring** match on
`process.argv`:

```js
process.argv.some((arg) => arg.includes("test"))
```

`yarn dev` → `tsx server/index.ts` puts the worktree's absolute tsx path in
`process.argv` (e.g. `.../worktrees/e2e-live-docker-test-fixes/node_modules/.bin/tsx`).
When the path contains `test` as a substring, `isTestEnv` flips to `true`, so
`workspacePath` resolves to `tmpdir/mulmoclaude-test` instead of `~/mulmoclaude`.
The server writes its session token there, while `vite.config.ts` reads
`~/mulmoclaude/.session-token` → token mismatch → **every `/api/*` returns 401**
and the app loads nothing.

## Root cause

Substring `includes("test")` on argv elements. The real test signals are
exact-element / flag matches, not "the string `test` appears somewhere in a
file path".

## Verified test-runner signals (measured, Node 24 + tsx)

- `tsx --test` (unit): `--test` is consumed by tsx and appears in **neither**
  `process.argv` nor `process.execArgv`. The only reliable signal is
  `process.env.NODE_TEST_CONTEXT` (= `"child-v8"` in the isolated child).
- `node --test`: `--test` in `process.execArgv`.
- `playwright test` (e2e): exact `"test"` element in `process.argv`.
- e2e-live does **not** rely on `isTestEnv` at all — it injects
  `MULMOCLAUDE_WORKSPACE_PATH`, which takes precedence over the whole expression.

## Fix

Extract the detection into a pure, testable function and use exact matches:

```ts
export const detectTestEnv = (argv, execArgv, env) =>
  env.NODE_ENV === "test" ||
  execArgv.includes("--test") ||   // node --test
  argv.includes("--test") ||       // --test as an argv flag
  argv.includes("test") ||         // playwright / vitest `test` subcommand
  typeof env.NODE_TEST_CONTEXT !== "undefined";

export const isTestEnv = detectTestEnv(process.argv, process.execArgv, process.env);
```

Taking `(argv, execArgv, env)` as parameters is what makes the bug testable:
the current shape test can't reproduce it because the test process itself runs
under `NODE_TEST_CONTEXT`. With the pure function we can feed the exact failing
argv from the issue and assert `false`.

## Files

- `server/workspace/paths.ts` — substring → exact, via `detectTestEnv`.
- `test/workspace/test_paths_shape.ts` — drop the re-derived mirror of the
  expression (import the real `isTestEnv`); add `detectTestEnv` regression tests
  covering the #1596 failing input plus every positive signal.

## Verification

- `yarn test` (unit) → `isTestEnv` stays `true` (temp workspace) via `NODE_TEST_CONTEXT`.
- New `detectTestEnv` test: `.../e2e-live-docker-test-fixes/.../tsx` argv → `false`.
- `yarn typecheck` / `yarn build` green.
