# server/ DRY refactor — low-risk batch

Closes the low-risk recommendations from the audit in
receptron/mulmoclaude#136. The medium-risk
mulmo-script handler scaffolding (#1 in the audit) is **out of scope**
and will be a follow-up PR.

## What ships in this PR

In suggested order — each is its own commit on this branch.

### 1. `server/utils/fs.ts` (audit #7) + security fix

Promote the workspace-fs helpers out of `routes/files.ts`:

- `statSafe(absPath): fs.Stats | null`
- `readDirSafe(absPath): fs.Dirent[]`
- `readTextOrNull(file): Promise<string | null>`
- `resolveWithinRoot(rootReal, relPath): string | null`

`resolveWithinRoot` is the realpath-based path-traversal check that
already lives in `routes/files.ts:105-130`. Move it; then adopt it in
**`routes/mulmo-script.ts:219-230` (`resolveStoryPath`)** and
**`routes/sessions.ts:187-194`** which both currently use a weaker
`path.resolve` + `startsWith` check that a malicious symlink under
`stories/` could bypass.

`routes/files.ts` keeps a thin `resolveSafe` wrapper that adds the
hidden-dir (`.git`) traversal check on top of `resolveWithinRoot`.

`journal/dailyPass.ts` already has its own `readTextOrNull` (lines
503-509); replace it with the shared one.

### 2. `server/utils/errors.ts` (audit #6)

Promote `err instanceof Error ? err.message : String(err)` to
`errorMessage(err)`. 14 sites across 9 files. Adopt in:

- `routes/files.ts` (×2)
- `routes/presentHtml.ts`
- `routes/html.ts` (×2)
- `routes/mulmo-script.ts` (delete the local copy at line 214)
- `routes/pdf.ts`
- `routes/image.ts` (×2)
- `chat-index/summarizer.ts`
- `mcp-tools/index.ts`
- `mcp-tools/x.ts` (×3)

### 3. `routes/plugins.ts` `wrapPluginExecute` (audit #2)

Collapse 7 `try { res.json(await executeX(null, body)) } catch (e) {
res.status(500).json({ message: String(e) }) }` handlers into:

```typescript
const wrapPluginExecute =
  <T>(executeFn: (..._: never[]) => Promise<T>) =>
  async (req: Request, res: Response<T | PluginErrorResponse>) => { ... };
```

Each handler becomes one line.

### 4. `routes/files.ts` shared validation preamble (audit #5)

Extract the 17-line clone (`/files/content` and `/files/raw` both do
relPath → resolveSafe → statSafe → isFile-check) into a helper
`resolveAndStatFile(req, res): { absPath, stat } | null`.

### 5. `server/mcp-server.ts` `postJson` helper (audit #3)

Replace 6 raw `fetch(url, { method: "POST", headers: {...}, body:
JSON.stringify(...) })` calls with one `postJson(path, body)` closure
capturing `BASE_URL` + `SESSION_ID`.

### 6. Gemini image-generation helper (audit #4)

`server/utils/gemini.ts` already exports `getGeminiClient`. Add
`generateGeminiImage(prompt, opts?)` that wraps the
`generateContent` + `parts.find(inlineData)` boilerplate. Three
copies in `routes/image.ts:43`, `routes/image.ts:119`, and
`routes/plugins.ts:22` collapse to one call site each.

### 7. Dispatcher plumbing for todos/scheduler (audit #8)

`routes/todos.ts:55-82` and `routes/scheduler.ts:52-83` both translate
a `{ kind: "error" | "success", ... }` dispatch result into HTTP.
Extract `respondWithDispatchResult(res, result, opts)` taking
`{ instructions, persist }` to capture the per-route differences
(todos has a `READ_ONLY_ACTIONS` set, scheduler has `action !== "show"`).

Both routes are covered by `test/routes/test_todosHandlers.ts` and
`test/routes/test_schedulerHandlers.ts` so the refactor is verifiable.

### 8. `appendOrCreate` in `dailyPass.ts` (audit #9)

`applyTopicUpdate`'s `create` and `append` branches at
`journal/dailyPass.ts:521-560` both end with the same "if existing is
null write fresh, else write trimmed + append" sequence. Collapse
into one helper. Test-covered.

## Out of scope

- **Audit #1** (`mulmo-script.ts` handler scaffolding) — biggest payoff
  but medium risk. Saved for a follow-up PR once the small utilities
  in this batch land.
- Migrating `journal/index.ts`, `journal/state.ts`,
  `journal/optimizationPass.ts` to the new `fs.ts` helpers — those
  call sites use `fsp` (async `node:fs/promises`) and the helpers
  exposed here are sync. Would need an async variant; defer until
  there's an actual reason.
- Broader adoption of `loadJsonFile` / `saveJsonFile` outside todos
  and scheduler. Mentioned in the audit as under-used; deferred.

## Verification

After every commit:

- `yarn format`
- `yarn lint` (must report 0 errors)
- `yarn typecheck`
- `yarn build`
- `yarn test` (must stay at 567/567 pass)

The dispatcher and `appendOrCreate` refactors have direct unit-test
coverage; the others are mechanical and rely on type-checking +
manual smoke testing.
