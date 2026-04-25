# feat: server-side logging audit — start with the four highest-traffic routes

Issue: [#779](https://github.com/receptron/mulmoclaude/issues/779)
Reference PR (pattern source): [#780](https://github.com/receptron/mulmoclaude/pull/780) — image generation observability.

## Problem

When a user reports "this failed with no UI feedback," the first move is `grep` over `server/system/logs/`. For 17 of 27 server route handlers there's nothing to grep — the file has zero `log.*` calls. PR #780 fixed this for image generation; everything else is still in the same silent-failure state.

## Scope of this PR (PR-1, the anchor)

1. **Audit doc** at `plans/log-audit/findings.md`. Table-format, one row per route handler / MCP tool / external SDK call site. Records:
   - Current logging coverage (none / partial / good)
   - What's missing (entry log, success log, catch-block warn/error, debug for SDK shape)
   - Priority (high / med / low) — "high" iff users currently report errors against this surface
   - Which PR covers it (this one or a follow-up issue)
2. **Layered logging on the four highest-priority routes** (matches the issue's listing):
   - `server/api/routes/wiki.ts`
   - `server/api/routes/agent.ts`
   - `server/api/routes/sources.ts` + `server/workspace/sources/pipeline/*.ts`
   - `server/api/routes/scheduler*.ts`
3. **Process docs**:
   - `daily-refactoring` skill (Phase 3) — add a "try/catch logging" item.
   - `docs/developer.md` — add an operational note: *for hard-to-reproduce error reports, start by auditing the route's log coverage*.
   - Optional `CONTRIBUTING.md` entry if one exists; otherwise developer.md is enough.
4. **Shared helpers**:
   - Extract a `previewSnippet` truncate-and-show helper into `server/utils/logPreview.ts`. Same 120-char cap as the original `previewPrompt` in `image.ts`. Used in this PR for **identifier-shaped** fields (wiki slug, page name, action verb) — places where retaining grep value matters.
   - **Also note**: while this PR was in review, PR #783 landed on main introducing a stricter `promptMeta()` (`{ length, sha256 }`) helper for freeform user prompts, and migrated `image.ts` to it. After the main-merge, `image.ts` no longer uses `previewSnippet`; new prompt logging in subsequent route follow-ups should default to `promptMeta` instead. `previewSnippet` survives for identifier-shaped fields. See `findings.md` § "Helpers in play".

## Out of scope (tracked as follow-up)

The remaining 13 lower-priority routes get a one-line entry per route in `findings.md` with a "follow-up" tag. After this PR lands, isamu (or whoever picks up #779) opens individual issues per group:

- `files.ts` / `chart.ts` / `html.ts` / `presentHtml.ts` / `mulmoScriptValidate.ts`
- `sessions.ts` / `sessionsCursor.ts` / `roles.ts` / `config.ts`
- `todos.ts` + `todos*Handlers.ts` (4 files, share one issue)
- `dispatchResponse.ts` (utility, may not need its own logging — covered by the dispatching route)
- MCP tool handlers (`server/agent/mcp-tools/*.ts`)
- Plugin server-side handlers under `src/plugins/*/index.ts`
- Bridge packages (`packages/bridges/*`)

The `LOG_FILE_DIR` test/dev separation issue called out at the bottom of #779 stays a fully separate ticket — different problem (log routing, not log content).

## Layered-logging template

Mirrors PR #780. Every covered route follows this shape:

```ts
// Top-of-file: import shared helpers
import { log } from "../../system/logger/index.js";
import { previewSnippet } from "../../utils/logPreview.js";
import { errorMessage } from "../../utils/errors.js";

// Inside each handler:
router.post(..., async (req, res) => {
  const { prompt, sessionId } = req.body;
  if (!prompt) {
    log.warn("<prefix>", "<verb>: missing prompt", { sessionId });
    return badRequest(res, "prompt is required");
  }
  log.info("<prefix>", "<verb>: start", {
    promptPreview: previewSnippet(prompt),
    sessionId,
  });
  try {
    const result = await externalCall(prompt);
    if (!result.data) {
      log.warn("<prefix>", "<verb>: external returned no data", {
        promptPreview: previewSnippet(prompt),
        sessionId,
      });
    } else {
      log.info("<prefix>", "<verb>: ok", {
        promptPreview: previewSnippet(prompt),
        sessionId,
        bytes: result.data.length,
      });
    }
    res.json(result);
  } catch (err) {
    log.error("<prefix>", "<verb>: call threw", {
      promptPreview: previewSnippet(prompt),
      sessionId,
      error: errorMessage(err),
    });
    serverError(res, errorMessage(err));
  }
});
```

Rules:

- `log.info` for entry + success.
- `log.warn` for "external SDK returned nothing useful" (recoverable; fallback message displayed to the user).
- `log.error` for "we threw" (we crashed, not the SDK refusing politely).
- `log.debug` for SDK request/response shapes — only inside the SDK wrapper, never inside the route file itself.
- **prompt preview only** via `previewSnippet` (120-char cap).
- **never log** API keys, bearer tokens, cookies, full sessions, full markdown bodies, or raw filesystem paths that include `/Users/<name>` (use the workspace-relative path).

## PII / secrets discipline

- `previewSnippet(text)` truncates at 120 chars + `…`. Use for any user-supplied freeform text (prompts, wiki bodies, search queries).
- `sessionId` is fine to log raw — it's a UUID, not user-meaningful.
- `path` arguments must be passed through `path.relative(WORKSPACE_PATHS.root, abs)` if they were absolute. Routes that already deal in slug / relative paths can log them verbatim.
- Wiki page titles and source feed titles are fine to log raw — they're chosen by the user but treated as identifiers, not secrets.

## Verification

Manual:
- `yarn dev`, hit each touched route with both happy-path and forced-failure inputs, confirm log lines land on `server/system/logs/server-YYYY-MM-DD.log`.

Automated:
- Existing tests stay green. New behaviour is observability — assert by reading the log file in a unit test would couple the test to the log format. Defer to manual inspection per the issue's intent.

## Execution order

1. Plan doc (this file) committed first.
2. `server/utils/logPreview.ts` shared helper.
3. `plans/log-audit/findings.md` — write the audit table covering all 27 routes + MCP tools + SDK call sites.
4. Add logging to the four target routes one at a time (one commit per route group), each followed by `yarn typecheck && yarn lint && yarn build`.
5. Process docs.
6. Format / lint / typecheck / build / test clean run, push, open PR.
