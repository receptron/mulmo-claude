# Pre-Commit Review

Review ALL staged and unstaged changes against the project's coding standards before committing. This checklist covers everything the mechanical hook (`yarn format/lint/typecheck/build/test`) cannot catch.

Run `git diff --stat` and `git diff` first, then check every item below against the actual changes. Report violations with file:line references. If everything passes, say "All checks passed — ready to commit."

## 1. DRY — No Duplication

- [ ] No function or 3+ line block is copy-pasted across files. If the same logic appears twice, it MUST be extracted to a shared helper under `server/utils/` or `src/utils/`.
- [ ] Utility functions are grouped by concern: file ops → `utils/files/`, dates → `utils/date.ts`, strings → `utils/slug.ts`, JSON → `utils/json.ts`, types → `utils/types.ts`, spawn → `utils/spawn.ts`, network → `utils/fetch.ts`, markdown → `utils/markdown.ts`, IDs → `utils/id.ts`, errors → `utils/errors.ts`.
- [ ] No new `makeId()`, `isRecord()`, `formatSpawnFailure()`, `isValidSlug()`, `extractJsonObject()`, or similar that already exists in `server/utils/`.

## 2. Tests

- [ ] Every new exported function has at least one unit test (happy path + error case).
- [ ] Every new API endpoint has a route-level test in `test/routes/`.
- [ ] Every `.vue` component change that affects template bindings, event handlers, or reactive state has an E2E test or extends an existing one.
- [ ] Test files mirror source layout: `server/utils/date.ts` → `test/utils/test_date.ts`.
- [ ] Tests use `node:test` + `node:assert/strict`. External APIs are mocked — tests run without API keys.
- [ ] Test coverage includes: happy path, edge cases, boundary values, empty/null inputs, error cases.
- [ ] No test relies on hardcoded POSIX paths — use `path.join(path.sep, ...)` or `os.tmpdir()`.

## 3. Centralized Constants — No Raw String Literals

- [ ] API endpoint paths use `API_ROUTES.*` from `src/config/apiRoutes.ts` — no raw `"/api/..."` strings in server routes or client fetch calls.
- [ ] Workspace paths use `WORKSPACE_PATHS.*` / `WORKSPACE_DIRS.*` — no hardcoded `"chat"`, `"wiki"`, etc.
- [ ] Event types use `EVENT_TYPES.*` from `src/types/events.ts` — no raw `"tool_result"`, `"session_finished"`, etc.
- [ ] Tool names use `TOOL_NAMES.*` from `src/config/toolNames.ts`.
- [ ] Role IDs use `BUILTIN_ROLE_IDS.*` from `src/config/roles.ts`.
- [ ] Pub-sub channels use `sessionChannel()` / `PUBSUB_CHANNELS.*`.

## 4. TypeScript Quality

- [ ] No `as` type casts. Use type guards (`const isFoo = (x: unknown): x is Foo => ...`) or type annotations (`const x: Foo = JSON.parse(raw)`).
- [ ] No `any`. Use `unknown` + narrowing, or explicit generics.
- [ ] Express routes use Request/Response generics — not `req.body as Foo`.
- [ ] Query params validated with `typeof req.query.x === "string"`, never cast.
- [ ] `const` preferred over `let`. No `var`.
- [ ] No magic numbers — named constants with units in name (`TIMEOUT_MS`, `MAX_RETRIES`).
- [ ] Functions under 20 lines. If longer, split into smaller helpers.
- [ ] Cognitive complexity under 15 (lint threshold). Split rather than suppress.

## 5. Error Handling

- [ ] Every `fetch()` call (client and server) has try/catch for network errors AND `!response.ok` check for HTTP errors.
- [ ] Client fetch uses `apiGet`/`apiPost`/etc. from `src/utils/api.ts` — never raw `fetch("/api/...")`.
- [ ] MCP server bridge uses `postJson()` with auth header — never raw `fetch`.
- [ ] Network requests include timeout via `AbortController`.
- [ ] Error messages include context (URL, file path, operation name).
- [ ] UI surfaces fetch errors to the user via inline banners (not silent catch-and-ignore).

## 6. Cross-Platform / CI

- [ ] Paths built with `path.join()` / `path.resolve()` — never string concatenation with `/`.
- [ ] No `os.tmpdir()` for atomic writes — tmp file must be alongside the final destination.
- [ ] No case-sensitive filename assumptions (macOS/Windows are case-insensitive).
- [ ] No `chmod()` in tests without Windows guard.
- [ ] No shell-specific syntax in npm scripts (`rm -rf`, `cp`).
- [ ] Line ending comparisons use `"\n"` explicitly, or strip `\r\n`.

## 7. Vue / Frontend

- [ ] Composition API only — no Options API.
- [ ] Relative imports only — no `@/` alias paths.
- [ ] `emit` for child → parent communication — no callback props.
- [ ] `ref` preferred over `reactive`.
- [ ] No `v-html` (XSS risk).
- [ ] Interactive elements carry `data-testid` attributes.

## 8. Code Organization

- [ ] One concept per file. No generic `utils.ts` / `helpers.ts`.
- [ ] Files split at ~500 lines or when concepts diverge for parallel PRs.
- [ ] No re-export barrel files without specific justification.
- [ ] Pure logic extracted from route handlers into testable helpers.
- [ ] Discriminated-union return types preferred over null / thrown errors.
- [ ] `async/await` preferred over `.then()` chains.
- [ ] Functional array methods (`map`, `filter`, `reduce`) preferred over `for` loops.

## 9. Logging & Security

- [ ] No `console.*` outside `server/system/logger/` — use `log.{error,warn,info,debug}(prefix, msg, data?)`.
- [ ] Structured data in `data` payload, not interpolated into `msg` string.
- [ ] No user-provided content in log messages without truncation/sanitization.
- [ ] Path-traversal checks use `resolveWithinRoot()` from `server/utils/files/`.
- [ ] Sensitive files (`.env`, credentials, private keys) blocked from file API via `isSensitivePath()`.

## 10. Documentation & Plugin Checklist

- [ ] README.md updated if features/roles/commands changed.
- [ ] CLAUDE.md updated if architecture/key-files/helpers changed.
- [ ] `docs/manual-testing.md` updated if a scenario is deliberately left uncovered by E2E.
- [ ] New plugins update all required places (see Plugin Development in CLAUDE.md — 4 places for package, 8 for local).
- [ ] New endpoints added to `src/config/apiRoutes.ts` FIRST, then referenced.

## 11. Git Hygiene

- [ ] Commit message has prefix: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.
- [ ] No `git add .` or `git add <directory>` — files added individually.
- [ ] Feature branch, not committing directly to main.
- [ ] No sensitive files staged (`.env`, credentials, API keys).
- [ ] No unintended files (node_modules, .DS_Store, test-results/).

## 12. Import Style

- [ ] Top-level `import` for always-needed packages — no `await import()` unless conditional.
- [ ] No unnecessary re-exports.
- [ ] Import from the canonical location (e.g., `server/utils/slug.ts` not a re-export in `sources/paths.ts`).
