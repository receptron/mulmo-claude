# Server Logging Audit (#779)

Snapshot taken 2026-04-25 from the branch landing this PR. Counts are `grep -c "log\."` against each file at HEAD; per-call-site quality is read by hand. "Coverage" categorises the file holistically:

- **good** — entry, success, every catch logs at the right level; PII discipline observed.
- **partial** — some handlers logged, others silent; or catch-blocks log but entry is missing.
- **none** — zero `log.*` calls.

"This-PR" = covered by the PR landing this audit. "Followup" = tracked as a discrete follow-up issue.

## Server route handlers (`server/api/routes/*.ts`)

| File | Calls | Coverage | Gaps | Plan |
|---|---:|---|---|---|
| `agent.ts` | 8 | good | request received, completion, retry, tool-call, errors all covered | leave |
| `chart.ts` | 0 | none | every handler silent | followup |
| `chat-index.ts` | 3 | partial | entry + a couple of failures; some handlers silent | followup |
| `config.ts` | 0 | none | settings / mcp.json read+write silent | followup |
| `dispatchResponse.ts` | 0 | n/a | utility, not a route — covered by callers | leave |
| `files.ts` | 0 | none | tree / dir / content / raw all silent on failure | followup (high — file IO is core) |
| `html.ts` | 0 | none | generate / edit / present silent | followup |
| `image.ts` | 11 | good | landed in #780; #783 migrated prompt logging from `previewSnippet` to `promptMeta` (sha256 fingerprint) | leave |
| `mulmoScriptValidate.ts` | 0 | none | validation handler silent | followup (low — validation, not state mutation) |
| `mulmo-script.ts` | 3 | partial | save, render, generate-movie — covers some, misses others | followup |
| `notifications.ts` | 1 | partial | scheduling logged, but the action / kind context lost | followup (low) |
| `pdf.ts` | 5 | good | render path covered | leave |
| `plugins.ts` | 0 | none | every present-* handler silent | followup |
| `presentHtml.ts` | 0 | none | silent | followup |
| `roles.ts` | 0 | none | silent | followup |
| `scheduler.ts` | partial → good (this PR) | good | every action handler now logs entry + success + validation warns + error | **THIS PR** ✅ |
| `schedulerHandlers.ts` | 0 | none | every handler silent | followup |
| `schedulerTasks.ts` | partial → good (this PR) | good | list / create / update / delete / run / logs all log entry + success; validation warns on bad input; not-found warns on missing taskId; error catches surround all I/O paths | **THIS PR** ✅ |
| `sessions.ts` | 0 | none | list / detail / mark-read silent | followup |
| `sessionsCursor.ts` | 0 | none | cursor advance silent | followup |
| `skills.ts` | 3 | partial | create / update / delete partly covered | followup |
| `sources.ts` | 12 | good | register, delete, rebuild, manage all logged | leave |
| `todos.ts` | 0 | none | dispatch + items + columns all silent | followup (high — visible to users) |
| `todosColumnsHandlers.ts` | 0 | none | silent | followup |
| `todosHandlers.ts` | 0 | none | silent | followup |
| `todosItemsHandlers.ts` | 0 | none | silent | followup |
| `wiki.ts` | none → good (this PR) | good | GET + POST handlers log entry + success + page-not-found warn + uncaught throw error; every action covered | **THIS PR** ✅ |

## Server workspace utilities

| File | Calls | Coverage | Plan |
|---|---:|---|---|
| `workspace/sources/pipeline/dedup.ts` | 0 | none | followup — small pure helper; entry log lives in `pipeline/index.ts` |
| `workspace/sources/pipeline/fetch.ts` | none → good (this PR) | good | per-source debug start/ok + warn on missing fetcher / fetcher throw | **THIS PR** ✅ |
| `workspace/sources/pipeline/index.ts` | partial → good (this PR) | good | start, registry-loaded, planned, fetched (with per-failure warns), deduped, wrote, done — full stage trace | **THIS PR** ✅ |
| `workspace/sources/pipeline/notify.ts` | 0 | none | followup — score+publish trace |
| `workspace/sources/pipeline/plan.ts` | 0 | none | followup — small filter, summarised by `index.ts` |
| `workspace/sources/pipeline/summarize.ts` | 0 | none | followup — bytes in / out (uses claude CLI, prompt would need promptMeta) |
| `workspace/sources/pipeline/write.ts` | 0 | none | followup — covered partially by `pipeline/index.ts` "wrote" line |
| `workspace/sources/interests.ts` | 1 | partial | leave (read-only profile load) |
| `workspace/sources/registry.ts` | 1 | partial | followup (storage layer) |
| `workspace/journal/dailyPass.ts` | 12 | good | leave |
| `workspace/journal/index.ts` | 10 | good | leave |
| `workspace/journal/memoryExtractor.ts` | 3 | partial | followup |
| `workspace/journal/optimizationPass.ts` | 3 | partial | followup |
| `workspace/journal/diff.ts` | 1 | partial | followup |
| `workspace/journal/archivist.ts` | 1 | partial | followup |
| `workspace/journal/state.ts` | 0 | none | followup (state read-only) |
| `workspace/journal/indexFile.ts` | 0 | none | followup |
| `workspace/journal/linkRewrite.ts` | 0 | none | followup (low — pure transformer) |
| `workspace/journal/paths.ts` | 0 | none | leave (path constants only, no IO) |

## External SDK call sites

| Wrapper | Calls | Plan |
|---|---:|---|
| `server/utils/gemini.ts` | 3 | leave (#780) |
| Claude Agent SDK invocation in `server/agent/index.ts` | partial | followup — verify spawn / abort / parse paths |
| `server/agent/mcp-tools/x.ts` (X / Twitter API) | 0 | followup |
| `server/agent/mcp-tools/index.ts` (dispatch only) | 0 | n/a |

## MCP tool plugins (`src/plugins/*/index.ts` + companion server routes)

These are layered: the plugin runs client-side, but most call back into a server route via `apiPost`. Where the route is silent, so is the plugin. Coverage = the route's coverage.

Skipping this section for the PR-1 audit pass; the route-level table above already pinpoints the gap. A follow-up issue per plugin grouping (e.g. "todo + spreadsheet route logging") will revisit.

## Bridge packages (`packages/bridges/*`)

Out of scope. Each bridge has its own logger and conventions. Tracked separately as the bridge work re-converges (see #729 and the Slack work).

## Logging-runtime concerns (separate issue)

- **Test output bleeds into the dev log**: `server/system/logs/server-YYYY-MM-DD.log` ends up dominated by `yarn test` output. The dev server's real logs are hard to find. Suggested fix: `LOG_FILE_DIR` env override + a NULL sink for the test runner. **Not** in this PR — file as a discrete issue.
- **Log rotation / retention**: not yet defined. Currently: one file per UTC date, no compression, no purge. Out of scope.

## Helpers in play

| Helper | Use for | Output shape |
|---|---|---|
| `server/utils/promptMeta.ts` (`promptMeta`) | freeform user-supplied prompts, search queries, pasted text | `{ length, sha256: <12-hex prefix> }` — no content, fingerprint only. Migrated #780 → #783. |
| `server/utils/logPreview.ts` (`previewSnippet`) | identifier-shaped fields with grep value (slug, page name, action verb) | first 120 chars + `…` |

Choose `promptMeta` for anything a user pastes; `previewSnippet` for anything they pick from a closed set or type as a deliberate identifier. When in doubt, `promptMeta` is the safer default — it can't leak a fragment of an API key by accident.

## Pattern (replicated from #780)

```ts
import { log } from "../../system/logger/index.js";
import { previewSnippet } from "../../utils/logPreview.js";
import { errorMessage } from "../../utils/errors.js";

router.post(API_ROUTES.feature.action, async (req, res) => {
  const { input, sessionId } = req.body;
  if (!input) {
    log.warn("feature", "action: missing input", { sessionId });
    return badRequest(res, "input is required");
  }
  log.info("feature", "action: start", { inputPreview: previewSnippet(input), sessionId });
  try {
    const result = await someExternalCall(input);
    if (!result.data) {
      log.warn("feature", "action: external returned no data", { inputPreview: previewSnippet(input), sessionId });
    } else {
      log.info("feature", "action: ok", { inputPreview: previewSnippet(input), sessionId, bytes: result.data.length });
    }
    res.json(result);
  } catch (err) {
    log.error("feature", "action: call threw", { inputPreview: previewSnippet(input), sessionId, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});
```

Rules summarised:

| Level | When |
|---|---|
| `info` | entry (after input validation) and success (with byte/count summary) |
| `warn` | external SDK / fetch returned no useful data, recoverable |
| `error` | we threw — internal inconsistency, missing file, parse failure |
| `debug` | only inside SDK wrappers, for request/response shape — never inside route files |

Never log: API keys, bearer tokens, cookies, full prompts, full markdown bodies, absolute paths that include `/Users/<name>`. Use `previewSnippet` (120-char cap) and workspace-relative paths.

## Follow-up issues to file once this PR lands

(Will be filed by the PR author after merge; placed here so they're not forgotten.)

1. **Files / Wiki / Todo route logging** — `files.ts`, `todos*.ts`. High priority — user-visible.
2. **Sessions / config / roles route logging** — `sessions.ts`, `sessionsCursor.ts`, `config.ts`, `roles.ts`. Medium.
3. **Plugin server route logging** — `plugins.ts`, `chart.ts`, `html.ts`, `presentHtml.ts`, `mulmoScriptValidate.ts`, `mulmo-script.ts`. Medium.
4. **Scheduler-handler / chat-index gap-fill** — `schedulerHandlers.ts`, `chat-index.ts`, `skills.ts` (partial → good). Low.
5. **MCP tool handler logging** — `server/agent/mcp-tools/x.ts` and any new ones. Medium.
6. **Journal partial → good** — `memoryExtractor.ts`, `optimizationPass.ts`, `diff.ts`, `archivist.ts`, `state.ts`. Low.
7. **`LOG_FILE_DIR` test/dev separation** — distinct concern, distinct fix.
8. **`daily-refactoring` skill checklist update** — referenced by #779 but the skill doesn't ship with this repo (must live as a private user skill). Captured here so the operator who maintains that skill can pick it up: add a "try/catch logging missing → upgrade route to the layered template" item to its Phase 3 checklist.
