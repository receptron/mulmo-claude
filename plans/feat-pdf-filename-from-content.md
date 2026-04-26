# PDF download filename from content + date suffix (#831)

## User prompt

> pdfダウンロードするときにファイル名がmulmoclaudeとかassistantって名前になって分かりづらい。その会話、もしくはセッションからファイル名を決め欲しい。日付もあると良いかなname-yyyy-mm-dd

Follow-up Q&A:

- textResponse の名前ソース → **B: その返答自体の最初の行 / H1**
- 日付ソース → **B: そのメッセージ/結果が作られた日付 (resultTimestamps)**
- textResponse の fallback → **B: `chat`**
- wiki / markdown は今の名前ロジックを残して日付だけ足す → **OK**

## Current state

| Plugin | Filename source | Example |
|---|---|---|
| textResponse | `selectedResult.title` (= "Assistant" / "You" / "Error") | `Assistant.pdf` |
| wiki | wiki page title | `MulmoClaude.pdf` |
| markdown | `data.filenamePrefix` ?? `selectedResult.title` ?? `"document"` | varies |

Common entry: `usePdfDownload().downloadPdf(markdown, filename)`.

## Design

### 1. `buildPdfFilename({ name, fallback, timestampMs })`

```ts
function buildPdfFilename(opts: {
  name: string | null | undefined;
  fallback: string;
  timestampMs?: number;
}): string {
  const safe = toSafeFilename(opts.name ?? "", opts.fallback);
  const date = formatLocalDate(opts.timestampMs ?? Date.now()); // YYYY-MM-DD
  return `${safe}-${date}.pdf`;
}
```

Lives in `src/utils/files/filename.ts` next to `toSafeFilename`.

`formatLocalDate` uses local timezone (the user's clock) — not UTC — because the date is meant to be human-meaningful, not machine-comparable.

### 2. `extractTextResponseTitle(text)`

```ts
function extractTextResponseTitle(text: string): string {
  // 1. first H1
  const h1 = /^#\s+(.+)$/m.exec(text);
  if (h1) return h1[1].trim().slice(0, 50);
  // 2. first non-empty line, first 50 chars
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, 50);
  }
  return "";
}
```

Lives in `src/plugins/textResponse/utils.ts` (new file) — plugin-specific.

### 3. `useAppApi.getResultTimestamp(uuid)`

Adds one method to the existing AppApi contract. App.vue wires it from `activeSession.resultTimestamps`. Plugin views can then read the result's creation time without prop plumbing.

Returns `undefined` if the timestamp isn't available — caller falls back to `Date.now()`.

### 4. View updates

- `textResponse/View.vue` — extract title from `data.text`, fallback `"chat"`, build filename with `buildPdfFilename`
- `wiki/View.vue` — keep `title.value`, build filename with `buildPdfFilename`
- `markdown/View.vue` — keep current `filenamePrefix || title || "document"`, build filename with `buildPdfFilename`

All three look up the timestamp via `useAppApi().getResultTimestamp(selectedResult.uuid)`.

## Files

- `src/utils/files/filename.ts` (extend with `buildPdfFilename` + `formatLocalDate`)
- `src/plugins/textResponse/utils.ts` (new — `extractTextResponseTitle`)
- `src/plugins/textResponse/View.vue` (update download handler)
- `src/plugins/markdown/View.vue` (update download handler)
- `src/plugins/wiki/View.vue` (update download handler)
- `src/composables/useAppApi.ts` (add `getResultTimestamp` to interface)
- `src/App.vue` (provide `getResultTimestamp` via the AppApi)
- `test/utils/files/test_filename.ts` (extend with `buildPdfFilename` cases)
- `test/plugins/textResponse/test_utils.ts` (new — `extractTextResponseTitle` cases)

## Test cases

### `buildPdfFilename`

- normal name → `name-2026-04-26.pdf`
- empty name → `${fallback}-2026-04-26.pdf`
- name with unsafe chars → sanitized + dated
- explicit timestampMs → uses that date
- omitted timestampMs → uses `Date.now()`

### `extractTextResponseTitle`

- `# Hello\n\nbody` → `Hello`
- `Plain reply text` → `Plain reply text`
- empty string → `""`
- whitespace-only → `""`
- long line → truncated to 50 chars
- H1 with markdown chars → trimmed
