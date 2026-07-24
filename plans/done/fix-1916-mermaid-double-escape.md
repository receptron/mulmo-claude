# fix #1916: mermaid quotes break render (`token.escaped` double-encoding)

## User prompt (JP)

> マーメイド表示対応したけど、`⚠ Mermaid の描画に失敗しました: Error: Parse error on line 2: ...ヤー3: エンドユーザー / 顧客企業 (B2B / B2B2B)&quot;]` とこわれる

## Root cause

`markedHighlight`'s `walkTokens` hook fires on **every** `code` token, regardless of language:

```js
walkTokens(token) {
  if (token.type !== 'code') return;
  const code = options.highlight(token.text, lang, ...);
  updateToken(token)(code);  // sets token.text = code, token.escaped = true
}
```

Mermaid falls to `plaintext` via our `highlight.ts` fallback, so highlight.js emits no `<span>` tags — just entity-escapes the source (`"` → `&quot;`, `<` → `&lt;`, etc.) and stamps `token.escaped = true`.

Our mermaid renderer runs after highlight (that's the correct order — later `.use()` calls wrap earlier renderers so `false` returns fall through). But it blindly called `escapeHtml(token.text)`, so:

1. Original: `"` (raw)
2. After highlight walkTokens: `&quot;`
3. After our `escapeHtml`: `&amp;quot;` (`&` in `&quot;` re-escaped)
4. Browser parses `&amp;quot;` → text node contains `&quot;`
5. `textContent` returns `&quot;`
6. `mermaid.render()` receives literal `&quot;` → grammar parse error

## Fix

Check `token.escaped` in the renderer:

```ts
const html = token.escaped === true ? token.text : escapeHtml(token.text);
```

Applied to both host and plugin copies (the plugin doesn't currently wire highlight, so the fallback branch keeps working; the plugin version is defensive so composing extensions later stays safe).

## Regression test

`test/utils/markdown/test_mermaidExtension.ts` gets a new `markedWithHighlightAndMermaid()` helper that composes the two extensions in the same order the host does, and asserts:

- The rendered html contains `&quot;` (single escape — correct).
- The rendered html NEVER contains `&amp;quot;` (double escape — the bug).
- Same guard for `&lt;br/&gt;` (a common Japanese-diagram idiom).

## Verification

- `yarn test`: 12/12 pass in `test_mermaidExtension.ts`, all suites green.
- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build`: clean.
- Manual: refresh `/files/artifacts/documents/2026/07/mulmocast-business-architecture.md` in the dev server after the fix lands — expected to render the diagram instead of the parse error.
