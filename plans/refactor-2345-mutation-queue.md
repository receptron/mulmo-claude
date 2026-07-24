# refactor: extract the mutation-serialisation queue and the markdown blob POST from the composables

Issue: #2344

> The branch and this filename say `2345` — that number was a mistake made
> when the work was handed out and was kept so the branch, plan and PR
> agree. The issue this closes is **#2344**; #2345 is the unrelated
> `remoteView` mobile-target guard (shipped separately as PR #2363).

## Context

`jscpd` flagged two clones between frontend composables.

### 1. `mutationChain` + `enqueue<T>()` — `useShortcuts.ts` / `useDashboard.ts`

Both stores own the whole list (pinned shortcuts) / layout (dashboard
tiles + row heights) on the client and persist it with a **replace-all
PUT**. Both therefore declare a byte-identical serialisation queue:

```ts
let mutationChain: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(task, task);
  mutationChain = run.then(() => undefined, () => undefined);
  return run;
}
```

Only `useShortcuts.ts` explains what the serialisation buys:

- two in-flight replace-all PUTs can land out of order and resurrect a
  removed pin or drop a newly added one — both in the UI and on disk;
- the cold-load race: each task awaits `load()` first, so the server list
  is in the ref before any task reads its `previous` snapshot. Without
  it, a click during the boot GET persists `[]` + the new item and wipes
  everything already stored.

`useDashboard.ts` only says "the same race `useShortcuts` guards
against" — one file's correctness silently depends on the other's
implementation. Neither race reproduces on demand, so the reasoning has
to live with the code.

### 2. The blob-download POST — `useMarkdownZip.ts` / `usePdfDownload.ts`

Both send the same `apiFetchRaw` request — same method, same
`Content-Type`, same body `{ markdown, filename, baseDir,
stripFrontmatter, marp }` — to two different render endpoints, and both
declare their own copy of the identical 3-field options interface
(`DownloadPdfOptions`, `DownloadMarkdownZipOptions`).

## What changes

### A. `src/utils/mutationQueue.ts`

```ts
createMutationQueue(): { enqueue: <T>(task: () => Promise<T>) => Promise<T> }
```

Closure over the chain instead of a module-level `let`, so each store
gets its own independent queue (the current behaviour) and the invariant
has one implementation. The full WHY — both races, and why a rejected
task must not stop the queue — moves onto this module.

Both composables replace their local `mutationChain` / `enqueue` with
`const { enqueue } = createMutationQueue();` at module scope. Nothing
else in either store changes.

### B. `src/utils/markdownBlobRequest.ts`

```ts
postMarkdownForBlob(route, markdown, filename, options): Promise<Response>
MarkdownRenderOptions  // baseDir / stripFrontmatter / marp, documented once
```

Returns the raw `Response` — it does **not** check `response.ok` and does
not catch. The two callers handle failure deliberately differently and
that difference is preserved verbatim:

| caller             | non-OK response                                          | thrown error                    |
| ------------------ | -------------------------------------------------------- | ------------------------------- |
| `useMarkdownZip`   | `zipFailed = true` (raw server body never surfaced)      | `zipFailed = true`              |
| `usePdfDownload`   | `pdfError = "PDF error ${status}: ${await res.text()}"`   | `pdfError = errorMessage(err)`  |

Only the request construction is shared. `DownloadPdfOptions` and
`DownloadMarkdownZipOptions` (identical shapes, no importers outside
their own file) collapse into `MarkdownRenderOptions`; the richer
per-field docs from `usePdfDownload` are the ones kept.

## Constraints

- Behaviour-preserving. `chain.then(task, task)` keeps the task in both
  handler slots exactly as before, so the queue drains even if the
  re-arm ever stops swallowing rejections.
- No `any`, no `as` casts.
- Error handling in the two blob callers is **not** unified.

## Tests

`test/utils/test_mutationQueue.ts` (node:test + `node:assert/strict`):

- tasks run in submission order and never overlap (descending delays, so
  concurrent execution would invert the completion order; peak
  concurrency asserted to be 1);
- a task that rejects does not break the chain — a task queued behind it
  still runs, in order;
- the rejection still propagates to that task's own caller (identity of
  the thrown error), including a synchronous throw;
- the queue keeps ordering across several tasks after a rejection;
- a task enqueued after the queue drained still runs;
- two queues are independent: one blocked on an unresolved promise does
  not hold up the other.

Mutation check: replacing `chain.then(task, task)` with `task()` (run
immediately, no chaining) must turn the ordering test red.
