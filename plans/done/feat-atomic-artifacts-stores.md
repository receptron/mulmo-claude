# Atomic artifact stores (v1 of #881)

GitHub: https://github.com/receptron/mulmoclaude/issues/881

## Outcome

The 3 artifact stores (markdown / spreadsheet / image) all route their
`save*` and `overwrite*` writes through `writeFileAtomic` instead of
`fs/promises.writeFile` directly. A crashed write can no longer leave
a half-written file on disk; Windows rename retries are inherited
"for free" via the existing helper.

## Steps

1. **Widen `writeFileAtomic` signature** to accept binary too.
   - `content: string | Uint8Array` (Buffer extends Uint8Array, so PNG
     bytes flow through without conversion).
   - Drop the hardcoded `encoding: "utf-8"` option when content isn't
     a string — Node's `writeFile` auto-dispatches.
   - Same widening for `writeFileAtomicSync`.

2. **Update the 3 stores** (6 call sites total):
   - `server/utils/files/markdown-store.ts`: `saveMarkdown`,
     `overwriteMarkdown` — string content.
   - `server/utils/files/spreadsheet-store.ts`: `saveSpreadsheet`,
     `overwriteSpreadsheet` — JSON-string content.
   - `server/utils/files/image-store.ts`: `saveImage`, `overwriteImage`
     — Buffer content (`Buffer.from(base64, "base64")`).

3. **Tests** in `test/utils/files/test_atomic.ts` (extend or add):
   - Buffer round-trip (write → read → bytes match).
   - String round-trip still works after the type widening.
   - Tmp cleanup on crash still triggers regardless of content type.

4. Local checks (`yarn format / lint / typecheck / build / test`),
   plus a grep over `server/utils/files/` to confirm no remaining
   bare `writeFile` / `writeFileSync` in the 3 stores.

## Out of scope

- v2 items in #881 (wiki-backlinks, tool-trace, json.ts sync, mulmo-script)
- Append-only paths (logger / session-io)
- Migration scripts
