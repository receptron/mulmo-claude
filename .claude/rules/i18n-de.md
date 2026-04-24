---
paths:
  - "src/lang/de.ts"
---

# German locale — typographic quote handling

## Problem

`de.ts` uses German typographic quotes `„"` (U+201E opening, U+201C closing).
The closing `"` (U+201C) is visually identical to ASCII `"` (U+0022) but is a
different character. If ASCII `"` is used instead of U+201C inside a
double-quoted JS string, it terminates the string early and causes a parse error.

Claude's token output converts U+201C to ASCII `"`, so the Edit tool and Write
tool silently produce broken code when writing these characters.

## Rules

- **NEVER** use the Edit tool with `new_string` containing `„` or `"` — the
  output will corrupt the file.
- **NEVER** use `sed` to modify lines containing these characters.
- When adding or modifying lines with German quotes, use `node -e` with
  Unicode escapes `\u201E` (opening `„`) and `\u201C` (closing `"`):

```bash
node -e "
const fs = require('fs');
const file = 'src/lang/de.ts';
const content = fs.readFileSync(file, 'utf8');
const newLine = '    key: \"Die Seite \u201E{title}\u201C existiert.\",';
const updated = content.replace('    nextKey:', newLine + '\n    nextKey:');
fs.writeFileSync(file, updated, 'utf8');
"
```

- When editing parts of a line that do **not** contain `„"`, the Edit tool is
  safe — existing Unicode bytes are preserved if they are not in `old_string`
  or `new_string`.
- After any edit to `de.ts`, verify bytes with:
  `sed -n '<line>p' src/lang/de.ts | xxd` — look for `e2 80 9e` (U+201E)
  and `e2 80 9c` (U+201C).
