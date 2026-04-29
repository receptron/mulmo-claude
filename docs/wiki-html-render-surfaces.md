# Wiki と HTML の表示サーフェス一覧

mulmoclaude では Wiki / HTML / Markdown / Spreadsheet などのコンテンツが**複数の場所**で表示されています。それぞれが異なる仕組み・異なる権限・異なる画像パス解決ルールで動くため、「ある画面では画像が出るが別の画面では壊れる」「印刷だけうまくいく/いかない」といった差異が起きやすい領域です。

このドキュメントは「どの画面で何ができるか」「相対パス画像はそのまま動くか」を一覧で把握するための早見表です。バグ調査・機能追加・PR レビュー時の参照用に。

---

## 1. レンダー方式: `<iframe>` と `v-html` の違い

mulmoclaude のすべての表示はこの2系統に分類されます。まずこの違いを押さえると残りの表が読みやすくなります。

### 1.1 比較

| 観点 | `<iframe>` | `v-html` |
|---|---|---|
| 概念 | 別文書を独立した window として埋め込む | 親 Vue コンポーネントの DOM に直接 HTML を流し込む |
| Origin | iframe ごとに opaque(隔離)または same-origin | 親と同じ |
| `<script>` 実行 | sandbox 設定次第で可 | **無視される**(Vue の `v-html` は script を実行しない) |
| 親 CSS の影響 | 届かない | フル適用(Tailwind 含む) |
| 親 DOM へのアクセス | `sandbox="allow-same-origin"` 時のみ可 | フルアクセス |
| Base URL | iframe の `src` または `srcdoc` 次第(`<base>` で上書き可) | 常に親ページの URL |
| 相対パス画像 | base URL に依存 | **常に親ページから相対**(意図と違うことが多い) |
| 想定する入力 | LLM 生成 HTML / 任意の HTML ファイル | アプリ管理下の信頼できる文字列(`marked.parse` の出力など) |
| 主な利点 | 隔離(script・CSP も含めて分離可能) | 軽量 / 親と統合された見た目 |
| 主な欠点 | 親 UI と統合しにくい / sandbox 設計が必要 | 信頼境界が脆い(XSS リスク) |

### 1.2 mulmoclaude の使い分けルール

- 「LLM が生成した HTML」「ユーザー指定の任意 HTML ファイル」 → `<iframe>` で隔離
- 「アプリが `marked.parse` した出力」「`XLSX.utils.sheet_to_html` の出力」 → `v-html`
- ESLint ルール `vue/no-v-html` は **error**。新規追加するときは `// eslint-disable-next-line vue/no-v-html -- <理由>` でその場の信頼判断を必ず残す(`CLAUDE.md` § Lint warnings 参照)。

---

## 2. Base URL と相対パス画像のおさらい

ブラウザは「現在の文書の URL」を起点に相対 URL を解決します。これを **base URL** と呼びます。

| 表示方式 | base URL | `<img src="image.png">` はどこを取りに行く? |
|---|---|---|
| 通常の Web ページ | `https://app/page` | `https://app/image.png` |
| `<iframe src="/foo/bar.html">` | `/foo/bar.html` | `/foo/image.png` |
| `<iframe srcdoc="...">` | `about:srcdoc` | **解決できず壊れる**(`<base href>` を入れない限り) |
| `v-html="<img src='image.png'>"` | 親ページの URL | 親ページから相対(画像の置き場と一致しないことが多い) |

mulmoclaude は画像を workspace の `data/` や `artifacts/images/` に置くため、ソース文字列をそのまま出すと解決できません。各サーフェスがそれぞれの方法で書き換えています。

### 2.1 mulmoclaude の画像パス書き換え戦略(3並立)

| 戦略 | 説明 | 採用サーフェス |
|---|---|---|
| **pre-parse rewriter** (`rewriteMarkdownImageRefs`) | marked の walker で `<img>` を `/api/files/raw?path=...` に書き換えてから parse する | Wiki ページ・ログ・lint、Markdown plugin、Sources brief |
| **post-LLM regex rewriter** (`rewriteHtmlImageRefs`) | LLM 生成 HTML を正規表現で書き換え + 404 修復 inline script を差し込む | presentHtml plugin |
| **path-based server mount** | サーバー側で `/artifacts/html/<rest>` を実ファイル先にマウント、iframe の `src` で直接アクセスさせ、ブラウザに普通に解決させる | Files Explorer の `artifacts/html/` 配下の HTML(PR #980) |
| **書き換えなし** | 外部 URL 前提なので何もしない | News body(RSS)、TextResponse(assistant 出力) |

3戦略並立しているのが現状の最大の課題。詳細は § 8。

---

## 3. Wiki 表示サーフェス一覧

| サーフェス | コード | ルート | 方式 | 画像パス処理 | 主な機能 |
|---|---|---|---|---|---|
| Wiki ページビュー | `src/plugins/wiki/View.vue` | `/wiki/pages/<slug>` 単独 / `/chat` の manageWiki tool result | `marked` + `v-html` | pre-parse rewriter(basePath = `data/wiki/pages/`) | 閲覧・スクロール / タスクチェックボックス編集(自動保存)/ 印刷 / **PDF ダウンロード** / Wiki 内部リンクの内部 routing / frontmatter 表示 / Content↔History タブ |
| Wiki インデックス | 同上 | `/wiki`, `/wiki/index` | カードリスト(markdown 未 parse) | 不要(画像なし) | 閲覧・スクロール / タグフィルタ(URL 未永続)/ lint chat ボタン |
| Wiki ログビュー | 同上 | `/wiki/log` | `marked` + `v-html` | pre-parse rewriter | 閲覧のみ |
| Wiki Lint レポート | 同上 | `/wiki/lint-report` | `marked` + `v-html` | pre-parse rewriter | 閲覧のみ |

---

## 4. HTML 表示サーフェス一覧

| サーフェス | コード | ルート | 方式 | 画像パス処理 | 主な機能 |
|---|---|---|---|---|---|
| Files: `artifacts/html/` 配下 | `src/components/FileContentRenderer.vue` | `/files/artifacts/html/...` | `<iframe :src>` で path-based mount | **ブラウザネイティブ解決**(PR #980) | 閲覧・スクロール / 印刷 / 元ファイル表示 |
| Files: それ以外の HTML | 同上 | 任意の `/files/*.html` | `<iframe :srcdoc>` + meta CSP | base が `about:srcdoc` なので **相対 img は解決不可**(残す) | 閲覧・スクロール / 印刷 |
| presentHtml plugin(チャット) | `src/plugins/presentHtml/View.vue` | `/chat` の tool result | iframe(`srcdoc` → `src` mount に PR #982 で移行中) | post-LLM regex rewriter + 404 修復 inline script | 閲覧 / **ソース切替** / **印刷 PDF** |
| Markdown plugin(チャット) | `src/plugins/markdown/View.vue` | `/chat` の tool result | `marked` + `v-html` | pre-parse rewriter | 閲覧 / **編集** / 保存 / **PDF ダウンロード** / **rendered↔raw 切替** / **コピー** / タスクチェックボックス |
| TextResponse plugin | `src/plugins/textResponse/View.vue` | `/chat` の assistant バブル / Files の `.md` プレビュー | `marked` + `v-html` | rewriter なし(外部 URL 前提) | 閲覧 / **PDF ダウンロード** / **コピー** / 外部リンクは別タブ |
| ManageSkills plugin | `src/plugins/manageSkills/View.vue` | `/chat` の tool result | `marked` + **DOMPurify** + `v-html` | 不要 | 閲覧 / 編集(プロジェクト skill のみ)/ 削除 / 実行 |
| Spreadsheet plugin | `src/plugins/spreadsheet/View.vue` | `/chat` の tool result | `XLSX.utils.sheet_to_html()` + `v-html` | 不要 | 閲覧 / **XLSX ダウンロード** / セル編集 |
| News body | `src/components/NewsView.vue` | `/news` または `/chat` | `marked` + `v-html`(RSS body 素通し) | 外部 URL 前提、書き換えなし | 閲覧 / 元記事リンク / 記事スコープのチャット composer |
| SourcesManager brief | `src/components/SourcesManager.vue` | `/sources` または `/chat` | `marked` + `v-html` | pre-parse rewriter(brief ファイルの basePath) | 閲覧のみ |

---

## 5. 「相対パス画像はそのまま動くか」早見表

`![](image.png)` や `<img src="image.png">` を書いて期待通り表示されるか、だけを抜き出した表。

| サーフェス | 動く? | 理由 |
|---|---|---|
| Wiki ページ | ⭕ | pre-parse rewriter で `/api/files/raw` に書き換え |
| Wiki ログ / lint | ⭕ | 同上 |
| Markdown plugin | ⭕ | pre-parse rewriter |
| Sources brief | ⭕ | pre-parse rewriter |
| TextResponse | ❌(外部 URL は ⭕) | rewriter なし。assistant が書く文章なので相対パスは想定外 |
| News body | ❌(外部 URL は ⭕) | rewriter なし。RSS は外部 URL 前提 |
| Files: `artifacts/html/` 配下の HTML | ⭕ | iframe `src` の path-based mount でブラウザが解決 |
| Files: その他の HTML | ❌ | `srcdoc` の base URL が `about:srcdoc` |
| presentHtml plugin | ⭕ | post-LLM regex rewriter + 404 修復 |
| ManageSkills | ⭕(画像なし運用) | YAML 定義に画像が出ない |
| Spreadsheet | ⭕(画像なし) | セル値のみ |

---

## 6. CSP / iframe sandbox の効き方

| サーフェス | 隔離 | CSP 配信 | `img-src` |
|---|---|---|---|
| Files: `artifacts/html/` | iframe `sandbox="allow-scripts"`(opaque origin) | サーバー HTTP ヘッダ | **明示オリジン**(PR #991)+ CDN ゲート + `data: blob:` |
| Files: それ以外 HTML | iframe `sandbox="allow-scripts"` | クライアント側 `<meta>` 注入(`wrapHtmlWithPreviewCsp()`) | `'self'`(srcdoc では機能限定的、§ 6.2 参照) |
| presentHtml | iframe `sandbox="allow-scripts"`(PR #982 で絞り込み済)+ path-based mount | サーバー HTTP ヘッダ(Files と共通ルート) | **明示オリジン**(PR #991) |
| presentHtml の印刷経路 | iframe `srcdoc` | iframe 内 `<meta>` 注入 | **明示オリジン**(PR #982 で対応済) |
| その他(`v-html` 系) | 隔離なし(親と同じ origin・DOM・CSS) | アプリ全体の CSP のみ | N/A(親ページの CSP に従う) |

`allow-same-origin` を付けると iframe が親と同じ origin になり、sandbox の隔離メリットを大きく失います。CSP もファイル内 `<meta>` で書き換えられる余地が出ます。**できる限り `allow-scripts` のみ**が原則。

### 6.1 `connect-src 'none'` / CDN ゲート / `unsafe-inline` の意図

- `connect-src 'none'`:プレビュー内の `fetch` / XHR / WebSocket をすべてブロック。LLM 出力に紛れ込んだ「外に情報を投げる」コードを止める。
- CDN ゲート(`cdn.jsdelivr.net`、`unpkg.com`、`cdnjs.cloudflare.com`、`fonts.googleapis.com`、`fonts.gstatic.com`):LLM が頻用する CDN だけ許可。広げるときは `HTML_PREVIEW_CSP_ALLOWED_CDNS` を編集して PR で監査。
- `script-src` と `style-src` は `'unsafe-inline'`:LLM 出力の HTML はインライン `<script>` / `<style>` を多用するため。

### 6.2 Safari の opaque-origin と `'self'` の罠(PR #982 / #991)

CSP 仕様上、sandbox で opaque-origin になったドキュメントでも `'self'` は「ドキュメント URL のスキーム/ホスト/ポート」にマッチすべきですが、**Safari/WebKit は `'self'` をオリジン・タプルに対して評価**します。opaque origin に同一オリジン URL は決してマッチしないため、`/artifacts/images/...` への参照がすべて拒否されます。Chrome は仕様準拠でドキュメント URL に対してマッチするため動いてしまう ── ブラウザ間でズレる。

**対策**(現状の実装):

- サーバーが配るヘッダ(`/artifacts/html/`)では `'self'` をやめて、ブラウザ可視のオリジン(`http://localhost:5173` 等)を `img-src` に直書き。dev では Vite proxy が `Host` を書き換えるので、サーバー側で `X-Forwarded-Host` / `X-Forwarded-Proto` を尊重し、Vite proxy 設定に `xfwd: true` を入れて元値を渡す。
- `presentHtml` のプレビュー(`/artifacts/html/` mount 経由)も同じヘッダ経路で利益を受けます。
- **印刷経路**(`srcdoc` で iframe を作って `print()` する独立パス)は元から明示オリジンを使う `buildPrintCspContent` で組み立て済(PR #982)。
- **未対応**:Files Explorer の「`artifacts/html/` 外の HTML」は依然として `<meta>` CSP に `'self'` が入る経路。`srcdoc` で base URL が `about:srcdoc` のため相対パスは元から壊れていて副作用が見えにくいが、ファイル内に `/api/files/raw?path=...` のような絶対同一オリジン URL が書かれていると Safari でブロックされる。§ 8 で gap として扱う。

---

## 7. ユーザー向け機能の比較表

各サーフェスでユーザーが行える操作。`◯` あり / `△` 部分的 / 空欄 = なし。

| 機能 | Wiki page | Wiki log/lint | Markdown plugin | TextResponse | presentHtml | Files HTML | News | SourcesBrief | ManageSkills | Spreadsheet |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 閲覧・スクロール | ◯ | ◯ | ◯ | ◯ | ◯ | ◯ | ◯ | ◯ | ◯ | ◯ |
| 編集 | △(タスク) | | ◯ | △(textarea) | | | | | △(プロジェクト) | ◯(セル) |
| 保存 | ◯(自動) | | ◯ | | | | | | △ | △ |
| 印刷 | ◯ | | | | ◯ | ◯(ブラウザ) | | | | |
| PDF ダウンロード | ◯ | | ◯ | ◯ | ◯ | △(Print to PDF) | | | | |
| 元ソース表示(raw) | | | ◯(切替) | ◯(切替) | ◯(切替) | ◯ | | | ◯ | ◯ |
| コピー | | | ◯ | ◯ | | | | | | |
| 元ファイル / 外部リンク | | | | | | ◯ | ◯ | | | |
| 内部リンク routing | ◯(wiki link) | | △ | △ | | | | | | |
| 別形式ダウンロード | | | | | | | | | | ◯(XLSX) |

---

## 8. 既知のギャップ・差異

PR #980 / #981 / #982 / #983 のレビューや実装観察から見えている差異:

1. **画像パス書き換えロジックが3並立**(§ 2.1)— pre-parse rewriter / post-LLM regex / server mount。1つの marked-aware unified rewriter にまとめれば surface 間の差を吸収できる。今後の検討候補。
2. **News / SourcesBrief は外部 HTML を `marked + v-html` で素通し** — どちらも DOMPurify を通していない。RSS や外部 brief に tracking pixel / 隠し iframe / hostile script が混じった場合、 `v-html` の信頼境界が崩れる。`vue/no-v-html` 監査では「LLM/app-owned」を理由に許可しているが、News と Sources は外部入力。**DOMPurify 追加候補**。
3. **Wiki に raw `.md` ダウンロードがない** — Markdown plugin はコピーと PDF があるが、Wiki page は PDF と印刷のみ。raw markdown ダウンロード追加は低工数。
4. **presentHtml の sandbox が広い** — `allow-scripts allow-same-origin allow-modals`。Files HTML は `allow-scripts` のみで運用できているので、presentHtml も寄せたい(PR #982 で対応中)。
5. **Wiki タスクチェックボックスは page view だけ persist** — log / lint view 上のチェックボックスは visual だけ反応してクリックは捨てられる(read-only 扱い)。
6. **Files: `artifacts/html/` 外の HTML は相対画像が出ない** — `srcdoc` の base URL 制約。直すなら server mount を全 HTML に広げるか、iframe 内に `<base href>` を注入するかの2択。
7. **Files: `artifacts/html/` 外の HTML、Safari 上で絶対同一オリジン URL がブロックされる** — `wrapHtmlWithPreviewCsp()` が出す meta CSP が `'self'` のままで、Safari の opaque-origin 解釈と噛み合わない(§ 6.2)。実害は薄い(相対 path が元から壊れているため絶対 URL を書く HTML は稀)が、PR #991 と同じパターンで `buildHtmlPreviewCsp()` に origin を渡せるようになっているので、この経路にも明示オリジンを通す手は同じ。

---

## 9. 参考 PR

- #980 — Files Explorer `artifacts/html/` の path-based mount(merged)
- #982 — presentHtml の `srcdoc → src` 移行 + sandbox `allow-scripts` への絞り込み + 印刷経路の `buildPrintCspContent(origin)`
- #983 — image path 関連の追加調整
- #991 — presentHtml プレビューの CSP `'self'` 問題を Safari 向けに修正(`buildHtmlPreviewCsp(origin)`、`X-Forwarded-Host` 尊重、Vite proxy `xfwd: true`)
