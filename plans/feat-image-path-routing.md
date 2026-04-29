# 画像パスのルーティング再設計 — 実装プラン

設計の背景・代替案・却下理由は `docs/discussion-image-path-routing.md` 参照。
現状の挙動の精密な audit は `docs/image-path-routing.md`(英語)参照。本ファイルは「何をどの順で実装するか」だけを書く。

## ゴール(再掲)

1. LLM に相対パスを書かせる(出力の混乱を抑える)
2. ワークスペースを OS で直接開いた時にも画像が解決する
3. 内部ファイル構成変更に強い rewriter にする(定数依存を捨てる)
4. rewriter の出力 URL を proxy URL 形式(`/artifacts/images/...`)に整理

## 全体構成

| レイヤー | 仕事 |
|---|---|
| LLM プロンプト | 相対パスを推奨、絶対パスも許容、ハードコード回避 |
| rewriter | 相対パス → 絶対URLに正規化、絶対パスはパススルー、source位置を引数化 |
| Express static mount | `/artifacts/images` だけ静的配信、拡張子 allowlist |
| ブラウザ `<img onerror>` | 404時に `artifacts/images/<rest>` パターンで URL 再構築 retry |

各レイヤーは独立。段階的ロールアウトが可能。

---

## Stage 1: `/artifacts/images` static mount + rewriter 出力 URL 切替

「**理論上、互換性が完璧**」の段。サーバ側に static mount を追加し、rewriter の出力先を `/artifacts/images/...` 形式に切り替える。既存の `/api/files/raw` ルートは触らないため、既存出力を含めて挙動が一切変わらない。

### 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `server/index.ts`(または route 登録の中央点) | `app.use('/artifacts/images', express.static(WORKSPACE_PATHS.images, { dotfiles: 'deny', fallthrough: false }))` を追加。拡張子 allowlist middleware を前段に挟む |
| `src/utils/image/resolve.ts` | `resolveImageSrc()` を改修。入力が `artifacts/images/` 配下なら `/artifacts/images/<rest>`、それ以外は現状の `/api/files/raw?path=<encoded>` を返す |
| `src/utils/image/rewriteMarkdownImageRefs.ts` | 出力 `<img>` に `data-orig` 属性を付与(stage 3 で使う種を仕込む) |
| `src/utils/image/rewriteHtmlImageRefs.ts` | 同上 |

### 拡張子 allowlist の中身

`/artifacts/images` は画像配信専用。以下のみ通す:

- `.png` / `.jpg` / `.jpeg` / `.webp` / `.gif` / `.svg`

PDFは `artifacts/images/` には入らないので allowlist 不要。`.png` 以外を Gemini が出すかは要確認(現状 `saveImage` は `.png` 固定 — `image-store.ts:36`)、必要なら拡張する。

### `resolveImageSrc` の挙動表

| 入力 | 出力 |
|---|---|
| `/artifacts/images/2026/04/foo.png` | `/artifacts/images/2026/04/foo.png` (パススルー) |
| `artifacts/images/2026/04/foo.png` | `/artifacts/images/2026/04/foo.png` (`/` 付与) |
| `data/wiki/sources/foo.png` | `/api/files/raw?path=data%2Fwiki%2Fsources%2Ffoo.png` (現状維持) |
| `http://...` / `https://...` / `data:...` | パススルー |

ソースファイル位置からの相対 resolve は呼び出し側(`rewriteMarkdownImageRefs`)が事前に行う。`resolveImageSrc` は入力 path を URL に変換するだけのレイヤーに保つ。

### rewriter の source-file 引数化

`rewriteMarkdownImageRefs(content, basePath)` を `rewriteMarkdownImageRefs(content, sourceFilePath)` に変更:

- 入力の `sourceFilePath` は workspace-relative の md/html パス(例: `data/wiki/pages/my-page.md`)
- 内部で `dirname(sourceFilePath)` を base として相対 resolve

呼び出し側(`src/plugins/wiki/View.vue` 等)は WIKI_BASE_DIR 定数ではなく **実際のソースファイルパス** を渡す。これで Goal 3(構成変更耐性)が達成される。

### 受け入れ条件

- [ ] 既存の wiki ページ(`/artifacts/images/...` への相対 climb で書かれている)が変わらず表示される
- [ ] 新規生成画像(Gemini)が `/artifacts/images/YYYY/MM/<id>.png` で表示される
- [ ] 新規生成画像が `<img>` の `src` で `/artifacts/images/...` の URL になっている(devtools で確認)
- [ ] `/api/files/raw?path=...` で参照していた画像も引き続き表示される
- [ ] `data/wiki/sources/` の non-image ファイル(あれば)も引き続き `/api/files/raw` 経由で動く
- [ ] `format` / `lint` / `typecheck` / `build` 全部緑
- [ ] e2e の image-plugins / wiki 系テストが通る

### Out of scope(stage 1 では触らない)

- LLM プロンプト変更(stage 2)
- ブラウザ onerror 復旧(stage 3)
- §8 の rewriter ギャップ埋め(`<source>`, `<video>`, CSS `url()` 等。stage 4)

---

## Stage 2: LLM プロンプト改訂

### 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `server/agent/prompt.ts`(または該当 system prompt) | 「画像参照規約」セクションを追加 / 既存の画像言及を整合 |
| 個別ロール / プラグインの prompt | 画像言及があれば同規約に合わせる |

### prompt に書く内容(草案)

```
## Image references in markdown / HTML

- ALWAYS use a relative path that resolves correctly against the
  source file (the .md / .html being written).
  - For images saved by `saveImage` (Gemini / canvas / edit),
    that path is `artifacts/images/YYYY/MM/<id>.png` —
    write a relative climb to it from the source file location.
- Absolute path `/artifacts/images/...` is also accepted.
- NEVER embed `data/...` or `artifacts/...` as a workspace-rooted
  no-leading-slash form (e.g. `data/wiki/sources/foo.png`) —
  the browser misresolves it against the page URL.
- NEVER write `/api/files/raw?path=...` (server URL form) —
  it's a runtime artifact, not a stored convention.
```

### 受け入れ条件

- [ ] prompt 改訂後の生成出力で、画像参照の99%以上が「相対パス または `/artifacts/images/` 始まり」
- [ ] 1〜2件の wiki 生成、HTML 生成を試して目視確認
- [ ] CI の prompt 関連テスト(あれば)が通る

### 補足

prompt 変更だけでは LLM の遵守率が100%にならない可能性。残りは stage 3 の onerror で吸収。

---

## Stage 3: ブラウザ側 `<img onerror>` self-repair

### 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `src/composables/useImageErrorRepair.ts` (新規) | `<img>` の error イベントをグローバルキャッチして `artifacts/images/<rest>` パターンで URL 再構築する composable |
| `src/App.vue`(または wiki / markdown View 共通の親) | 上記 composable をマウント |
| `src/plugins/presentHtml/View.vue` | iframe srcdoc に同等のスクリプトを inject(parent から `postMessage` 経由で composable と統合 or 単独スクリプト) |

### 復旧ロジック

```ts
function repairImage(img: HTMLImageElement): void {
  if (img.dataset.tried) return;       // 無限ループ防止
  img.dataset.tried = '1';

  const orig = img.dataset.orig || img.src;
  const m = orig.match(/artifacts\/images\/.+/);
  if (m) {
    img.src = '/' + m[0];
  }
}
```

`data-orig` は stage 1 で rewriter が付与済み。

### 受け入れ条件

- [ ] 故意に壊した URL(`/wrong/prefix/artifacts/images/foo.png`)を含む test ページを作って、ブラウザで開いた時に画像が復旧する
- [ ] presentHtml(iframe srcdoc)内でも復旧する
- [ ] 復旧不能なケース(`artifacts/images/<rest>` パターンが含まれない)で無限ループしない
- [ ] 既存 e2e が壊れない

---

## Stage 4(別 PR、優先度低): rewriter §8 ギャップ埋め

stage 3 までで実用上は閉じているが、サーバ往復が発生するのを避けるため最終的には rewriter 側で吸収:

| 対応 | 場所 |
|---|---|
| HTML rewriter で `<source>`, `<video>`, `<a href>`, CSS `url()` | `rewriteHtmlImageRefs.ts` |
| HTML rewriter で single-quoted `src` | 同上 |
| markdown rewriter で生 `<img>` HTML タグ | `rewriteMarkdownImageRefs.ts` |
| `textResponse/View.vue` への rewriter 適用 | 該当 View |

各々独立した小 PR で良い。Stage 4 は本ドキュメント外で別 issue として trakする。

---

## Rollout 順序

1. Stage 1 を独立 PR で merge → 1〜2日間モニタ → 既存出力に問題なければ
2. Stage 2 を独立 PR で merge → LLM出力サンプル目視 → 必要なら微調整
3. Stage 3 を独立 PR で merge → 復旧動作確認

各 stage の独立性は維持(stage 2 / 3 が無くても stage 1 単体で完全動作、後続もそう)。

## Risks / Open Questions

- **拡張子 allowlist の運用**: Gemini が将来 `.webp` を出すなら更新が必要。allowlist は中央化(`server/api/routes/static-image.ts` 等)に置く?
- **`data-orig` 属性のサイズ影響**: 画像が大量(数百)ある wiki ページで属性増加によるDOM サイズ影響。実測してから判断。
- **presentHtml iframe srcdoc の onerror**: srcdoc 内には parent と通信する手段がない(同一origin扱いのはず)。実装で工夫が要る。
- **既存の `data/wiki/sources/` のような `data/` 配下画像**: 現状実測では `artifacts/images/` 一択のはずだが、見落としがあれば mount 拡張が必要。

## 関連

- 設計議論: `docs/discussion-image-path-routing.md`
- 現状調査: `docs/image-path-routing.md`
- 直近の関連 PR: #961
- 画像生成: `server/utils/files/image-store.ts`
