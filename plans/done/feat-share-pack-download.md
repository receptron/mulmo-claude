# feat: 共有機能 Phase 1 — HTML成果物を自己完結バンドル化してzip DL

Date: 2026-07-01
Issue: #1889

## ゴール

`artifacts/html/…/*.html`（自己完結HTML、ただし `../../../images/…` でworkspace画像を相対参照しうる）を、
画像などのローカル参照を書き換えて **1ディレクトリ**（`index.html` + `assets/`）に集約し、
**zipでダウンロード** → 解凍して `file://` でもそのまま開けるようにする。

インフラ・認証は不要（純ローカル）。upload/registry/MD/Wiki は後続フェーズ。

## 全体設計（参考）

```
入力 → HTML化(アダプタ) → 自己完結バンドル(書換+アセット収集) → 配信(zip DL / 後段でS3互換PUT)
```

Phase 1 は「HTML入力（HTML化スキップ）→ バンドル → zip DL」まで。

## 実装

### 1. bundleコア（純粋・テスト容易）
`server/utils/share/rewriteAssets.ts`
- `rewriteHtmlAssets(html: string): { html: string; assets: AssetRef[] }`
  - jsdom で DOM 化。`img[src]` / `link[href]` / `script[src]` / `source[src]` / `img|source[srcset]` / `a[href]`（ローカルのみ）を走査。
  - `<style>` テキストと inline `style=` の `url(...)` も対象。
  - ローカル判定: `http(s):` / `//` / `data:` / `blob:` / `mailto:` / `tel:` / `#` / 空 → 対象外。
  - 参照ごとに bundle パス `assets/<name>` を決定（basename、衝突時は元パスの短ハッシュを前置）。属性を相対パスへ書換。
  - 同一 originalRef は dedup。`AssetRef = { originalRef: string; bundlePath: string }`。
- 純粋（fs/network なし）。ユニットで参照抽出/書換/dedup/衝突/remote除外を検証。

### 2. pack IO
`server/utils/share/packHtml.ts`
- 入力: workspace相対の HTML パス。
- HTML を読む（`resolveWorkspacePath` で containment）。
- `rewriteHtmlAssets` を実行。
- 各 `originalRef` を **HTMLファイルのdir基準**で解決 → workspace内(`resolveWithinRoot`)確認 → bytes 読み込み。欠損はwarnしてスキップ（参照は残す）。
- 返す: `{ indexHtml: string; files: Array<{ bundlePath: string; bytes: Buffer }> }`。

### 3. zip + route
`server/api/routes/share.ts`
- `POST /api/share/pack` body `{ path }` → `packHtml` → `jszip` で zip 化して配信。
- `Content-Disposition: attachment; filename="<name>.zip"`。
- `API_ROUTES.share.pack` を `src/config/apiRoutes.ts` に追加。
- 依存追加: `node-html-parser`（書換, 軽量）+ `jszip`（zip）。`mulmoclaude` パッケージのランタイム依存にも宣言（publish smoke の deps 監査）。

### 4. UI（本PRでは対象外 → 追従PR）
HTMLビュー（`@mulmoclaude/html-plugin` の `View.vue`）は host-agnostic で、ホスト機能は
`runtime.dispatch` 経由でしか呼べない。`/api/share/pack` を直接 fetch するのは
**パッケージ依存方向（plugin → host 禁止）に反する**。正しくは runtime contract に
`packHtml` capability を足してホストが実装する形。これはクロスパッケージ変更のため、
本PR（バックエンド核）とは分離し **追従PR** で対応する。
ルート自体はグローバルbearer配下で叩けるので、Phase 1 の価値（bundle+zip）は本PRで完結。

## テスト
- `test/utils/share/test_rewriteAssets.ts`: img/link/script/srcset/css-url/dedup/衝突/remote除外/anchor。
- `test/utils/share/test_packHtml.ts`: tmp workspace で containment拒否・欠損アセット・正常バンドル構造。

## Out of scope（後続）
S3互換アップロード / 公開URL / 共有台帳 / Markdown・単一Wikiページ / CDNオフライン取り込み / 単一HTMLインライン版。
