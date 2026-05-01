# presentHtml プレビューの CSP が Safari で同一オリジン画像をブロックする問題の修正

## 概要

PR #982 で `presentHtml` のプレビューを `<iframe :src="/artifacts/html/...">` + `sandbox="allow-scripts"` に切り替えてから、Safari で `<img src="../images/...">` がすべて CSP `img-src` 違反でブロックされる:

```
[Error] Refused to load http://localhost:5173/artifacts/images/2026/04/<hash>.png
because it does not appear in the img-src directive of the Content Security Policy.
```

Chrome では同じ HTML が問題なく動く。

## 原因

二段階の問題が重なっていた:

### 1. `'self'` がオパーク・オリジンの iframe で機能しない (Safari)

iframe は `sandbox="allow-scripts"` のみ — `allow-same-origin` を意図的に外している(PR #982 のセキュリティ強化)。CSP3 の仕様上、サンドボックスでオパーク・オリジンになったドキュメントでも `'self'` はドキュメント URL のスキーム/ホスト/ポートに対してマッチすべきだが、**Safari/WebKit は `'self'` をオリジン・タプルに対して評価する**。オパーク・オリジンに同一オリジン URL は決してマッチしないため、`/artifacts/images/...` への参照がすべて拒否される。

Chrome は `'self'` をドキュメント URL に対してマッチする実装(仕様準拠)なので動いてしまう。

PR #982 ではすでに **print iframe**(`srcdoc` でロード → 確実にオパーク・オリジン)で同じ問題に当たっており、`buildPrintCspContent(origin)` で `'self'` を明示オリジンに置き換えるパッチが入っている。**プレビュー側だけ対応漏れだった**。

### 2. dev で Vite proxy が `Host` を書き換えている

サーバが `req.get("host")` から組み立てたオリジンを CSP に入れる素朴な実装だと、dev では誤った値になる:

- ブラウザ: `http://localhost:5173/artifacts/html/...`(Vite dev server 経由)
- Vite が `/artifacts/html` を `localhost:3001` の Express にプロキシする際、`changeOrigin: true` で `Host` ヘッダを `localhost:3001` に書き換える
- Express の `req.get("host")` は `localhost:3001` を返す
- CSP が `img-src http://localhost:3001 ...` で送られる
- iframe ドキュメントのオリジンは `localhost:5173` → 同一オリジンの画像参照が CSP にマッチせず、結局ブロックされる

prod では Vite 経由ではないので `req.get("host")` で正しいが、dev でだけ壊れる。

## 修正方針

### A. `buildHtmlPreviewCsp` にオプション引数 `origin` を足す

`origin` が渡されたら `img-src 'self' ...` ではなく `img-src ${origin} ...` を出力する。`buildPrintCspContent` と同じ仕組み(後者は前者へ委譲する thin wrapper にする)。

省略時は `'self'` のまま — `wrapHtmlWithPreviewCsp` 経由の `srcdoc` フォールバック(FileContentRenderer の非 `/artifacts/html` パス)はそのまま動く。

### B. Express で X-Forwarded-Host を尊重

`/artifacts/html` のミドルウェアで CSP ヘッダを組み立てるとき:

```ts
const fwdHost = req.get("x-forwarded-host");
const fwdProto = req.get("x-forwarded-proto");
const host = fwdHost ?? req.get("host");
const proto = fwdProto ?? req.protocol;
const origin = `${proto}://${host}`;
res.setHeader("Content-Security-Policy", buildHtmlPreviewCsp(origin));
```

prod ではフォワード・ヘッダが無いので生の `Host` / `req.protocol` にフォールバック。

### C. Vite に `xfwd: true` を追加

`/artifacts/html` プロキシ・エントリで `changeOrigin: true` と並べて `xfwd: true` を有効化。これで `X-Forwarded-Host` / `X-Forwarded-Proto` がオリジナル値(`localhost:5173` / `http`)で Express に届く。

`changeOrigin` は残すこと — 削るとプロキシ先によっては仮想ホスト・ルーティングが壊れる可能性がある。両方有効化が標準パターン。

## 変更内容

| ファイル | 変更 |
|---|---|
| `src/utils/html/previewCsp.ts` | `buildHtmlPreviewCsp(origin?, cdns?)` に拡張。`buildPrintCspContent` を委譲化 |
| `server/index.ts` | `/artifacts/html` ミドルウェアで `X-Forwarded-Host`/`Proto` を見て origin を組み立てて `buildHtmlPreviewCsp(origin)` に渡す。古いコメント(「`'self'` がサーバ・オリジンにマッチする」)を実態に合わせて差し替え |
| `vite.config.ts` | `/artifacts/html` プロキシに `xfwd: true` を追加。理由を 1 段落でコメント |
| `test/utils/html/test_previewCsp.ts` | `buildHtmlPreviewCsp(origin)` の origin 置換テストを追加。既存の `'self'` デフォルト・テストはそのまま |

prod 路線に影響なし(オリジンが正しく取れるだけ)。`srcdoc` フォールバック路線(`wrapHtmlWithPreviewCsp`)もそのまま — `'self'` を使い続ける。

## テスト

### 自動

- `yarn test` — `test_previewCsp.ts` の追加テスト + 既存テストすべて pass
- `yarn lint` / `yarn typecheck` / `yarn build` 緑

### 手動 (Safari)

1. `yarn dev` 再起動 (Vite config 変更を取り込むため)
2. `presentHtml` で画像を含むスライドを生成
3. プレビュー iframe で画像が表示されることを確認
4. DevTools → Network → `/artifacts/html/<...>.html` のレスポンス・ヘッダを確認:
   - `Content-Security-Policy: ... img-src http://localhost:5173 ...` (5173 になっていること)
5. 同じく Chrome で regress していないこと
6. `Save as PDF` で印刷ダイアログまで進めて画像が乗っていることを確認(print 経路は元から `buildPrintCspContent` を使っているので影響なし、念のため)

## 関連

- PR #982: presentHtml の filePath-only 移行(本問題のリグレッション元)
- PR #980: `/artifacts/html` static mount の導入
