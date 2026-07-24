# fix(collections): guard prototype-key field pointers (#2318) and where lookups (#2323)

## Problem

Two sites in `packages/core/src/collection/core` read a property (or test
membership) on a plain object with a **user/LLM-controlled key** using a bare
index access. A bare `obj[key]` reaches inherited `Object.prototype` members
(`constructor`, `__proto__`, `toString`, `hasOwnProperty`), so a schema pointer
like `completionField: "constructor"` resolves to the `Object` function instead
of "no such field". The bogus value is truthy and plausible (`Object.name` is
`"Object"`, `Object.length` is `1`), so validations pass and runtime comparisons
misfire — silently, with no exception.

This is the same bug family as #2314 (fixed), #2320 (fixed — the `params`
lookup, out of scope here), #2321 (fixed), #2324 (in progress under PR #2438,
different files). This PR handles **only** #2318 (schemaRules field pointers)
and #2323 (where lookups) and touches only those two files.

## Root-cause fix

Gate every user-key lookup on an **own-key** check and treat a prototype key as
absent / not-a-field:

- `schemaRules.ts`: add a local `declaredField(fields, name)` helper —
  `Object.hasOwn(fields, name) ? fields[name] : undefined` — and route every
  field-pointer validator through it. This also structurally ends the mixed
  discipline the issue calls out (some rules already used
  `Object.prototype.hasOwnProperty.call`, others bare index).
- `where.ts`: add a local generic `ownProp(obj, key)` helper and route the three
  user-key reads (`recordsById[refRecord]`, the target field, and
  `record[cond.field]`) through it.

`declaredField` / `ownProp` only ever return a NARROWER result (undefined
instead of an inherited member), so a proto key flips from a false-positive to
correctly-rejected; no valid schema/record loses acceptance. A field literally
named `toString` (an OWN key) still resolves.

Scope note: `mutateParamRefsAreDeclared` in the same file reads `params` (not
`fields`) and is owned by the already-closed #2320 — left untouched.

## Matrix (issue × site × symptom × fix)

| Issue | File / function | User-controlled key | Symptom if a proto key is passed | Fix |
|---|---|---|---|---|
| #2318 | `schemaRules.ts` `namesStoredField` (mutate `set`, googleCalendar map) | key name | `set: { constructor: … }` / `map: { toString: … }` validates → stray write / dropped sync | `declaredField` |
| #2318 | `currencyFieldRefsNameCodeFields` | `currencyField` | `"constructor"` passes → currency mislabels at render | `declaredField` |
| #2318 | `completionPairIsCoherent` / `completionFieldIsDeclared` | `completionField` | `"constructor"` validates → completion bell reads `item["constructor"]` (always a fn) → never rings/clears | `declaredField` |
| #2318 | `completionFlagReadsOnlyStoredFields` | flag `where` field / `valueFrom.field` | proto key treated as a stored field | `declaredField` |
| #2318 | `displayFieldIsDeclared` | `displayField` | `"constructor"` validates → label reads a function | `declaredField` |
| #2318 | `fieldVisibilityGatesNameDeclaredFields` | field `when.field` | proto gate "declared" → visibility gate never/always | `declaredField` |
| #2318 | `flagConditionsNameDeclaredFields` | flag `where` field / `valueFrom.field` | proto key passes "names a field" | `declaredField` |
| #2318 | `embedIdFieldsNameIdBearingFields` | embed `idField` | proto key passes then reads a fn as an id | `declaredField` |
| #2318 | `togglesProjectValidEnums` | toggle `field` | proto key → `(fn).type` misread | `declaredField` |
| #2318 | `triggerFieldIsADateField` | `triggerField` | proto key type-probe | `declaredField` |
| #2318 | `spawnWhenFieldIsDeclared` / `spawnCarryEntriesAreDeclared` | `spawn.when.field` / `spawn.carry[]` | `"constructor"` validates → spawn predicate/carry over a fn | `declaredField` |
| #2318 | `flagCompletionSpawnDeclaresWhen` | `completionField` | proto key type-probe | `declaredField` |
| #2318 | `fieldDrivenFromFieldIsEnum` / `fieldDrivenMapCoversValues` | `spawn.every.fromField` | proto key type-probe | `declaredField` |
| #2318 | calendar (`calendarField` / `calendarEndField` / `calendarTimeField` declared + string-backed) | those pointers | `"constructor"` validates → placement reads a fn | `declaredField` |
| #2318 | `kanbanFieldIsAnEnum` | `kanbanField` | proto key type-probe | `declaredField` |
| #2318 | `notifyWhenFieldIsDeclared` | `notifyWhen.field` | `"constructor"` validates | `declaredField` |
| #2323 | `where.ts` `resolveValue` | `valueFrom.record` | `recordsById["constructor"]` → `Object` fn → `Object.name`=`"Object"` compared → "unresolved ⇒ never matches" contract broken | `ownProp` |
| #2323 | `where.ts` `resolveValue` | `valueFrom.field` | `target["toString"]` → `String(fn)` compared | `ownProp` |
| #2323 | `where.ts` `matchesCond` | `cond.field` | `record["toString"]` → not missing → row matches wrongly (dynamicIcon misfire) | `ownProp` |

## Tests (each must go red when the guard is reverted)

- `test/workspace/collections/test_schema_refine_rules.ts`: for every declared-field
  validator, add a case that a proto-key pointer (`constructor` / `__proto__` /
  `toString`) is REJECTED, plus a boundary case where an own field literally
  named `toString` is ACCEPTED.
- `test/utils/collections/test_where.ts`: proto key as `valueFrom.record`,
  `valueFrom.field`, and `cond.field` → never matches (eq false, ne false for a
  broken ref); own field named `toString`/`constructor` still compares normally.

## Verify

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, and the
collection/core tests. No package version bumps.
