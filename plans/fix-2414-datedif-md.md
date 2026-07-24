# fix(spreadsheet): DATEDIF "MD" no longer returns negative days (#2414)

## Problem

`DATEDIF(Jan 30 2023, Mar 1 2023, "MD")` returned `-1` (Excel: a positive value).
The `"MD"` unit — day-of-month difference ignoring months and years — must be
non-negative.

## Root cause

`computeDatedif`'s `"MD"` branch borrowed the length of the calendar month
BEFORE `end` when the end day was earlier: `prevMonthLastDay - startD + endD`.
For Jan 30 → Mar 1 that is Feb's 28 days: `28 - 30 + 1 = -1`. When the start day
outruns the preceding month's length, the result goes negative.

## Fix

Compute MD as the day remainder after the complete months `DATEDIF "M"` counts,
anchored on `start + <complete months>` (with day clamped to the target month's
length). This keeps the invariant `start + M months + MD days == end`, so the
result is non-negative by construction and still correct for multi-month spans
(where the naive borrow was already right).

- New pure helper `addMonthsClamped(date, months)` — adds months, clamping the
  day so Jan 30 + 1 month → Feb 28/29 rather than overflowing into March.
- `MONTHS_PER_YEAR` constant replaces the inline `12`s in the same file.

## Chosen semantics (Excel is itself inconsistent here)

- Jan 30 → Mar 1 = **1** (one complete month to Feb 28/29, then one day). Excel's
  DATEDIF "MD" is officially unreliable in this pathological case; `1` is the
  value consistent with the M+MD invariant, and it is the same for leap and
  non-leap years.

## Tests (test_datedif.ts, expectations updated from the pinned buggy values)

- End day later: unchanged (`Jan 10 → Mar 25 = 15`).
- Multi-month remainder: `Jan 15 → Mar 10 = 23`.
- Non-negative pathological cases: `Jan 30 → Mar 1 = 1` (2023 and leap 2024).
