# MulmoClaude: インストール直後にUIのスタイルが崩れる問題 — 原因特定から解決までの記録

> 症状: `git clone` 後、`http://localhost:5173` を開くと、ナビもチャット画面も
> **まったくスタイルが当たらず**、要素が重なって崩れて表示される。
>
> 環境: Windows 11 / Node.js v24.18.0 / yarn 1.22.22
>
> 結論を先に: **真因は「プラグインが未ビルドで、その `dist/style.css`・`dist/vue.js` が
> 404 になっていた」こと。** リポジトリのルートで `yarn install` →
> `yarn dev:full-build` を実行してプラグインをビルドすれば解決する。

このドキュメントは、GitHub の Issue / Discussion / `docs/troubleshooting.md` に
そのまま転記できる形式で、原因の特定過程も含めて記録したものです。

---

## 1. 真因

MulmoClaude のフロントエンドは **Vue 3 + Vite + Tailwind CSS v4**。
`src/main.ts` は各プラグインのビルド成果物を読み込む:

- `./index.css`（`@import "tailwindcss";` を含むメインCSS）
- 各プラグインの `dist/style.css`（見た目）と `dist/vue.js`（中身）

**プラグインをビルドしていないと `dist/*` が存在せず、404 になり、
チャットUI・ナビの見た目が丸ごと欠落して崩れて見える。**

### 決定的な証拠（DevTools Console）

```
Failed to load resource: 404 (Not Found)   /api/plugins/ru…0.1.1/dist/vue.js
Failed to load resource: 404 (Not Found)   /api/plugins/ru…0.1.3/dist/vue.js
Failed to load resource: 404 (Not Found)   style.css
```

- Network の `health` は `304`（サーバーは稼働）
- Elements → Styles に Tailwind v4 のテーマ変数（`var(--spacing)` 等）が出ている
  → **Tailwind 自体は正常。Node のバージョンも無関係だった**（v24.18.0 で問題なし）

---

## 2. 解決手順（本筋）

### Step 1. 正しいフォルダ（ソースリポジトリのルート）に入る

`package.json` があるフォルダで実行する。VS Code で開いているなら
**Terminal → New Terminal** が自動的にルートで開くので確実。

```powershell
dir   # package.json / src / packages / server が見えればOK
```

### Step 2. 依存をインストール

```powershell
yarn install
```

### Step 3. プラグインを含めてビルドして起動

```powershell
yarn dev:full-build
```

`dev:full-build` は「全パッケージ（プラグイン含む）をビルド → server(:3001) + Vite(:5173) 起動」を
一括で行う。成功すると server ログに次が出る:

```
[plugins/runtime] registered runtime plugins ... registered=5 collisions=0
[server] listening port=3001
```

### Step 4. ブラウザを開き直す

`http://localhost:5173` をタブごと開き直す（または `Ctrl+Shift+R`）。
スタイルが当たって表示されれば成功。

---

## 3. ハマりどころ（今回、原因特定に時間がかかった落とし穴）

### 落とし穴A: 「mulmoclaude」という名前のフォルダが2つある

| フォルダ | 中身 | package.json | ここで yarn する? |
|---|---|---|---|
| `~/mulmoclaude`（例: `C:\Users\<user>\mulmoclaude`） | .claude / config / conversations / data / artifacts | **無い** | ❌ これは MulmoClaude が作る**データ置き場**（ワークスペース） |
| ソースの clone 先（例: `...\GitHub\mulmoclaude`） | src / packages / server / **package.json** | **有る** | ✅ こちらで実行 |

`Couldn't find a package.json file in ...` が出たら、**データ置き場の方で実行している**サイン。
`package.json` があるソース側に `cd` する。

### 落とし穴B: プロジェクトを OneDrive の中に置いている

`...\OneDrive\ドキュメント\GitHub\mulmoclaude` のように OneDrive 配下に clone すると、
OneDrive が `node_modules`（特に `node_modules\.bin` の実行ファイル）を
**「クラウドのみ」に退避**し、実体が消えることがある。すると:

```
'concurrently' は、内部コマンドまたは外部コマンドとして認識されていません。
```

のように、`yarn install` は「Already up-to-date」なのにコマンドだけ見つからない、という
矛盾した状態になる。

**対処（推奨）: プロジェクトを OneDrive の外へ移す。**

```powershell
# VS Code とすべての yarn プロセスを閉じてから
New-Item -ItemType Directory -Force "C:\Users\<user>\GitHub"
Move-Item "C:\Users\<user>\OneDrive\ドキュメント\GitHub\mulmoclaude" "C:\Users\<user>\GitHub\mulmoclaude"
cd "C:\Users\<user>\GitHub\mulmoclaude"
Remove-Item -Recurse -Force node_modules
yarn install
yarn dev:full-build
```

応急処置としては、エクスプローラーで当該フォルダを右クリック →
「**このデバイス上で常に保持する**」でも一時的に改善するが、根本解決は移動。
※ データ置き場（`~/mulmoclaude`）は OneDrive 外にあるのが普通なので、そちらは触らない。

### 落とし穴C: ビルド後に `/api/health` が 401 になる

サーバーは起動ごとにランダムな認証トークン（`.session-token`）を作り直すため、
**古いページ（古いトークン）を握ったタブ**だと 401 になる。
起動直後は Vite がサーバーより先に立ち上がって `ECONNREFUSED` が一瞬出ることもある。

**対処: サーバーが `listening port=3001` を出した後に、タブを開き直す（`Ctrl+Shift+R`）。**

### 落とし穴D: 上部ナビの文字が二重に重なって化ける

これは**CSSではなくブラウザ拡張（Google翻訳）**が原因。日本語ページをさらに翻訳し、
元テキストに訳文を重ねるため（DOM に `class="translated-ltr"` が付く）。本文が正常で
ナビだけ化けるのが見分け方。

**対処: アドレスバーの翻訳アイコン →「原文のまま表示 / このサイトは翻訳しない」。
または拡張オフのシークレットウィンドウで開く。**

---

## 4. ついでに: 起動時の WARN（エラーではない）

| ログ | 意味 | 対処（任意） |
|---|---|---|
| `GEMINI_API_KEY not set` | 画像・音声・動画生成が無効 | ルートに `.env` を作り `GEMINI_API_KEY=...` を記載して再起動 |
| `ffmpeg unavailable — mulmocast degraded` | MulmoScript の動画化が無効 | ffmpeg を入れて PATH に通す |
| `Docker not found — claude will run unrestricted` | サンドボックス無効 | Docker Desktop を入れれば有効化 |
| `whisper-server unavailable — voiceInput degraded` | 音声入力が無効 | 必要なら whisper を用意 |

---

## 5. まとめ

| 症状 | 真因 | 対処 |
|------|------|------|
| 画面全体が無装飾・重なる | プラグイン `dist/*` が未ビルドで 404 | ルートで `yarn dev:full-build` |
| `package.json が無い` | データ置き場で実行していた | ソース（package.json のある方）で実行 |
| `concurrently` が無い | OneDrive が node_modules を退避 | OneDrive 外へ移動 → 再 install |
| `/api/health` が 401 | 古いトークンのタブ | タブを開き直す（Ctrl+Shift+R） |
| ナビの文字化け | Google翻訳の二重描画 | 翻訳オフ / シークレットウィンドウ |

**教訓**: まず DevTools の Console / Network を見る。今回は `404 dist/style.css` の一行が
真因を指していた。やみくもに `node_modules` を消す前に、ログが答えを持っている。

---

## 参考

- リポジトリ: https://github.com/receptron/mulmoclaude
- 開発者向け: `docs/developer.md`
- 技術構成: Vue 3 / Vite / TypeScript / Tailwind CSS v4（`@tailwindcss/vite`） / yarn workspaces（monorepo）
- 主要ポート: Vite `:5173` / Express `:3001`
