# Help file pointer-or-inline threshold (#487)

## Problem

`buildInlinedHelpFiles()` inlines the full content of every `config/helps/*.md` referenced from a role prompt. Typical sizes today:

| file             | chars |
| ---------------- | ----- |
| `github.md`      | 1,200 |
| `spreadsheet.md` | 1,359 |
| `index.md`       | 3,782 |
| `business.md`    | 4,041 |
| `sandbox.md`     | 4,313 |
| `mulmoscript.md` | 6,261 |
| `wiki.md`        | 6,670 |
| `telegram.md`    | 6,755 |

All of these land in the system prompt regardless of whether the LLM actually needs them this turn. Issue #487 tracks the prompt-bloat risk — help files already account for up to 6,670 chars in a single turn, and the list keeps growing.

## Approach

Branch per help file on size:

- **< 2,000 chars** → inline as today. The round-trip cost of a `Read` tool call would exceed the prompt savings, and the LLM gets the content without indirection.
- **≥ 2,000 chars** → emit a summary (first H1 + first paragraph, capped at ~200 chars) plus an explicit pointer: `"Detailed reference: use Read on config/helps/<name>.md"`.

Threshold is a constant so it's easy to tune later based on observed behaviour.

Summary extraction:

- First H1 heading line (if present) — identifies the file
- First non-heading paragraph (up to 200 chars, ellipsed) — gives the LLM enough to decide whether a Read is worth it
- No frontmatter / manual summary fields required — keeps help-file authoring zero-ceremony

## Out of scope

- Memory context (`conversations/memory.md`) pointer-ization — separate discussion in #487, deferred pending results from this change
- Dynamic size adjustment (e.g. threshold-per-role) — keep one global constant for now

## Acceptance

- Small help files (`github.md`, `spreadsheet.md`) stay inline byte-for-byte
- Large help files emit the summary + pointer block
- Unit tests cover: under threshold, at threshold, over threshold, file missing, no first paragraph present
- A role prompt that currently references `wiki.md` still causes the LLM to use `manageWiki` / `Read` on the canonical path — manual smoke test required after merge
