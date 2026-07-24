# fix(spreadsheet): unify boolean coercion across IF and AND/OR/NOT (#2387)

## Problem

The same value read as opposite truthiness depending on the function:
`IF("0", ...)` took the TRUE branch while `AND("0")` was FALSE. Each function
coerced truthiness its own way, and `IF` also treated the text `"false"` as true.

## Root cause

Three different inline rules:

- `IF`: `conditionValue.toLowerCase() === "true" || conditionValue !== ""` — any
  non-empty string (including `"0"` and `"false"`) was true.
- `AND` / `OR` / `NOT`: `!v || v === 0 || v === "0"` (copied three times) — `"0"`
  and `0` were false, but `"false"` was true.

## Fix

Extract one pure `coerceToBoolean(value)` (`engine/coerce-boolean.ts`) and use it
in IF, AND, OR and NOT. Rule:

- boolean → itself; blank / empty / `null` / `undefined` → false;
- number → false only when 0;
- `"true"` / `"false"` (case-insensitive) → their logical value;
- a numeric string follows its number (`"0"` → false, `"5"` → true);
- any other non-empty text → true.

## Chosen semantics (behaviour change — flagged for review)

- `"0"` is now false everywhere (was true in IF). This is the unification the
  issue asks for ("Excel は 0 = false で統一").
- `"false"` is now false in IF (was true).
- Non-empty, non-numeric text (e.g. `"hello"`) stays true — this engine does not
  raise `#VALUE!` for text in a logical position, matching the issue's stated
  convention rather than strict Excel.

## Tests (test_logicalFunctions.ts)

- `coerceToBoolean` directly: booleans, numbers, blank/empty/null, `true`/`false`
  words, numeric strings, other text.
- Through the engine: IF's branch, AND, OR and NOT all agree on the same literal
  (`"0"`, `"false"`, `""`, `0`, `"5"`, `"hello"`, `1`).
