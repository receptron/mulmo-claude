# fix(core): guard prototype-chain lookups that silently misbehave (#2324)

Cross-cutting bug family: `obj[key]` / `key in obj` where `key` can be a user-
or data-controlled string that collides with an `Object.prototype` member
(`__proto__`, `constructor`, `toString`, `hasOwnProperty`, …). The lookup then
returns an inherited function instead of `undefined`/`false`, so the code
misbehaves silently — a plausible wrong value, never an exception.

Fix discipline matches what the codebase already does elsewhere:
- reads → `Object.hasOwn(obj, key) ? obj[key] : <default>` (like `backlinks.ts`
  `viaMatches`, `server/services/translation/cache.ts`);
- membership → `Object.hasOwn(obj, key)` instead of `key in obj`;
- frontend (`src/`, ES2020 lib — no `Object.hasOwn`) → `Object.prototype.hasOwnProperty.call`,
  mirroring `src/plugins/metas.ts`.

Only proto keys change behavior; every normal key is preserved.

## Location matrix

| # | Location | What went wrong | Fix | Test |
|---|----------|-----------------|-----|------|
| 1 | `packages/core/src/feeds/server/pathResolver.ts` `step()` | `(current)[token.key]` returned a prototype fn, breaking the file's "any miss → undefined" contract; a fn could flow into a `naturalKey` (record filename) | `Object.hasOwn(record, token.key) ? … : undefined` | `test/feeds/test_pathResolver.ts` — proto key → undefined |
| 2 | `packages/core/src/collection/core/draft.ts` (`shouldEmitBoolean`, `rowDraftToRecord`, `draftToRecord`) | `boolOriginallyPresent[key] \|\| boolTouched[key]` always truthy for a proto-named boolean → untouched boolean written into every save | new `ownFlag()` helper: `Object.hasOwn(flags,key) && flags[key] === true`, applied to all 4 flagged reads | `test/collection/test_draft.ts` — untouched proto boolean omitted (top-level + table sub-field); real/required booleans still round-trip |
| 3a | `packages/core/src/collection/server/manageTool.ts` `projectFields` | `keys.filter((key) => key in record)` saw the prototype → a fn projected that `JSON.stringify` drops → LLM reads the field as empty | `Object.hasOwn(record, key)` | covered by 3b's sibling (identical pure pattern in `projectBacklinkRow`, exported + tested + mutation-verified) |
| 3b | `packages/core/src/collection/core/backlinks.ts` `projectBacklinkRow` | same `key in row` pattern (`viaMatches` on l.40 already used `Object.hasOwn` — discipline mismatch) | `Object.hasOwn(row, key)` | `test/collection/test_backlinks.ts` — proto display column dropped |
| 4a | `packages/core/src/collection/server/discovery.ts` `acceptParsedSchema` | `schema.fields[schema.primaryKey]` passed the first gate for a proto primaryKey → wrong "add `primary: true`" error instead of "not a declared field" | new exported `resolvePrimaryField(fields, primaryKey)` (own-property guarded) | `test/collection/test_discovery.ts` — proto primaryKey → DECLARED-FIELD reason; helper unit test |
| 4b | `packages/core/src/collection/server/manageTool.ts` `schemaDiscoveryGate` | identical bare index | reuse `resolvePrimaryField` (imported from `./discovery`) | covered by the shared helper's unit test (gate is unexported, reached only through the full tool) |
| 5 | `server/agent/sandboxMounts.ts` `resolveMountNames` | `allowed[name]` (name from env `SANDBOX_MOUNT_CONFIGS`) truthy for a proto name → skips `unknown`, later `statSync(undefined)` throws → reported as "path missing". Wrong diagnosis for a Docker-mount permission boundary | `Object.hasOwn(allowed, name) ? … : undefined` | `test/agent/test_sandboxMounts.ts` — proto name → `unknown`, not `missing` |
| 6 | `server/agent/mcp-server.ts` (l.140 + l.222) | `activeNames.map((n) => ALL_TOOLS[n]).filter(Boolean)` — a proto name resolved to a prototype fn that survived `filter(Boolean)` → bogus tool named `"Object"` in `tools/list` | extracted pure `resolveActiveTools()` (own-property guarded) in `server/agent/resolveActiveTools.ts`; both sites call it | `test/agent/test_resolveActiveTools.ts` |
| 7 | `packages/create-mulmoclaude-plugin/src/template.ts` (`LANG_INDEX` seed) | generated `value in MESSAGES` / `MESSAGES[locale]` → a proto locale matched → indexed to a fn → every UI label blank. Copied into every scaffolded plugin | seed now generates `Object.hasOwn(MESSAGES, value)` (scaffold tsconfig targets ES2022) | `packages/create-mulmoclaude-plugin/test/test_template.ts` — asserts the seed uses `Object.hasOwn`, not `in` |
| 8 | `src/plugins/metas.ts` | listed in the issue, but **already fixed** on `main` by `8afa08c81` (`ownAttribution` / `hasOwnKey`) | no change | — |
| 9 | `src/utils/markdown/wikiEmbedHandlers.ts` `amazonTldForCurrentLocale` | `AMAZON_TLDS[raw]` / `AMAZON_TLDS[lang]` returned a prototype fn for a proto locale → didn't fall to `?? "com"` → broken Amazon host | extracted pure exported `amazonTldForLocale(locale)` with a `tldFor()` guard (`hasOwnProperty.call`, ES2020 frontend lib) | `test/utils/markdown/test_wikiEmbeds.ts` — proto locale → `com` |

## Exclusion list honored (confirmed safe — NOT touched)

- `MIME_BY_EXT` / `PLUGIN_ASSET_CONTENT_TYPES` / `EXT_MIME` — dot-prefixed keys, can't collide.
- `MIME_EXT[mimeType]` — slash-required + zod MIME validation.
- `src/utils/mcp/interpolateSpec.ts` — uppercase-only placeholder regex.
- `registryIndex.ts` / `exif.ts` / `snapshot.ts` / `googleCalendar.ts` / `apiClient.ts` — type-guarded lookups.
- `src/tools/index.ts` — `Object.create(null)` + `hasOwnProperty.call` (already correct).
- `server/services/translation/cache.ts` — `Object.hasOwn` + `safeAssign` (already correct).

## Verification

Every guard was mutation-checked: reverted to the buggy form, confirmed the new
test goes red, restored. 3a and 4b are unexported and reached only through heavy
machinery — each is the identical pattern to an exported sibling/helper (3b's
`projectBacklinkRow`, 4a/4b's shared `resolvePrimaryField`) that IS unit-tested
and mutation-verified.
