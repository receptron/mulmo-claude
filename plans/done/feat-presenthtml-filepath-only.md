# presentHtml: HTML を捨てて filePath だけ渡す — 実装プラン

## 背景

現状の `presentHtml` ツールは生成された HTML 文字列をクライアントに返し、`View.vue` が `<iframe :srcdoc="html">` でレンダリングしている。これには 3 つの問題がある:

1. **相対パス画像の解決が破綻**: `srcdoc` ドキュメントのベース URL は `about:srcdoc` なので、LLM が書いた `<img src="../images/...">` が 404 する。これを救うために `rewriteHtmlImageRefs` で URL 書き換え + Stage 3 (#974) の `IMAGE_REPAIR_INLINE_SCRIPT` で onerror 修復、と二段階で当てている
2. **chat 履歴 JSONL の bloat**: `data.html` がツール結果として JSONL に書き込まれる。スライド / Chart.js を含む HTML は 50–200KB ザラ。1 セッションで何度もプレゼンを生成すると JSONL が MB 級に膨らむ。`session-store` の backfill / chat-index も毎回これをパースしている
3. **single source of truth の破綻**: ファイル(`artifacts/html/<auto>.html`)とツール結果の `data.html` が同じ内容を二重に持つ。`workspace is the database; files are the source of truth` という哲学から外れる

PR #980 (`fix/files-html-preview-relative-paths`) で `/artifacts/html` の path-based static mount + `htmlPreviewUrlFor()` ヘルパが導入されたので、presentHtml もこれに乗せれば 3 つともまとめて解消できる。

## ゴール

1. サーバの `presentHtml` ルートが `data.html` を返さなくなる(`filePath` と `title` のみ)
2. `View.vue` が `<iframe :src="/artifacts/html/<rest>">` 経由で表示する(`srcdoc` 経路は完全削除、後方互換も持たない)
3. `sandbox` を `allow-scripts` のみに揃える(`allow-same-origin` / `allow-modals` を削除、Files ビューと同等のセキュリティ境界)
4. `Show Source` ボタンは `/api/files/raw` で遅延 fetch する形に
5. `printToPdf` は **fetch + modify + 自走 print** の路線(下記 §5 で詳説)
6. `rewriteHtmlImageRefs` を View.vue から外す(他参照が無ければ delete)

## 依存

- PR #980 がマージ済みであること(`/artifacts/html` static mount + `htmlPreviewUrlFor()` が main にある)。マージ前に着手する場合は #980 をベースにする

## 全体構成

| レイヤー | 変更 |
|---|---|
| `server/api/routes/presentHtml.ts` | レスポンスの `data` から `html` を削る。`{ message, instructions, data: { title, filePath } }` を返す |
| `src/plugins/presentHtml/definition.ts` | tool description に **relative-path ルール** を明記(§0 参照) |
| `src/plugins/presentHtml/index.ts` | `PresentHtmlData` から `html` を削除 |
| `src/plugins/presentHtml/View.vue` | `srcdoc` 経路を削除、`:src=htmlPreviewUrlFor(filePath)` 一本化。`sandbox="allow-scripts"`。`Show Source` を遅延 fetch に。`printToPdf` を fetch+modify+自走 print に書き換え |
| `src/plugins/presentHtml/Preview.vue` | (要確認)`data.html` を使っているなら filePath ベースに変更 |
| `src/utils/image/rewriteHtmlImageRefs.ts` | View.vue から呼び出しが消えれば delete(他参照を grep して確認) |
| `test/composables/test_useImageErrorRepair.ts` | 既存維持(Stage 3 のグローバル修復は他経路で必要なので残す) |

---

## 0. ツール定義に書き込む LLM 向けルール

`presentHtml` で生成された HTML ファイルは `artifacts/html/<YYYY>/<MM>/<slug>-<ts>.html` に保存される(`buildArtifactPath`)。同じ会話で `presentImage` 等が返してくる workspace パス(例: `artifacts/images/2026/04/foo.png`)を `<img>` で参照したくなる。

**重要な制約**: 生成 HTML はホスト OS のブラウザで `file://` 経由でも開けるべき(ユーザがファイルマネージャからダブルクリックする / 別マシンに送る等)。サーバ origin は前提にできない。

**ルール**: ワークスペース内のリソースは **相対パス** で参照する。HTML ファイル自身が `artifacts/html/<YYYY>/<MM>/` に居るので、他の `artifacts/<kind>/<YYYY>/<MM>/...` に届くには **3 段** 上がる:

```html
<!-- GOOD -->
<img src="../../../images/2026/04/foo.png">
<img src="../../../charts/2026/04/bar.svg">

<!-- BAD: file:// で開いた時に filesystem root を見て壊れる -->
<img src="/artifacts/images/2026/04/foo.png">

<!-- BAD: html/<YYYY>/<MM>/ から見ると間違った階層を指す -->
<img src="artifacts/images/2026/04/foo.png">
```

`presentImage` 等が返すパスは `artifacts/images/2026/04/foo.png` 形式なので、LLM は **先頭の `artifacts/` を `../../../` に置換** すれば良い。

これは preview / print / file:// のすべてで一貫して動く:

| 経路 | base URL | `../../../images/...` の解決先 |
|---|---|---|
| preview iframe (`/artifacts/html/<rest>` static mount) | `<server>/artifacts/html/<YYYY>/<MM>/page.html` | `<server>/artifacts/images/<YYYY>/<MM>/...` ✓ |
| print iframe (srcdoc + 注入 `<base href="/artifacts/html/<dir>/">`) | `<base href>` の値 | `<server>/artifacts/images/<YYYY>/<MM>/...` ✓ |
| `file://` (ホストブラウザでダブルクリック) | `file:///.../artifacts/html/<YYYY>/<MM>/page.html` | `file:///.../artifacts/images/<YYYY>/<MM>/...` ✓ |

`definition.ts` の `html` parameter description を以下のように改訂:

```ts
html: {
  type: "string",
  description: [
    "Complete, self-contained HTML string. CSS and JavaScript must be inline or loaded via CDN.",
    "Must be a full document (include <!DOCTYPE html> and <html>/<body> tags).",
    "",
    "FILE LOCATION: this HTML is saved to `artifacts/html/<YYYY>/<MM>/<slug>-<timestamp>.html`.",
    "",
    "REFERENCING WORKSPACE FILES (images, charts, other artifacts): use RELATIVE paths with exactly three `../` to climb out of `html/<YYYY>/<MM>/`. The file must remain portable — the user may open it directly from disk via file://, where absolute URLs do not work.",
    "  GOOD: <img src=\"../../../images/2026/04/foo.png\">",
    "  BAD:  <img src=\"/artifacts/images/2026/04/foo.png\">  (breaks under file://)",
    "  BAD:  <img src=\"artifacts/images/2026/04/foo.png\">    (resolves wrong from html/YYYY/MM/)",
    "Workspace paths returned by other tools (e.g. presentImage returns `artifacts/images/2026/04/foo.png`): replace the leading `artifacts/` with `../../../`, giving `../../../images/2026/04/foo.png`.",
  ].join("\n"),
},
```

`title` description は変更なし。

---

## 1. サーバルート

`server/api/routes/presentHtml.ts:32-50`:

```ts
// Before
res.json({
  message: `Saved HTML to ${filePath}`,
  instructions: "Acknowledge that the HTML page has been presented to the user.",
  data: { html, title, filePath },
});

// After
res.json({
  message: `Saved HTML to ${filePath}`,
  instructions: "Acknowledge that the HTML page has been presented to the user.",
  data: { title, filePath },
});
```

`PresentHtmlSuccessResponse.data` 型から `html` を落とす。LLM が呼ぶツールの引数は変わらない(リクエストは `{ html, title }` のまま)。

## 2. プラグイン型

`src/plugins/presentHtml/index.ts:10-14`:

```ts
// Before
export interface PresentHtmlData {
  html: string;
  title?: string;
  filePath: string;
}

// After
export interface PresentHtmlData {
  title?: string;
  filePath: string;
}
```

`...result.data` 展開はそのまま動作(展開元から `html` が消えるだけ)。

## 3. View.vue — レンダリング切替

### 構造

`htmlPreviewUrlFor()` を `useContentDisplay.ts` から再利用。Files ビューと同じヘルパで `/artifacts/html/<rest>` を計算する。

```vue
<iframe
  ref="iframeRef"
  :src="previewUrl"
  sandbox="allow-scripts"
  class="flex-1 w-full border-0"
/>
```

`previewUrl = computed(() => htmlPreviewUrlFor(data.value?.filePath ?? null))`。`null` の場合(あり得ないが防御的に)エラー表示。

### 削除されるもの

- `import { rewriteHtmlImageRefs } from "../../utils/image/rewriteHtmlImageRefs"` — もう不要
- `import { IMAGE_REPAIR_INLINE_SCRIPT } from "../../composables/useImageErrorRepair"` — `srcdoc` 注入が消えるので不要(Stage 3 のグローバル修復は親 SPA の `useGlobalImageErrorRepair` が `App.vue` で常駐しているので、そこから副次的にカバーされる)
- `PRINT_STYLE` 定数 — printToPdf 側に移して fetch+modify 時に注入する
- `REPAIR_SCRIPT` 定数 — 上記 import 削除と連動
- `headInjection` / `html` computed — `srcdoc` を作る材料だったので不要
- `sandbox` 属性: `"allow-scripts allow-same-origin allow-modals"` → `"allow-scripts"` のみ

### Sandbox を狭める意義

`allow-same-origin` を外すことで iframe ドキュメントは opaque origin になる。同 origin URL からロードしても sandbox の隔離は維持される。LLM 生成 HTML が parent SPA の Cookie / localStorage / DOM に届かなくなる(現状は届く設定だった、これは脅威モデル的に強気すぎた)。

`allow-modals` も外す。LLM が `alert()`/`confirm()`/`prompt()` を出すケースが今のところ実用上ないなら、攻撃面を減らす方が良い。仮にどこかで LLM が出していたとしても、ダイアログがブロックされるだけで HTML 自体は表示される。

## 4. Show Source — 遅延 fetch

textarea に流し込むソースを、クリック時にファイル本体から取得する:

```ts
const sourceCache = ref<string | null>(null);
const sourceLoading = ref(false);
const sourceError = ref<string | null>(null);

async function toggleSource() {
  if (sourceOpen.value) {
    sourceOpen.value = false;
    return;
  }
  sourceOpen.value = true;
  if (sourceCache.value !== null) return; // already fetched
  if (!data.value?.filePath) return;
  sourceLoading.value = true;
  sourceError.value = null;
  try {
    const resp = await fetch(
      `${API_ROUTES.files.raw}?path=${encodeURIComponent(data.value.filePath)}`,
      { headers: { Authorization: `Bearer ${getAuthToken()}` } }
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    sourceCache.value = await resp.text();
  } catch (err) {
    sourceError.value = String(err);
  } finally {
    sourceLoading.value = false;
  }
}
```

textarea は `:value="sourceCache ?? ''"`、ローディング中はスピナー表示。エラー時は赤バナー。一度取得すればコンポーネント生存中はキャッシュ(ファイルが書き換わることは presentHtml の場合まずないので、再取得なしで十分)。

`API_ROUTES.files.raw` は既存(`src/config/apiRoutes.ts`)。bearer 認証は `apiGet` / `apiPost` ヘルパが付けてくれるが、レスポンスを `text()` で受ける必要があるので生 `fetch` で書く。`apiGet` がテキスト対応していればそれを使う(要確認)。

## 5. printToPdf — fetch + modify + 自走 print

### 設計

iframe.contentWindow.print() は opaque origin で叩けない。代わりに **印刷専用の hidden iframe を作り、その中の HTML が自分で `window.print()` を呼ぶ**ようにする。

```ts
async function printToPdf() {
  if (!data.value?.filePath) return;
  const filePath = data.value.filePath;

  // 1. ファイル本体を取得
  const resp = await fetch(
    `${API_ROUTES.files.raw}?path=${encodeURIComponent(filePath)}`,
    { headers: { Authorization: `Bearer ${getAuthToken()}` } }
  );
  if (!resp.ok) {
    // TODO: error toast
    return;
  }
  const sourceHtml = await resp.text();

  // 2. <head> に注入する4点を組み立てる
  const baseDir = htmlPreviewUrlFor(filePath); // /artifacts/html/<rest>
  if (!baseDir) return;
  const baseHrefDir = baseDir.replace(/[^/]+$/, ""); // strip filename → directory URL
  const cspMeta = buildPrintCspMeta(window.location.origin);
  const injection = `
    <base href="${baseHrefDir}">
    ${cspMeta}
    <style>${PRINT_STYLE_CSS}</style>
    <script>addEventListener("load", () => setTimeout(() => window.print(), 100));</script>
  `;
  const printableHtml = sourceHtml.includes("</head>")
    ? sourceHtml.replace("</head>", `${injection}</head>`)
    : `<head>${injection}</head>${sourceHtml}`;

  // 3. 隠し iframe を作って srcdoc に注入済み HTML をセット
  const printFrame = document.createElement("iframe");
  printFrame.style.cssText = "position:fixed;left:-10000px;top:0;width:0;height:0;border:0";
  printFrame.sandbox.value = "allow-scripts allow-modals";
  printFrame.srcdoc = printableHtml;
  document.body.appendChild(printFrame);

  // 4. 一定時間後にクリーンアップ(プリントダイアログはユーザがモーダルで閉じる)
  setTimeout(() => printFrame.remove(), 60_000);
}
```

### 注入物の意味

| 注入 | 役割 |
|---|---|
| `<base href="/artifacts/html/<dir>/">` | 相対 `<img src="../images/...">` が `/artifacts/images/...` に解決するようにする。末尾スラッシュ重要 |
| `<meta http-equiv="Content-Security-Policy" content="...img-src ${origin}...">` | srcdoc の opaque origin では `'self'` がサーバ origin にマッチしないので、`window.location.origin` を明示的に許可。CDN allowlist と `connect-src 'none'` は維持 |
| `<style>${PRINT_STYLE_CSS}</style>` | `@media print` の上書きルール。LLM HTML が独自に持っていたら追加で被るが、後勝ちで問題なし |
| `<script>addEventListener("load", () => setTimeout(window.print, 100))</script>` | 全リソース load 完了後に自分で `window.print()`。`allow-modals` でプリントダイアログがモーダル表示できる |

### CSP の動的構築

`src/utils/html/previewCsp.ts` の `buildHtmlPreviewCsp()` を流用しつつ、`img-src` のみ `'self'` を `${origin}` に置換するヘルパを追加:

```ts
// previewCsp.ts に追加
export function buildPrintCspContent(origin: string): string {
  const cdnList = HTML_PREVIEW_CSP_ALLOWED_CDNS.join(" ");
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${cdnList}`,
    `style-src 'unsafe-inline' ${cdnList}`,
    `font-src ${cdnList}`,
    `img-src ${origin} ${cdnList} data: blob:`, // ← here
    "connect-src 'none'",
  ].join("; ");
}
```

### PRINT_STYLE の所在

現状 `View.vue:40-44` にある `PRINT_STYLE` (CSS 文字列) を `presentHtml/printStyles.ts` あたりに切り出して定数化:

```ts
export const PRINT_STYLE_CSS = `@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  body { width: 100% !important; margin: 0 !important; padding: 8px !important; }
  @page { margin: 10mm; }
}`;
```

## 6. rewriteHtmlImageRefs の扱い

`grep -rn rewriteHtmlImageRefs --include="*.ts" --include="*.vue"` で参照を確認:

- `src/plugins/presentHtml/View.vue` ← この PR で削除
- `src/utils/image/rewriteHtmlImageRefs.ts` ← 本体
- `test/utils/image/test_rewriteHtmlImageRefs.ts` ← テスト

View.vue から外れて他参照が無ければ、本体とテストごと **delete** する。`resolveImageSrc` (Stage 1) と `IMAGE_REPAIR_INLINE_SCRIPT` (Stage 3) で機能は完全に置き換わっている。

## 7. Preview.vue の確認(要 grep)

`src/plugins/presentHtml/Preview.vue` も `data.html` を読んでいる可能性があるので、**実装前に必ず確認**:

```bash
grep -n "data\.html\|html" src/plugins/presentHtml/Preview.vue
```

参照していたら同様に `filePath` ベースに切替。サムネイル用途で軽量な表示なら、`<iframe :src=...>` のミニ版で済む。

## 受け入れ条件

- [ ] LLM から presentHtml ツール呼び出し → サーバが `artifacts/html/<auto>.html` に書き込む(従来通り)
- [ ] レスポンス `data` に `html` が含まれない、`{ title, filePath }` のみ
- [ ] chat 履歴 JSONL の `tool_result` レコードサイズが大幅に減る(visual diff 確認: HTML 1 つにつき >50KB 削減)
- [ ] presentHtml の View が `<iframe :src="/artifacts/html/<rest>">` でレンダリング(devtools の Network で確認)
- [ ] HTML 内の `<img src="../images/...">` 相対パスが表示される
- [ ] HTML 内の `<img src="/artifacts/images/...">` 絶対パスが表示される
- [ ] iframe の sandbox が `"allow-scripts"` のみ(devtools で attribute を確認)
- [ ] Show Source ボタン: 初回クリックで fetch、textarea にソース表示。再クリックで toggle close、再再クリックでキャッシュから即時表示
- [ ] PDF ボタン: 印刷ダイアログが立ち上がり、Save as PDF でレイアウトが崩れずに保存できる
- [ ] PDF 印刷時に `<img src="../images/...">` 相対画像も正しく印刷される
- [ ] `rewriteHtmlImageRefs` が delete されている、または他参照が残っていれば残してその旨記録
- [ ] `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` 緑
- [ ] 既存 unit / e2e テストが通る、`buildPrintCspContent` の単体テスト追加

## Out of scope

- 過去の chat 履歴 JSONL に残る `data.html` フィールドの retroactive 削除(マイグレーションスクリプトは作らない、自然減で OK)
- `data.html` を読み続ける後方互換ブランチ(ユーザ指定で「気にしない」)
- `Preview.vue` のサムネイル表示の劇的な作り変え(`data.html` を使っていない場合は何もしない)

## セキュリティ memo

- iframe sandbox を `"allow-scripts"` のみに狭めることで **opaque origin** に固定。LLM HTML が parent SPA の Cookie / localStorage / DOM に到達できなくなる(セキュリティ強化)
- `connect-src 'none'` は preview / print 両方で維持 → phone-home 防止は不変
- 印刷時の `<meta>` CSP は dev で `http://localhost:5173` (Vite proxy 経由)、prod で `http://localhost:3001` (Express 同 origin) — `window.location.origin` で動的算出するので環境差吸収
- 印刷用 hidden iframe は `srcdoc` 経由なので静的 mount のヘッダ CSP は適用されない(代わりに `<meta>` で当てる)。これは設計上必要な使い分け

## 想定外の落とし穴

- **fetch 中のレースコンディション**: ユーザが Show Source とほぼ同時に PDF を押すと 2 重 fetch になる。許容(両方とも単独に成功する)
- **大きな HTML での印刷遅延**: load イベント発火後に `setTimeout(print, 100)` で猶予を入れているが、画像が 10 枚 / 20 枚と多いケースでは load 後でも layout 計算が続いている可能性。エッジケースで余白がずれることがあれば 100ms を 300ms に上げる
- **Vite dev で `/api/files/raw` が proxy されるか**: vite.config.ts で `/api` が proxy 済み(line 64-67)なので OK
- **filePath が `artifacts/html/` 外のレコード**(あり得るか?): `presentHtml` ルートは常に `WORKSPACE_DIRS.htmls` に書くので存在しないはず。`htmlPreviewUrlFor` が `null` を返したら防御的にエラー表示
