# refactor(spreadsheet): remove duplicated handler-side argument-count checks (#2397)

## Problem

`evaluator.ts` (L296-301) already validates every function's arity against the
registry's `minArgs`/`maxArgs` **before** calling the handler:

```ts
if (func.minArgs !== undefined && args.length < func.minArgs) throw ... "requires at least N argument(s)";
if (func.maxArgs !== undefined && args.length > func.maxArgs) throw ... "accepts at most N argument(s)";
```

Yet nearly every handler starts with its own `if (args.length ... ) throw`. When
the registry `minArgs`/`maxArgs` fully expresses the valid arity, that handler
check is **unreachable dead code**, and its wording ("requires N") disagrees with
the evaluator's ("requires at least N" / "accepts at most N").

## Rule applied

- **REMOVE** the handler arg-count guard when the registry `minArgs`/`maxArgs`
  fully expresses the valid arity (exact `N` = min==max; a contiguous range
  `[min,max]`; or an open `>= min` with no max). The evaluator already rejects
  every out-of-range call with a single consistent message.
- **KEEP** the guard only when the shape is **not** expressible by `minArgs`/`maxArgs`:
  a non-contiguous constraint. In this codebase that is **only IFS** (must be an
  **even** count `>= 2`).
- **KEEP** non-arity guards untouched (empty-range checks, invalid-range-bounds
  checks) — they are not argument-count validation.

### Discrepancy with the issue text (SUMIF / AVERAGEIF)

The issue lists "SUMIF/AVERAGEIF's `2 or 3`" as an inexpressible shape to keep.
That is **outdated**: in the current registry both are `minArgs: 2, maxArgs: 3`,
which fully expresses the contiguous range `{2,3}`, so the evaluator already
rejects 1-arg and 4-arg calls. Their handler checks are therefore unreachable
dead code — identical in form to FIND/SEARCH (also `min 2, max 3`). Keeping SUMIF
but removing FIND would be arbitrary. Applying the **principle** (registry fully
expresses arity → remove), SUMIF/AVERAGEIF checks are **removed** too. IFS's
even-count is the only genuinely inexpressible shape and is kept.

Verified via `git log -S` that `maxArgs: 3` on SUMIF/AVERAGEIF has existed since
the first spreadsheet commit — it was never absent.

### Financial safety precondition (#2394 / PR #2442)

The issue warns that IPMT/PPMT once called `pmtHandler([...])` / `fvHandler([...])`
**directly**, bypassing the evaluator, so their handler-side arg check was the
only validation. After #2394 (PR #2442, merged) `ipmtHandler`/`ppmtHandler` call
the pure functions `computeIpmt`/`computePpmt` from `financial-math.ts` with
already-parsed numeric arguments. `grep` confirms **no** remaining
handler-to-handler calls anywhere in `functions/`. Every financial handler is now
reached only through the evaluator, which validates arity first. All financial
handler arg-count guards are therefore safe to remove.

## Remove / Keep table

Legend: registry `[min,max]`; "—" = no maxArgs.

### functions/logical.ts (⚠ #2431/#2448 touch this file; #2448 already merged to main)
| Handler | Guard | Registry | Action |
|---|---|---|---|
| IF | `!== 3` | [3,3] | REMOVE |
| AND | `=== 0` | [1,—] | REMOVE (evaluator `< 1`) |
| OR | `=== 0` | [1,—] | REMOVE (evaluator `< 1`) |
| NOT | `!== 1` | [1,1] | REMOVE |
| IFERROR | `!== 2` | [2,2] | REMOVE |
| IFNA | `!== 2` | [2,2] | REMOVE |
| **IFS** | `< 2 || % 2 !== 0` | [2,—] | **KEEP** (even-count inexpressible) |
| TRUE | `!== 0` | [0,0] | REMOVE |
| FALSE | `!== 0` | [0,0] | REMOVE |

### functions/mathematical.ts (⚠ #2432 touches this file)
| Handler | Guard | Registry | Action |
|---|---|---|---|
| ROUND/ROUNDUP/ROUNDDOWN/FLOOR/CEILING/POWER/MOD | `!== 2` | [2,2] | REMOVE |
| ABS/SQRT/INT/SIGN/EXP/LN/LOG10 | `!== 1` | [1,1] | REMOVE |
| PI | `!== 0` | [0,0] | REMOVE |
| TRUNC | `< 1 || > 2` | [1,2] | REMOVE |
| LOG | `< 1 || > 2` | [1,2] | REMOVE |

### functions/statistical.ts
| Handler | Guard | Registry | Action |
|---|---|---|---|
| SUM/AVERAGE/COUNT/MEDIAN/MODE/STDEV/VAR/COUNTA | `!== 1` | [1,1] | REMOVE |
| MAX | `=== 0` | [1,—] | REMOVE (evaluator `< 1`); keep `values.length>0?…:0` |
| MIN | `=== 0` | [1,—] | REMOVE (evaluator `< 1`); keep `values.length>0?…:0` |
| COUNTIF | `!== 2` | [2,2] | REMOVE |
| SUMIF | `< 2 || > 3` | [2,3] | REMOVE (see discrepancy note) |
| AVERAGEIF | `< 2 || > 3` | [2,3] | REMOVE (see discrepancy note) |

### functions/text.ts
| Handler | Guard | Registry | Action |
|---|---|---|---|
| CONCATENATE (+CONCAT alias) | `=== 0` | [1,—] | REMOVE |
| LEFT/RIGHT | `< 1 || > 2` | [1,2] | REMOVE |
| MID | `!== 3` | [3,3] | REMOVE |
| LEN/UPPER/LOWER/PROPER/TRIM/VALUE | `!== 1` | [1,1] | REMOVE |
| SUBSTITUTE | `< 3 || > 4` | [3,4] | REMOVE |
| REPLACE | `!== 4` | [4,4] | REMOVE |
| FIND/SEARCH | `< 2 || > 3` | [2,3] | REMOVE |
| TEXT/EXACT | `!== 2` | [2,2] | REMOVE |

### functions/lookup.ts
| Handler | Guard | Registry | Action |
|---|---|---|---|
| VLOOKUP/HLOOKUP | `< 3 || > 4` | [3,4] | REMOVE (keep `if (!bounds)` range-format check) |
| MATCH | `< 2 || > 3` | [2,3] | REMOVE |
| INDEX | `< 2 || > 4` | [2,4] | REMOVE (keep `if (!bounds)` check) |
| XLOOKUP | `< 3 || > 6` | [3,6] | REMOVE |

### functions/date.ts
| Handler | Guard | Registry | Action |
|---|---|---|---|
| NOW/TODAY | `!== 0` | [0,0] | REMOVE |
| DATE/TIME/DATEDIF | `!== 3` | [3,3] | REMOVE |
| YEAR/MONTH/DAY/HOUR/MINUTE/SECOND | `!== 1` | [1,1] | REMOVE |

### functions/financial.ts
| Handler | Guard | Registry | Action |
|---|---|---|---|
| FV/PV/PMT/NPER | `< 3 || > 5` | [3,5] | REMOVE |
| RATE | `< 3 || > 6` | [3,6] | REMOVE |
| IPMT/PPMT | `< 4 || > 6` | [4,6] | REMOVE (now via computeIpmt/computePpmt) |
| NPV | `< 2` | [2,—] | REMOVE (evaluator `< 2`) |
| IRR | `< 1 || > 2` | [1,2] | REMOVE arg check; **KEEP** `if (values.length === 0)` (empty-range, not arity) |

## Behavior

- Valid inputs: identical.
- Invalid arity: now surfaces the evaluator's single consistent message
  (`#ERROR!`, type `unknown`) — e.g. "ROUND requires at least 2 arguments" /
  "ABS accepts at most 1 argument" — instead of the divergent handler wording.
- IFS odd/short and IRR empty-range: still rejected by the kept guards.

## Tests

New `test/plugins/spreadsheet/engine/test_argCountValidation.ts`:
- Evaluator-level arity error fires for representative removed-guard functions
  (min side and max side), asserting the consistent evaluator message.
- IFS still rejects odd arity via the kept handler guard (red-on-break target).
- SUMIF/AVERAGEIF still reject 1-arg / 4-arg via the evaluator.
- IRR still rejects an empty range via the kept non-arity guard.

## Verify

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, spreadsheet engine
tests. No package version bumps. Diff confined to deleting top-of-handler arg-count
guard lines (no function-body/logic changes) to minimize conflict with #2431/#2432.
