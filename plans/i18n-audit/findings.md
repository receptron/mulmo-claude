# i18n audit — 2026-04-24 (follow-up on issue #713)

Repo-wide scan for hardcoded English strings in the Vue tree.

## Method

```bash
# User-facing English throws
grep -rnE 'throw new Error\("[A-Z]' src/ --include="*.ts" --include="*.vue"

# Reactive error/status/message refs holding English
grep -rnE '\.value\s*=\s*"[A-Z][a-z]' src/ --include="*.vue" --include="*.ts"
  | grep -E 'error|message|status'

# alert() / confirm() / prompt() with literal English
grep -rnE '\b(alert|confirm|prompt)\("[A-Z]' src/

# "Failed to" / "Cannot" / "Unable to" literal patterns
grep -rnE '"(Failed to|Error:|Loading\.\.\.|Cannot |Unable to)'
```

## Findings

### 対応 (translate — user-facing)

| # | File:Line | Current | Flow |
|---|---|---|---|
| 1 | `src/plugins/scheduler/View.vue:514` | `"Could not parse YAML — ensure 'title' is present"` | Rendered in red `<span>` below the YAML editor (line 222) |
| 2 | `src/plugins/todo/composables/useTodos.ts:135` | `"Failed to load todos"` | Surfaced via `useTodos().error` → rendered in `TodoExplorer.vue:75` banner |
| 3 | `src/components/SettingsModal.vue:222` | `"Finish or cancel the pending MCP server entry first."` | Rendered as `statusMessage` banner (line 105) |
| 4 | `src/plugins/spreadsheet/View.vue:572` | `alert("Invalid JSON format: ${...}")` + `"Unknown error"` fallback | `alert()` blocking dialog on Apply Changes |
| 5 | `src/plugins/spreadsheet/View.vue:563` | `throw new Error("Data must be an array of sheets")` | Caught at line 571 and shown inside the #4 alert |

### ホワイトリスト (intentionally English)

| Reason | Sites |
|---|---|
| Spreadsheet formula engine errors — Excel / Google Sheets / LibreOffice all use English `#VALUE!` / `#REF!` style errors; user expectation aligns | `src/plugins/spreadsheet/engine/functions/date.ts` × 13, `functions/mathematical.ts` × 10+, `functions/logical.ts`, `functions/statistical.ts`, `calculator.ts:183` ("Circular reference detected") |
| `console.error` / `console.warn` / `console.log` — internal dev logs, never rendered | `spreadsheet/View.vue` × 5, `canvas/View.vue:212`, others |
| Prefix checks for API routes — not displayed | `src/utils/image/rewriteMarkdownImageRefs.ts:39` `if (url.startsWith("/api/"))` |

### 次フェーズ

- Expand the audit to `src/composables/` and `src/plugins/*/` for other reactive error refs we might have missed — today's grep only covered the `.value = "English"` form, not all assignment styles
- Consider whether `Error.message` from the JS runtime (caught and displayed) should get a known-English-fallback UX treatment separate from i18n

## Action

All 5 items translated in PR <linked after create>. 8 locales updated (en / ja / ko / zh / es / pt-BR / fr / de).
