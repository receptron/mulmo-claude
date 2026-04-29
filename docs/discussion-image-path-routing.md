# 画像パスのルーティング再設計

issue/PR は別途。本ドキュメントは設計合意の記録 + 段階的実装計画。

## 1. 現状(2026-04-29 時点)

詳細は `docs/image-path-routing.md`(英語、404行)を参照。要点だけ抜粋:

### 1.1 現在のフロー

LLM が markdown / HTML を生成 → ファイル保存 → Vue でレンダリング → rewriter が `<img>` の `src` を `/api/files/raw?path=<workspace-relative>` に書き換え → サーバが `resolveWithinRoot()` でガードしつつファイル提供。

### 1.2 rewriter は2系統

| 用途 | 関数 | 場所 |
|---|---|---|
| wiki / markdown / Files | `rewriteMarkdownImageRefs` | `src/utils/image/rewriteMarkdownImageRefs.ts` (marked lexer ベース) |
| presentHtml | `rewriteHtmlImageRefs` | `src/utils/image/rewriteHtmlImageRefs.ts` (`<img src="…">` 正規表現) |

両方とも `resolveImageSrc()` (`src/utils/image/resolve.ts:6`) を共有、最終出力は `/api/files/raw?path=<encoded>`。

### 1.3 画像保存パスは1箇所

`server/utils/files/image-store.ts:33-40` の `saveImage()` がすべての生成画像(Gemini / canvas / edit)を:

```
artifacts/images/YYYY/MM/<shortId>.png
```

に保存。`WORKSPACE_DIRS.images = "artifacts/images"` (#764で YYYY/MM shard 化)。`isImagePath()` も `artifacts/images/` で始まることを必須にしている。

### 1.4 既知の問題(audit §8)

- HTML rewriter は **double-quoted `<img src="…">` のみ** 対応(`<source>` / `<video>` / `<a href>` / CSS `url()` 未対応)
- markdown 内の **生`<img>` HTML タグ** は marked が `html` token としてスキップ → どちらの rewriter にもかからない
- `textResponse/View.vue` は rewriter を全く通さない
- PDF inliner と presentHtml で path 解決ロジックが重複(直近の #961 で leading-`/` バグの hot fix を両方に当てた)
- `/api/files/*` は bearer-auth 免除(`<img>` がトークン送れないため)

### 1.5 Docker は agent 側だけ

Express サーバはホスト側で動作。`~/mulmoclaude` を直接読む。Docker サンドボックスは agent subprocess の隔離用で、画像 serve には関係しない(`server/workspace/paths.ts:38`)。

### 1.6 直近の修正履歴

- `71a7af9b` (#961) wiki rewriter の `basePath` を旧 `wiki/pages` から `data/wiki/pages` に修正 → `../sources/foo.png` の解決が直る
- `b11c3256` (#961) presentHtml の `<img>` rewriter を新規作成、leading-`/` を workspace-rooted として解釈
- `inlineImages` (`server/api/routes/pdf.ts`) も同根の修正(同 PR)

## 2. 目的(再設計の Goals)

1. **LLM に相対パスを書かせる**(おかしな絶対パス・先頭スラッシュ混在を防ぐ)
2. **ワークスペースのファイルを OS で直接開いた時にも画像が解決する**(markdown viewer / `file://`)
3. **将来の内部ファイル構成変更に強くする**(rewriter が定数依存しない、既存ファイルを移動する想定はなし)
4. **rewriter の出力 URL を proxy URL 形式に整理**(`/api/files/raw?path=…` の query param 形式から、普通の path 形式へ)

## 2.5 検討した代替案と却下理由

設計に至るまでに考慮した options を記録。後で「なぜこれにしなかったか」を辿るため。

### 案A: 全面 iframe 化(wiki + presentHtml 両方)

**アイデア**: wiki / HTML 共に `<iframe src="/proxy/...">` で表示。iframe 内のbase URL がワークスペースパスと一致 → 相対パスをブラウザが自然解決 → rewriter 不要。

**却下理由**: wiki 側のUXコストが甚大。

| iframe 化で失うもの | 補填の難易度 |
|---|---|
| Vue 親 frame の Tailwind / typography 継承 | iframe srcdoc に CSS 再注入が必要 |
| ページ高さ自動調整 | `ResizeObserver` + `postMessage` で都度通知 |
| 内部リンク `[[wiki link]]` の Vue router 連動 | click intercept + postMessage |
| スクロール / アンカー (`#section`) | iframe boundary を跨ぐ必要 |
| クリック→Vue router遷移などの統合UX | 全部再構築 |

→ wiki の「v-html 直挿しで親frameと統合される気持ちよさ」が iframe 化で失われる。これを再構築する工数は rewriter の穴埋めより明確に重い。

**部分採用は可能**: presentHtml だけ iframe srcdoc → src=URL に切り替えて rewriter 撤去はあり。が、本設計では一貫性のため両方とも v-html / srcdoc は維持し、rewriter で揃える方針に。

### 案B: `<base href>` を iframe srcdoc に注入

**アイデア**: presentHtml の srcdoc に `<base href="/proxy/artifacts/html/<file>/">` を入れる。iframe 内ドキュメントの base URL が変わり、相対パスがその位置から解決される。

**却下理由(presentHtml 単体には適用可能だが、wiki には不可)**:

- `<base>` は **HTMLドキュメントごとに1つだけ有効**、しかも適用範囲はそのドキュメント全体
- wiki / markdown のレンダリングは `marked.parse()` の結果を `v-html` で **Vue アプリ本体のDOMに直接挿入**(iframe 境界がない)
- `<base>` を入れたら **アプリ全体のルーティング・リンク・CSS パスが全部巻き込まれる** → 即死
- canvas pane に複数 plugin result(wiki + presentHtml + markdown を縦積み)が並ぶケースで、wiki側がアプリDOMにそのまま流れ込むので結局アウト

→ 本設計では使わない(presentHtml の現状の URL 解釈に変更を入れたくないため)。

### 案C: static-mount だけで rewriter 撤去

**アイデア**: `app.use('/data', static)` + `app.use('/artifacts', static)` を設定 → LLM が書く絶対パス(`<img src="/artifacts/images/...">`)はそのまま動く。rewriter 不要。

**却下理由(完全撤去は不可)**:

- ブラウザの相対パス解決は **「ページの現在URL」をbase** にする(ソースファイル位置ではない)
- wiki ページは Vue ルート `/wiki/pages/my-page` で表示中 → `<img src="../sources/foo.png">` は `/wiki/sources/foo.png` を fetch しようとする → 404
- 相対パスを正しく解決するには **「このコンテンツがどこから来たか」というサーバ側コンテキスト** が必要 → これは rewriter の仕事
- HTML 仕様だけで解決する手段はない

→ static-mount だけで救えるのは **LLM が必ず leading-`/` 絶対パスで書く** 場合のみ。現状の出力は3種類混在(`./foo.png`、`data/...`、`/artifacts/...`)なので不可。

### 案D: data URI でインライン化

**アイデア**: 生成時に画像を base64 で `<img src="data:image/png;base64,...">` にインラインしてしまう。URL ルーティング問題が消える。

**却下理由**:

- payload が肥大(画像1枚 ~MB スケール、wiki ページが100KB→数MBに)
- ブラウザキャッシュ不可(同じ画像でも毎回転送)
- ファイル共有時に画像も丸ごと埋め込まれる
- workspace の「ファイルが真実」原則と相性が悪い(画像は別ファイルとして存在する設計)

→ 採用せず。

### 採用: hybrid(rewriter + static mount + onerror fallback)

最終設計(§3 以下)は次の組み合わせ:

| レイヤー | 役割 |
|---|---|
| LLM プロンプト | 相対パスを推奨、ハードコード回避 |
| rewriter | 相対パス → 絶対URLに正規化、絶対パスはパススルー |
| Express static mount | `/artifacts/images` だけ静的配信(範囲限定で privacy 安全) |
| ブラウザ `<img onerror>` | 404時に `artifacts/images/<rest>` パターンで再構築 retry |

それぞれが小さくて独立。段階的ロールアウト可能(§4)。

### 派生で確認した事実

- **Docker は agent 側だけ** — Express サーバはホスト側プロセスで動く(`server/workspace/paths.ts:38`)。`~/mulmoclaude` を直接読むので、Docker サンドボックスは画像配信に関係しない。
- **画像保存先は1箇所** — `saveImage()` (`server/utils/files/image-store.ts:33`) が Gemini / canvas / image edit すべての終点で、出力は `artifacts/images/YYYY/MM/<shortId>.png` 一本(#764で UTC YYYY/MM shard 化)。
- **`isImagePath()`** (`image-store.ts:59`) も `artifacts/images/` で始まることを必須にしている → 画像は他の場所には置かれない。

→ 上記から `/artifacts/images` 限定 mount で十分という結論。

## 3. 設計

### 3.1 全体方針

**iframe 化はしない**。理由は wiki の v-html 直挿しが Vue の親 frame と密結合(Tailwind / typography 継承、内部リンクが Vue router 連動、スクロール統合)で、iframe 化のUXコストが rewriter 維持より高い。

代わりに:

- **Express で `/artifacts/images` を `express.static` で mount**
  - `app.use('/artifacts/images', express.static(WORKSPACE_PATHS.images, { dotfiles: 'deny', extensions allowlist }))`
  - 拡張子 allowlist で `.png/.jpg/.jpeg/.webp/.svg/.gif/.pdf` 等のみ通す
- **rewriter の出力先を `/artifacts/images/...` に変える**
  - 既存の `/api/files/raw?path=...` 形式から、URL がワークスペースパスと一致する形式へ
- **LLM プロンプトで相対パス推奨**(絶対パスも受け入れる)
- **ブラウザ側の `<img onerror>` で fallback 復旧**

### 3.2 Express mount の正当性

`/artifacts/images` のみ mount で全画像をカバーできる根拠:

- `saveImage()`(`server/utils/files/image-store.ts:33`)が **すべての画像生成パス**(Gemini / canvas / image edit)の終点
- 保存先は `artifacts/images/YYYY/MM/<shortId>.png` 一本
- `isImagePath()` (line 59) も `artifacts/images/` で始まることを validation 条件にしている
- 画像が他の場所(`data/wiki/sources/` 等)に置かれる経路は無い

→ `/artifacts/images` 限定 mount で privacy / 範囲とも適切。

### 3.3 rewriter の入出力

入力:
```
content: markdown / HTML 文字列
sourcePath: ワークスペース相対の md/html パス(例: "data/wiki/pages/my-page.md")
```

出力ルール:

| 入力 src | 出力 src |
|---|---|
| `/artifacts/images/2026/04/foo.png` | パススルー(既に正しい) |
| `artifacts/images/2026/04/foo.png` | `/artifacts/images/2026/04/foo.png` (先頭`/`を付与) |
| `../../../artifacts/images/2026/04/foo.png` | source位置から resolve → `/artifacts/images/2026/04/foo.png` |
| `./foo.png`(`artifacts/images/` 配下に解決されない) | そのまま出力(ブラウザは404、onerror に委ねる) |
| `data/wiki/sources/foo.png` 等(画像でない想定) | 後方互換のため `/api/files/raw?path=data/wiki/sources/foo.png` を出す(stage 1) |
| `http://...` / `https://...` / `data:...` | パススルー |

source位置を引数に取ることで、wiki ページが将来 `data/wiki/pages/` 以外に移っても rewriter の改修不要(Goal 3)。

### 3.4 ブラウザ側 onerror による self-repair

すべての rewriter出力 `<img>` に `data-orig` 属性を付与:

```html
<img src="/artifacts/images/2026/04/abc.png" data-orig="../../../artifacts/images/2026/04/abc.png">
```

404 時の handler:

```js
function repair(img) {
  if (img.dataset.tried) return;            // 無限ループ防止
  img.dataset.tried = '1';

  const orig = img.dataset.orig || img.src;
  // "artifacts/images/<rest>" を抽出して URL を再構築
  const m = orig.match(/artifacts\/images\/.+/);
  if (m) img.src = '/' + m[0];
}
```

すべての画像が `artifacts/images/<...>` 配下にある前提なので、この単純なパターンマッチで:

- `/some/wrong/prefix/artifacts/images/foo.png` → `/artifacts/images/foo.png` ✓
- `<img src="data/x/artifacts/images/foo.png">` → `/artifacts/images/foo.png` ✓
- `<img src="random/path.png">` → マッチせず諦め(既知パターン外)

### 3.5 LLM プロンプトの改訂方針

- 画像参照は **ソースファイルからの相対パス推奨**(`![](../../../artifacts/images/...)`)
- 絶対パス(`/artifacts/images/...`)も許容
- ハードコードを避ける(`data/wiki/...` のようなディレクトリ名直書きは将来の構成変更で壊れる)
- 画像生成系プラグイン(Gemini, canvas)は `saveImage()` が返すパスをそのまま参照する規約を維持

### 3.6 file:// での閲覧

- markdown ビューア(VSCode / Obsidian / GitHub):`.md` の位置から相対解決 → 動く ✓
- HTML を `file://` で直接開く: 一部ブラウザ(Chromium 系)は親 dir への `..` climb をデフォルトで拒否
  - 同階層・サブディレクトリの参照は確実に動く
  - 親 climb は browser 設定次第
  - 許容する(ドキュメントに caveat 記載)

## 4. 段階的ロールアウト

### Stage 1: 画像 dir を mount + rewriter 出力 URL 切替

**変更内容**

- `server/index.ts`(または route 登録箇所)に `app.use('/artifacts/images', express.static(WORKSPACE_PATHS.images, { dotfiles: 'deny' }))` を追加(拡張子 allowlist 付き)
- `src/utils/image/resolve.ts:resolveImageSrc()` を改修
  - 入力 path が `artifacts/images/` 配下に解決されるなら `/artifacts/images/<rest>` を返す
  - それ以外は現状の `/api/files/raw?path=<encoded>` を返す(後方互換)
- 両 rewriter の `<img>` 出力に `data-orig` 属性追加(stage 3 で使う)

**互換性**

理論上完璧。理由:

- 保存ファイルの中身(LLM-emitted の相対 / 絶対パス)は変更しない
- rewriter の出力 URL のみ変更、サーバ側は **両 URL form を並走**
- 既存の `<img src="/api/files/raw?path=...">` は runtime に生成される URL なのでファイルには残らない、ブラウザリロードで新しい URL に切り替わる
- `data/wiki/sources/...` のような non-image path は `/api/files/raw?path=...` で従来通り解決

**検証**

- 既存 wiki ページを開く → 画像が表示される
- 既存 presentHtml ページ → 画像が表示される
- 新規生成画像 → 表示される
- 直接 `<img src="/artifacts/images/2026/04/foo.png">` を含む markdown → 表示される

### Stage 2: LLM プロンプト改訂

**変更内容**

- 画像参照規約のセクションを `server/agent/prompt.ts` または該当する system prompt 構成に追加
- 推奨形(相対パス)・許容形(絶対パス)・禁止形(query string、host-absolute)を例示
- 既存の wiki / HTML 生成系プロンプトの画像言及箇所を整合

**互換性**

prompt 変更のみ、コード挙動は変わらない。LLM 出力が改善されてもされなくても、stage 1 + stage 3 で受け止めるので壊れない。

### Stage 3: ブラウザ側 onerror self-repair

**変更内容**

- wiki/markdown レンダリング箇所(v-html を使う Vue コンポーネント)に global `error` イベントリスナ
  - `<img>` の error をキャッチ
  - `data-orig` または `src` から `artifacts/images/<rest>` を抽出して retry
  - `data-tried` で1回までに制限
- presentHtml の iframe srcdoc 内にも同等のスクリプトを inject

**互換性**

純加算。既存の正しい URL は1段目で成功、404 のときだけ復旧を試みる。

### Stage 4(後続、別 PR): rewriter §8 ギャップ埋め

優先度は低い。stage 3 の onerror で実用上は塞がっているが、サーバ往復が無駄なので最終的には rewriter 側で吸収:

- HTML rewriter: `<source>`, `<video>`, `<a href>`, CSS `url()`, single-quoted `src`
- markdown rewriter: 生 `<img>` タグ
- `textResponse/View.vue` への rewriter 適用

## 5. Open Questions

- **拡張子 allowlist の範囲**: `.png/.jpg/.webp/.svg/.gif` で確定?`.pdf` は別 mount?
- **`data/wiki/sources/` の扱い**: 画像でないファイル(PDF 等の source 資料)は `/api/files/raw` で従来通りでよいか
- **mount 経路のセキュリティ監査**: `express.static` の `dotfiles: 'deny'` だけで足りるか、追加ガードを噛ますか
- **`data-orig` 属性の負荷**: 画像が大量(数百)ある wiki ページで属性増加によるDOM サイズ影響は許容範囲か
- **`<base>` を試さない確定**: iframe srcdoc 内であれば `<base>` で相対パスを救う案もあるが、本設計では使わない(presentHtml の現状の URL 解釈に変更を入れたくないため)

## 6. 関連

- 現状調査: `docs/image-path-routing.md`
- 直近の関連修正: PR #961 (`ab0518a6`, `b11c3256`)
- 画像生成パスの実装: `server/utils/files/image-store.ts`(`saveImage`)
- workspace dir 定数: `server/workspace/paths.ts:43-94`(`WORKSPACE_DIRS.images = "artifacts/images"`)
