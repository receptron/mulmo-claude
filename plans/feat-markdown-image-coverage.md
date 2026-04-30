# Markdown / Wiki 側の画像表示カバレッジ強化

## 背景

直近の image path 系 hot fix は **HTML サーフェス向け** に集中していた:

- #969 — `/artifacts/images/` static mount(stage 1)
- #972 — system prompt の出力規約(stage 2)
- #974 — ブラウザ self-repair(stage 3)
- #980 — Files Explorer `artifacts/html/` の path-based mount
- #982 — presentHtml の `srcdoc → src` 移行 + sandbox `allow-scripts`
- #991 — Safari の opaque-origin / CSP `'self'` 問題

`docs/wiki-html-render-surfaces.md` を踏まえると、**Markdown 系サーフェス(Wiki page / Markdown plugin / Sources brief)** にも波及すべきだが現状 partial にしか効いていない領域がある。本 plan はその gap を整理し、対策の優先順位を立てる。

## 関連サーフェス(おさらい)

`docs/wiki-html-render-surfaces.md` § 3 / § 4 より:

| サーフェス | 方式 | rewriter |
|---|---|---|
| Wiki page(standalone `/wiki/pages/<slug>`) | `marked` + `v-html`(共有 `WikiPageBody.vue` / `renderWikiPageHtml`) | `rewriteMarkdownImageRefs`(basePath = `data/wiki/pages/`) |
| Wiki page inline render(page-edit, PR #989) | 同上(共有 `WikiPageBody`) | 同上(snapshot or live page を流し込む) |
| Wiki log / lint | `marked` + `v-html`(`renderWikiPageHtml`) | `rewriteMarkdownImageRefs` |
| Markdown plugin(チャット) | `marked` + `v-html` | `rewriteMarkdownImageRefs`(file-backed のときは basePath 付き) |
| Sources brief | `marked` + `v-html` + DOMPurify | rewriter なし(外部 RSS / brief 前提) |
| TextResponse(assistant 出力) | `marked` + `v-html` | rewriter なし(LLM 出力に相対 path は想定外) |

**PR #989 の影響**:`manageWiki` MCP ツールが廃止され、LLM が Claude Code 標準 Write/Edit で `data/wiki/pages/*.md` を編集するたびに、hook → snapshot push → canvas 自動 render(page-edit action)というフローに置き換わった。レンダー pipeline は **共有 `WikiPageBody.vue` / `renderWikiPageHtml(body, baseDir)` に集約**されており、standalone view と page-edit inline view は **同じ `rewriteMarkdownImageRefs(body, baseDir)` を通る**。よって本 plan が対象とする markdown 画像カバレッジ gap(生 `<img>` / `<picture>` / `<video poster>` / etc.)は **両 surface に等しく現れる**。修正の効果も両方に同時に効く。

逆に言えば、page-edit auto-render は LLM が wiki ページを編集するたびに走るため、**gap が発火する頻度はむしろ増える**。Stage A の優先度を維持または上げる根拠。

## 確認した事実(コード読み取り)

### `rewriteMarkdownImageRefs`(`src/utils/image/rewriteMarkdownImageRefs.ts`)

- marked の lexer で AST を取り、`image` トークン(`![alt](url)`)だけを書き換える。
- `code` / `codespan` / **`html`** トークンは **`isSkippable` で素通し**(`raw` をそのまま emit)。
- → **markdown 本文中の生 `<img>` は一切触らない**。

### `useGlobalImageErrorRepair`(`src/composables/useImageErrorRepair.ts`)

- document-level capture phase の `error` リスナ(イベントが bubble しないため capture が必須)。
- `target instanceof HTMLImageElement` のみ反応。
- 修復パターン:`/artifacts\/images\/.+/`。`src` の中に `artifacts/images/<rest>` の文字列が含まれていれば、その手前を切り捨てて `/artifacts/images/<rest>` で再試行(1度のみ、`data-image-repair-tried` で再帰防止)。

つまり markdown サーフェスでは、**生 `<img>` は rewriter を素通しするが、書かれた src に `artifacts/images/<rest>` パターンが含まれていれば self-repair で救済される**。逆に言うと **その文字列を含まない src(典型: ワークスペース外、`data/wiki/sources/...`、`../images/...`)は救済されない**。

## Markdown 内で画像を出す手段の全洗い出しと現状カバー

| # | 構文 | rewriter で書き換わる? | 404 時に self-repair が救う? | 結果 |
|---|---|---|---|---|
| 1 | `![alt](url)`(標準 markdown image) | ✅ | ─(そもそも 404 にならない) | ⭕ |
| 2 | `[![alt](image)](link)`(image を含むリンク) | ✅(内側の image トークン) | ─ | ⭕ |
| 3 | 生 HTML 1 行 `<img src="../images/foo.png">` | ❌(`html` トークンで素通し) | △(URL に `artifacts/images/<rest>` があれば救う) | **partial** |
| 4 | 生 HTML ブロック `<div>...<img>...</div>` | ❌ | △(同上) | **partial** |
| 5 | `<picture><source srcset="..."><img src="..."></picture>` | ❌ | inner `<img>` は救うが `<source>` は救わない | **gap** |
| 6 | `<video poster="...">` | ❌ | ❌(`<video>` の error は `<img>` の listener にひっかからない) | **gap** |
| 7 | `<audio src="...">`(非画像だが類縁) | ❌ | ❌ | **gap** |
| 8 | 属性インライン CSS `<div style="background:url(../images/foo.png)">` | ❌ | ❌(CSS の resource fetch は DOM error イベントを飛ばさない) | **gap** |
| 9 | `<style>` ブロック内の `url()` | ❌ | ❌ | **gap** |
| 10 | SVG `<image href="...">` | ❌ | ❌(`<img>` 限定) | **gap** |

### 「browser fail-over で助かる」の整理

ケース 3 / 4(生 `<img>`)は self-repair で **部分的に** 救われる。具体的には:

- LLM が `<img src="/artifacts/images/2026/04/foo.png">` のように **既に正しい絶対 path** を書いた場合 → そもそも 404 にならない。
- LLM が `<img src="/api/files/raw?path=artifacts/images/2026/04/foo.png">` のような **古い形式** を書いた場合 → `/api/files/raw` は今でも生きているので 200。self-repair は発火しない。
- LLM が `<img src="some/wrong/artifacts/images/foo.png">` のように **prefix が壊れた** 場合 → 404 後に self-repair が `artifacts/images/foo.png` を抽出して `/artifacts/images/foo.png` にリトライ → 成功。
- LLM が `<img src="../images/foo.png">` のように **basePath を要する相対 path** を書いた場合 → 親ドキュメント URL から相対解決 → 404、`artifacts/images/<rest>` パターンに該当しないので self-repair も無力 → ❌
- LLM が `<img src="data/wiki/sources/foo.png">` のように **ワークスペース内だが artifacts 外** を指した場合 → 404、self-repair も無力 → ❌

ケース 5–10 は **rewriter も self-repair も効かない完全な gap**。

## 問題点(優先度付き)

### P1(=直近の HTML 側修正と性質が一致、対称性を取りたい)

**P1-A: 生 `<img>` の相対 path / workspace path が markdown で機能しない**(ケース 3 / 4)

- 例: Wiki ページに `<img src="../images/foo.png">` を書いても、rewriter が `html` トークンを素通しするので `<img src="../images/foo.png">` のまま render されて 404。self-repair も `artifacts/images/<rest>` に該当しない場合は無力。
- HTML 側は `rewriteHtmlImageRefs`(post-LLM 正規表現)があるが markdown 側にはない。
- LLM が markdown を書く中で「画像を細かく制御したい(width/height/style 指定)」目的で `<img>` を直接書くのは普通にあり得る。

### P2(将来の地雷だが頻度は低め)

**P2-A: `<picture>` / `<source>` / `<video poster>` が無視される**(ケース 5 / 6 / 7)

- responsive image / dark-mode 切替など、LLM が `<picture>` を生成するケースがある。
- HTML 側の `rewriteHtmlImageRefs` も実は `<img>` しか触っていないので **HTML プレビュー側でも壊れている可能性**。要確認(本 plan のスコープ外だが test plan に入れる)。

**P2-B: SVG `<image href="...">`**(ケース 10)

- `<svg>` 中で外部画像を使うケース。低頻度だが存在しうる。

### P3(発見性低・修正コスト高)

**P3-A: CSS `url()` 全般**(ケース 8 / 9)

- `<style>` ブロックや `style="background:url(...)"` の中の `url()`。
- 解決には CSS-aware のパーサが必要。フェイルオーバの error event も飛ばないので self-repair も無理。
- Wiki / markdown でこれを書くケースは稀。

## 修正提案

### Fix 1(P1-A 解決): markdown rewriter を「raw HTML 中の `<img>` も書き換え」に拡張

`rewriteMarkdownImageRefs` の `isSkippable` から `html` を外し、`html` トークンに対して `rewriteHtmlImageRefs` 相当の処理を適用。

ただし注意点:
- `code` / `codespan` 内の `<img>` 風文字列は **これまで通り素通しのまま**(`isSkippable` の `code` / `codespan` は維持)。
- `rewriteHtmlImageRefs` は basePath を取らない。markdown 側に組み込む際は **basePath 付きで `resolveImageSrc()` を呼ぶ** よう薄いラッパを書く。
- 単引用符 `<img src='...'>` も拾う。`rewriteHtmlImageRefs` の正規表現 `/(<img\s[^>]*src=")([^"]+)(")/g` は double quote 限定なので、markdown 用の rewriter ではここを拡張。
- 属性順序が逆(`<img alt="x" src="y">`)も拾う。現行の正規表現はこれは効くはず(`[^>]*` で属性を吸う)が要テスト。

### Fix 2(P1-A をさらに堅くする): 生 `<img>` 用 self-repair を強化

すでに `useGlobalImageErrorRepair` は document-level capture で動いているので、Fix 1 と独立に **rewriter で取りこぼした URL を救う安全網** として残す。本 plan で書き換えるロジックは無し(現行のまま)。

ただし、self-repair の救済範囲を広げたい場合は別 plan として:
- `<source>` / `<picture>` 配下の error も拾う(ケース 5 部分対応)。
- `<video poster>` を `<img>` 同等に扱うラッパ(ケース 6 部分対応)。

### Fix 3(P2-A 部分対応): `rewriteHtmlImageRefs` を `<source>` / `<video poster>` にも拡張

現行 HTML 側の `rewriteHtmlImageRefs` も `<img>` だけなので **HTML 側にも同じ穴がある**。markdown 側修正のついでに HTML 側も拡張するのが対称性的に望ましい。

正規表現を:
- `<img\s[^>]*src=...>`
- `<source\s[^>]*srcset=...>`(srcset は複数 URL カンマ区切りなので別パーサが必要 → 簡易版は最初の URL のみ書き換え)
- `<source\s[^>]*src=...>`
- `<video\s[^>]*poster=...>`

の 4 種に拡張。

### Fix 4(P3-A): 当面 **対象外** とする

CSS `url()` のリスク評価と工数で別 issue 化。実害が観測されるまで見送り。

### Fix 5: System prompt(stage 2 / #972)に markdown での `<img>` 規約を 1 行追加

現在の system prompt は markdown image syntax(`![](...)`)について書いているが、**生 HTML を markdown に埋め込むときの規約** が抜けている。次の 1 行を追加:

> markdown 本文中で生 HTML タグ(`<img>` / `<picture>` / `<source>` / `<video poster>`)を使う場合も、URL 規約は同じ:相対 path、または `/artifacts/images/...`(絶対)。`/api/files/raw?path=...` 形式や workspace-rooted no-leading-slash 形式は使わない。

## 確認方法

### 自動テスト(unit)

`test/utils/image/test_rewriteMarkdownImageRefs.ts` を新規 / 拡張:

```ts
// 既存
- `![](../images/foo.png)` の書き換え(basePath 有・無)
- `code` / `codespan` 内のリテラル不変

// 新規
- 生 `<img src="../images/foo.png">` の書き換え(basePath 有・無)
- `<img src='single-quoted'>` の書き換え
- 属性順序逆 `<img alt="x" src="y">` の書き換え
- `<picture><source srcset="..."><img src="..."></picture>` の書き換え(Fix 3 を入れた場合)
- `<video poster="...">` の書き換え(Fix 3)
- `<pre><code><img src="..."></code></pre>` は素通し
- `inline `<img>`` の素通し
```

### 自動テスト(e2e-live)

PR #971 で立ち上げた `e2e-live/` に Wiki カテゴリを足す。**standalone と page-edit auto-render(#989)の両経路** を testid で切り替えて回す。

```
# standalone /wiki/pages/<slug> 経路
L-W-S-01: <img src="../../../artifacts/images/<file>"> を書いて render → naturalWidth > 0
L-W-S-02: ![](../../../artifacts/images/<file>) を書いて render → naturalWidth > 0
L-W-S-03: <picture> を書いて render → naturalWidth > 0(Fix 3 後)
L-W-S-04: <img src="/wrong/prefix/artifacts/images/<file>"> → self-repair で naturalWidth > 0
L-W-S-05: data/wiki/sources/<file>.png を相対参照 → naturalWidth > 0

# page-edit auto-render(#989)経路
L-W-PE-01: LLM に Write tool で data/wiki/pages/<slug>.md を作らせ、本文に <img src="../../../artifacts/images/<file>"> → canvas inline render で naturalWidth > 0
L-W-PE-02: 同上、Edit tool で既存ページの body を更新 → snapshot 経由で naturalWidth > 0
```

`L-W-S-*` は v-html surface なので `page.locator` で直接、`L-W-PE-*` も同じ DOM(iframe ではない)なので同様。`waitForImgInWiki(page, selector)` 1 つで両経路をカバーできる。

両経路で同じ assertion が通れば、**`renderWikiPageHtml` 共有抽出(#989)で意図した通り inline render と standalone が同じ pipeline に乗っている**ことの確認にもなる。

### 手動確認

1. dev server を起動。
2. Wiki ページを `data/wiki/pages/test-images.md` で作成し、上記の各構文を全部書き並べる:
   ```markdown
   - 標準 markdown: ![](./images/foo.png)
   - 生 img: <img src="./images/foo.png" alt="raw">
   - シングルクォート: <img src='./images/foo.png' alt='single'>
   - picture: <picture><source srcset="./images/foo.png"><img src="./images/foo.png" alt="picture"></picture>
   - video poster: <video poster="./images/foo.png" controls></video>
   - SVG image: <svg width="100" height="100"><image href="./images/foo.png" width="100" height="100" /></svg>
   - CSS inline: <div style="width:100px;height:100px;background:url('./images/foo.png');"></div>
   - 壊れた prefix: <img src="/wrong/prefix/artifacts/images/foo.png" alt="self-repair">
   ```
3. ブラウザの DevTools → Network パネルで、各 `<img>` / `<source>` / etc の 200 / 404 を確認。
4. DevTools → Console で `useImageErrorRepair` が発火したかを `console.log` 一時注入して観察(または `data-image-repair-tried="1"` の付与で確認)。
5. Safari でも同じ手順で確認 ── HTML 側の Safari opaque-origin 問題(#991)は markdown 系には来ないが、念のため。
6. Files Explorer で `data/wiki/pages/test-images.md` を開いた markdown プレビュー上でも同じ確認(同じ rewriter を通る)。

### Docker モード

`docs/wiki-html-render-surfaces.md` § 6.4 を踏まえ、Docker 有効モードでも上記を一通り回す。`/artifacts/images/` mount は Docker 経由でも動くので、修正自体に Docker 固有の差はないはずだが、bind mount 経由で配信される実体ファイルが正しく届くかの確認のため。

## 段階的な実装計画

### Stage A: rewriter 拡張(P1-A 解決の中核)

PR 1 つ:

- `rewriteMarkdownImageRefs` の `isSkippable` から `html` を外す。
- `html` トークン(の `raw` 文字列)に対して `rewriteHtmlImageRefs` 相当 + basePath 解決を適用するヘルパを追加。
- 単引用符 / 属性順序逆 をカバーするよう `rewriteHtmlImageRefs` 側の正規表現を拡張(または markdown 側専用ヘルパを書く)。
- unit テスト追加(上記の test list)。
- `format` / `lint` / `typecheck` / `build` / `test` 緑。

### Stage B: HTML 側 rewriter を `<source>` / `<video poster>` 対応に拡張(対称性)

PR 1 つ:

- `rewriteHtmlImageRefs` を 4 種タグ対応に拡張。
- presentHtml + Files HTML preview 両方が利益を受ける。
- unit テスト追加。

### Stage C: e2e-live Wiki カテゴリ立ち上げ

PR 1 つ(PR #971 マージ後):

- `e2e-live/tests/wiki.spec.ts` で L-W-01 〜 L-W-05 を実装。
- `e2e-live/fixtures/live-chat.ts` に Wiki helper を足す。
- `/e2e-live-wiki` skill 追加。

### Stage D: System prompt 規約に 1 行追加

PR 1 つ(text-only):

- `server/agent/prompt.ts` の "Image references in markdown / HTML" セクションに、生 HTML タグ使用時の規約を追記。
- LLM 出力規約のリグレッション検出は Stage C の e2e-live で取れる。

### Stage E(option): self-repair の `<source>` / `<video>` 対応

工数 vs 価値で判断。実装するなら:

- `useGlobalImageErrorRepair` の listener を `<source>` / `<video>` にも反応させる。
- ただしこれらは error event が `<img>` と同じ形では飛ばないケースがある(`<source>` の 404 は `<picture>`/`<audio>`/`<video>` 親に伝播)ので、parent 側で listener 追加が必要。

別 plan / 別 issue 化が現実的。

## 受け入れ条件

- Wiki ページ本文に書いた次の全形式で画像が表示される(naturalWidth > 0):
  - `![](url)` ✅(既に動いている)
  - `<img src="url">` / `<img src='url'>` ✅(Stage A 後)
  - `<picture>` / `<source>` / `<img>` の組み合わせ ✅(Stage A + B 後)
  - `<video poster="url">` ✅(Stage B 後)
  - 壊れた prefix の `<img>` で self-repair が動く ✅(既に動いている)
- HTML 側プレビュー(presentHtml / Files HTML)でも上記同等(Stage B 後の対称性)。
- 既存の unit / e2e テストにリグレッションなし。
- system prompt 規約が markdown 内生 HTML に明示的に言及している(Stage D)。

## 関連

- `docs/wiki-html-render-surfaces.md` § 2.1 / § 3 / § 4 / § 8(画像パスルーティング 4 段戦略)
- `plans/feat-image-path-routing.md`(stage 1〜3 の元 plan)
- PR #969 / #972 / #974 / #980 / #982 / #991(直近の HTML 側 hot fix)
- PR #971(e2e-live 基盤、Stage C の依存)
- PR #955 / #963 / #989(Wiki snapshot history + LLM auto-render + `manageWiki` MCP 廃止 + 共有 `WikiPageBody` / `renderWikiPageHtml` への抽出。page-edit 経路の追加が本 plan の Wiki 側 surface を 1 増やすが、共有 pipeline により修正の効果は両経路に等しく届く)
