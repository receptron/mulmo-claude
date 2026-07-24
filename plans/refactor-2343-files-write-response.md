# refactor: dedup the write-request preamble and written-file response in the files routes

Issue: #2343

## Context

`jscpd` flagged two blocks (#400 / #280, 89 + 61 tokens) between
`POST /api/files/create` and `PUT /api/files/content` in
`server/api/routes/files.ts`. Both handlers wrap their own middle
(path resolution + write) in the same preamble and the same tail:

**Preamble** — validate body → `log.warn` + `badRequest` on rejection →
destructure `{ relPath, content, bytes }` → `log.info("<label>: start")`.

**Tail** — `statSafeAsync(absPath)` → `log.info("<label>: ok")` →
`publishFileChange(relPath)` → `res.json({ path, size, modifiedMs })`.

Only the write itself differs (`resolveNewFilePath` + `performCreateWrite`
vs `resolveExistingTextFile` + `writeFileContent`) plus the log label.

## Why it matters

The tail contains `void publishFileChange(relPath)`. That call drives
View-tab cache-busting for subscribed browsers **and** the memory
topic-index regeneration side-effect (#1032). A future third write route
that forgets it produces a "saved but the screen never updated" bug —
no error, no failing request, and hard to reproduce because it only
shows up with a live subscriber. Making the response *the* way a write
route replies makes forgetting the publish structurally impossible.

## What changes

New `server/api/routes/filesWriteResponse.ts`:

```ts
validateWriteRequestOr400(body, res, logLabel): WriteRequestInputs | null
respondWithWrittenFile(res, { absPath, relPath, fallbackBytes, logLabel }, deps?)
```

- `logLabel` is a parameter (`"POST create"` / `"PUT content"`) — the two
  handlers keep their distinct log lines rather than being unified.
- `deps` (`{ stat, publish, now }`) defaults to the real
  `statSafeAsync` / `publishFileChange` / `Date.now`, mirroring the
  `defaultUploadWriteDeps` seam already in `files.ts`, so the builder is
  testable without touching the filesystem or the pub-sub bus.
- `WriteContentResponse` moves into the new module; `files.ts` imports it.

Both handlers lose ~16 lines of preamble/tail each.

## Constraints

- The response JSON shape (`path` / `size` / `modifiedMs`) is an API
  contract consumed by the Files UI. Unchanged.
- The `stat` fallbacks stay exactly `fresh?.size ?? fallbackBytes` and
  `fresh?.mtimeMs ?? Date.now()` (stat can fail right after a successful
  write — e.g. the file is removed by another process — and the request
  still has to answer with the size we intended to write).
- `size` is computed once and used for **both** the log line and the
  response body, matching today's behaviour in both handlers.
- The rejection log message keeps coming from
  `validatePutContentRequest` (`"PUT content: missing path"` …), *not*
  from `logLabel`. `POST create` already logs those strings today;
  deriving them from the label would change the create route's log text.

## Not changed: `POST /api/files/upload`

The upload handler's tail is the same four steps and the same response
object, but its `log.info("POST upload: ok")` reports
`bytes: bytes.byteLength` — the decoded upload size — where create/put
report `fresh?.size ?? contentBytes`. Adopting the helper there would
change what that log line reports (identical in every normal case, but
not by construction). Left as-is deliberately; the helper is available
if a reviewer wants the log lines unified in a follow-up.

## Tests

`test/routes/test_filesWriteResponse.ts` (node:test + `node:assert/strict`,
mirroring `test_dispatchResponse.ts`'s recorded-Response mock):

- stat returns a size → `size` / `modifiedMs` come from stat, not the
  fallbacks (including the wiki case where frontmatter makes the on-disk
  size larger than the submitted content)
- stat returns `null` → **both** fallbacks fire (`fallbackBytes`, injected `now()`)
- zero-byte content → `size: 0` survives (`??` must not treat 0 as absent),
  both when stat reports 0 and when stat is null; `mtimeMs: 0` likewise
- `publish` invoked exactly once per successful write, with the rel path,
  and **before** `res.json` so a subscriber can't miss the write
- preamble: valid body returns the narrowed inputs (utf-8 byte count),
  empty content is legal, and each rejection (missing path, missing
  content, `null` body, over the 1 MB cap) writes 400 and returns `null`

Mutation check: deleting the `publish` call must turn the
"invoked exactly once" tests red.
