# feat: Wikiのコードブロックにシンタックスハイライトを追加 (#1868)

## User Prompt

> wikiのmarkdownでcode blockにtsとかいれても、その言語のスタイルにならない。これ対応できる？

方針相談の結果、highlight.js + `marked-highlight` を採用。言語定義は `highlight.js/lib/common`（ts含む主要約35言語）、テーマは github 系を1枚読み込む構成で進める。

## 問題

Wikiのmarkdownで ` ```ts ` のように言語付きフェンスドコードブロックを書いても、その言語のシンタックスハイライトが効かない。

## 原因

markdownレンダリングに使っている `marked`（v18）にシンタックスハイライタが組み込まれていない。`marked` は ` ```ts ` を `<pre><code class="language-ts">…</code></pre>` というHTMLに変換するだけで、トークンの色付けは行わない（v18では旧 `highlight` オプションも廃止され、拡張で差し込む方式）。Wiki側のCSS（`WikiPageBody.vue` の `pre`/`code`）も灰色背景を付けるのみで、言語別の色分けルールが無い。

## 方針

- `marked-highlight` + `highlight.js` を導入。
- ハイライトロジックは純粋関数 `highlightCode(code, lang)` として `src/utils/markdown/highlight.ts` に切り出し、テスト可能にする（vue非依存）。
- 言語定義は `highlight.js/lib/common`（ts/js/python/json/bash/yaml/sql/go/rust/java/c/cpp/csharp/php/ruby/css/xml(html)/markdown 等 約35言語）を使用。未知/空言語は `plaintext` にフォールバックして例外を出さない。
- `src/utils/markdown/setup.ts`（marked グローバル設定の集約箇所）で `marked.use(markedHighlightExtension)` を登録し、同じファイルでテーマCSS `highlight.js/styles/github.css` を import（ハイライト関連の副作用を1ファイルに集約）。
- テーマCSSは言語非依存（`.hljs-keyword` 等の共通トークンクラスを色付け）なので、1枚で全登録言語に効く。

## 影響範囲 / 既知の挙動

- グローバルな `marked` 設定なので、Wikiだけでなく skill / textResponse など `marked` を使う全markdown面にハイライトが反映される（意図通り）。
- サニタイズ（DOMPurify）を通る面でも、`hljs-*` の `class` はDOMPurifyのデフォルトで保持されるため問題なし。Wikiパスは trusted で元々サニタイズを通らない。
- Wikiの `pre` は既存の灰色背景を維持（`.wiki-content pre code` の `background:none` が github テーマの `.hljs` 背景より詳細度が高く勝つ）。トークン色は `.hljs-*` ルールで適用される。
- レンダリングは同期のまま（`highlightCode` は同期で文字列を返す）。`renderWikiPageHtml` の非同期化は不要。

## 変更ファイル

- `package.json` … `marked-highlight`, `highlight.js` 追加
- `src/utils/markdown/highlight.ts` … 新規（`highlightCode` + `markedHighlightExtension`）
- `src/utils/markdown/setup.ts` … 拡張登録 + テーマCSS import
- `test/utils/markdown/test_highlight.ts` … 新規テスト

## テスト

- `highlightCode("const x = 1", "ts")` が hljs トークン span を含む
- 未知言語 `highlightCode(code, "nope")` が例外を出さず plaintext 相当を返す
- 空言語でも落ちない
- フルパイプライン: `marked.use(markedHighlightExtension)` 後、` ```ts ` ブロックが `class="hljs language-ts"` と `hljs-*` トークンを含む
- 既存の `format` / `lint` / `build` / `typecheck` / `test` を通す
