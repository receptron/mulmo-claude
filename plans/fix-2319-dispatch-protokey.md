# fix: guard handler-dispatch lookups against prototype keys (#2319)

Last member of the proto-key bug family (siblings: #2314, #2307, #2315, #2318,
#2324 → PR #2438, #2323 → PR #2443). Three **handler-dispatch** sites index a
plain-object lookup table with an untrusted action/method name via a bare
`table[key]`. Because `Object` is truthy AND `typeof Object === "function"`, a
key like `constructor` / `toString` / `valueOf` / `hasOwnProperty` resolves to an
inherited `Object.prototype` member and slips past the "unknown handler" guard —
then runs as if it were a registered handler. No error, no "unknown action" log:
the call "succeeds" and returns a nonsense value.

Fix discipline matches the rest of the codebase (`backlinks.ts`,
`resolveActiveTools.ts`, `sandboxMounts.ts`, `discovery.ts`): guard the read with
`Object.hasOwn(table, key) ? table[key] : undefined` before the existing
falsy/typeof check. All three sites are server / core (ES2022 lib), so
`Object.hasOwn` is available. Only proto keys change behavior; every registered
handler is preserved.

## Dispatch-site matrix

| # | Dispatch site | Reachability | Symptom (bare index) | Guard | Test |
|---|---------------|--------------|----------------------|-------|------|
| 1 | `server/api/routes/schedulerHandlers.ts` `dispatchScheduler` (`HANDLERS[action]`) | **External** — `action` = `req.body.action` (LLM tool arg / HTTP) via `scheduler.ts` | `HANDLERS["constructor"]`→`Object` (truthy) skips the 400; `Object(items,input)` returns `items`, `result.kind` undefined flows to `respondWithDispatchResult`, `shouldPersist` true → can persist broken state. `toString`→`Object.prototype.toString` returns a string. `__proto__`→`Object.prototype` (not callable) → thrown 500 instead of clean 400. | `Object.hasOwn(HANDLERS, action) ? HANDLERS[action] : undefined` | `test/routes/test_schedulerHandlers.ts` — `constructor`/`toString`/`valueOf`/`hasOwnProperty`/`__proto__` → 400 unknown; real actions still dispatch (boundary) |
| 2 | `packages/core/src/remote-host/server/hostRunner.ts` `processCommand` (`handlers[claim.method]`) | **External** — `claim.method` = the `method` field of a command doc a remote terminal writes to Firestore | proto `method` resolves to a prototype fn → skips the `unknown_method` write, runs `Object.prototype.<x>(params)`, writes a bogus "done" result back to the command doc on the remote-control channel. | extract pure `resolveCommandHandler(handlers, method)` = `Object.hasOwn(handlers, method) ? handlers[method] : undefined`; `processCommand` calls it | `packages/core/test/remote-host/test_hostRunner.ts` — proto method → undefined; registered handler returned even when named `toString` (boundary) |
| 3 | `server/plugins/runtime-loader.ts` `resolveExecute` (`carrier[definitionName]`) | plugin-controlled — `definitionName` = `TOOL_DEFINITION.name` (third-party tarball) | the existing `typeof handler !== "function"` gate is **defeated** for `constructor`/`toString`/`valueOf`/`hasOwnProperty` (all functions on `Object.prototype`): a plugin exporting no matching function gets `Object`/`Object.prototype.toString` registered and dispatch calls it, skipping the "no function exported → null → 500 log" branch. (`__proto__`→`Object.prototype`, an object, is already caught by the typeof gate.) | `Object.hasOwn(carrier, definitionName) ? carrier[definitionName] : undefined`; export `resolveExecute` for direct testing | `test/plugins/test_runtime_loader.ts` — `constructor`/`toString`/`valueOf`/`hasOwnProperty` → null; carrier owning a real `toString` fn → returned (boundary) |

## Not in scope (owned by merged siblings — NOT re-touched)

- #2438 (`fix/2324-proto-key-lookups`): backlinks / draft / discovery / manageTool /
  pathResolver / mcp-server / resolveActiveTools / sandboxMounts / wikiEmbedHandlers /
  create-mulmoclaude-plugin template. `src/tools/index.ts` already uses
  `Object.create(null)` + `hasOwnProperty.call`.
- #2443 (`fix/2318-2323-protokey-fields`): `schemaRules.ts` / `where.ts` own-key helpers.

None of those files are touched here — this PR is only the three **dispatch** sites they did not cover.

## Verification

Each guard is mutation-checked: revert to the bare index, confirm the new test
goes red, restore. For site 1 the `constructor`/`toString` cases return a wrong
object/string (assertion fails) and `__proto__` throws (test errors) on the buggy
form — all red. Site 2's lookup decision is extracted to an exported pure helper
so it is tested directly without a Firestore mock. Site 3's `resolveExecute` is
exported and tested with plain-object carriers.
