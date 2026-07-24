# Lint policy — driving warnings toward zero

Read this when you encounter a `yarn lint` warning, are tempted to add an `eslint-disable`, or need to understand why a `vue/no-v-html` rule is intentionally suppressed instead of fixed.

`yarn lint` runs at error-strict for most rules. A handful are kept at `warn` because graduating them to error would force a noisy cleanup and risk regressions. **Treat warnings as a backlog, not a baseline.**

## Reduce warnings opportunistically

When you touch a file, fix any warnings in it that are mechanically safe (`prefer-destructuring` auto-fix, missing `return undefined`, etc.). Don't leave a warning behind in code you just edited.

## `max-lines-per-function` is ratcheted to `error` + a grandfather list

The rule is `error` repo-wide (50-line budget, `skipBlankLines` + `skipComments`), so **no new function may exceed 50 lines** — it fails CI. The pre-existing violations that resist a behavior-preserving split (async generators whose yielded code can't move out, factory closures over mutable state, Vue composables holding reactive refs, impure Promise executors / fs watchers) are pinned to `warn` in a single **grandfather block at the end of `eslint.config.mjs`** (search `max-lines-per-function grandfather`).

Rules for that list:

- **Never add a file to it.** A new over-budget function must be split (extract pure sub-logic into tested helpers, delegate switch cases, compose sub-generators with `yield*`), not grandfathered. If a split genuinely isn't safe, that's a design discussion for the PR, not a new list entry.
- **Drain, then delete.** When you bring a listed file's functions under 50 lines, remove its entry. When the list is empty, delete the block and the rule is plain `error` everywhere.
- Test files and `e2e*/` keep the rule `off` (a `describe()` holding ten `it()` cases isn't the readability target) — that's a separate override block, not the grandfather list.

## Per-line `eslint-disable-next-line` is intentional

When you see one with a `--` rationale (e.g. `vue/no-v-html`, `no-unmodified-loop-condition`, `no-script-url` test fixtures, `no-new` URL/Intl probes, `no-loop-func` Mocha closures), it has been audited. **Never remove these comments during refactors** — they encode a trust decision. If the surrounding code changes shape, port the disable to the new line; don't drop it.

## `vue/no-v-html` specifically

Every `v-html` in this repo (NewsView, markdown/View, spreadsheet/View, textResponse/View, wiki/View) feeds from `marked.parse` or `XLSX.utils.sheet_to_html` over app-owned data — all intentional, all suppressed at the call site. If you add a new `v-html`, audit the data source and add the same comment with a one-sentence rationale; do NOT silence the rule globally.

## Multi-line elements need the wrapping form

`eslint-disable-next-line` only reaches one line. Use a `<!-- eslint-disable <rule> -->` … `<!-- eslint-enable <rule> -->` pair around the element instead.

## Raw collection io functions are import-restricted

`no-restricted-imports` blocks `listItems` / `readItem` / `writeItem` / `deleteItem` from `@mulmoclaude/core/collection/server` in host + plugin code: records are accessed through `storeFor(collection)` — `.list()`/`.page()`/`.read()` to read, `.write()`/`.delete()` to mutate (present only on writable stores; absence is the read-only refusal) — so storage backends can't be bypassed (plans/done/refactor-storage-virtualization.md). Don't suppress it — if a call site seems to need the raw io function, the store interface is missing a capability; extend it instead.
