# Runtime Plugin デバッグ知見（2026-05-02 検証）

`#1043 C-2` で導入した runtime-loadable plugin（`@gui-chat-plugin/*` を `npm install` 後に動的に取り込む仕組み）を `npx mulmoclaude` 経由の本番起動で動かそうとして、丸 1 セッションかかった。再発防止用に学びをまとめておく。

## 症状の時系列

1. dev サーバ（`npm run dev`）では fetchWeather が呼べる
2. `npx mulmoclaude` で起動した本番サーバでは Tool 検索（`ToolSearch`）にヒットするのに、実呼び出しで `No such tool available: mcp__mulmoclaude__fetchWeather`
3. 上の根本原因を直すと、今度は plugin 内部で `Cannot destructure property 'areaCode' of 't' as it is undefined.`
4. 直すと最終的に呼べるように

silent な失敗を 2 段階で踏んだのが時間を食った主因。順に書く。

## 1. `process.cwd()` を信用しない — project root 解決

### 問題

`server/agent/config.ts` の `buildDockerSpawnArgs` / `buildMulmoclaudeServer` が `process.cwd()` を project root として使い、Docker サンドボックスへ `${cwd}/node_modules:/app/node_modules:ro` をマウントしていた。

`packages/mulmoclaude/bin/mulmoclaude.js` は launcher 起動時に `cwd` をパッケージディレクトリ（`packages/mulmoclaude/`）へ切り替える。yarn workspace の dev チェックアウトではここの `node_modules/` は **空**（依存はリポジトリルートに hoist されている）。結果、サンドボックス内 `/app/node_modules` が空ディレクトリになり、MCP child は

```
Cannot find module 'express'
Require stack:
- /app/server/agent/mcp-tools/index.ts
- /app/server/agent/mcp-server.ts
```

で **MCP `initialize` ハンドシェイク前にクラッシュ**する。Claude CLI 2.1.x はこの場合エラーを表に出さず、その server から提供されるツールを **黙って 0 件**として扱う。

### Claude CLI 自体は呼ばれている。MCP child が起動できないだけ。

### 直し方

```ts
import { createRequire } from "node:module";

function resolveProjectRoot(): string {
  try {
    const req = createRequire(import.meta.url);
    const expressPkgJson = req.resolve("express/package.json");
    // .../node_modules/express/package.json → dirname×3 → project root
    return dirname(dirname(dirname(expressPkgJson)));
  } catch {
    return process.cwd();
  }
}
```

`createRequire(import.meta.url)` は **そのモジュール自身の位置から** 上方向に node_modules を探索する Node 標準解決を再現する。yarn workspace（hoist 済み）でも flat npm install（パッケージ直下にすべて install）でも、必ず populated な `node_modules/` に着地する。

### 学び

- `process.cwd()` は launcher / bin script / cron / IDE などで容易に変わる。**project root のつもりで使うのは禁止**。
- 「ある依存が必ずインストールされる場所」を起点にすればローカルレイアウトに依存しない。
- yarn workspace の dev と `npm install <pkg>` の prod で `node_modules` 配置が違う以上、cwd ベースの mount は dev/prod のどちらかで必ず壊れる。

## 2. MCP child の silent failure — 4 つの罠

Claude Code CLI 2.1.x は MCP child が JSON-RPC `initialize` を完了する前に死ぬと、当該 server を **エラーログなしに** ツールリストから外す。今回踏んだ silent failure は 4 種類:

| パターン             | 症状                                                | 直し方                                     |
| -------------------- | --------------------------------------------------- | ------------------------------------------ |
| `node_modules` が空  | `Cannot find module 'express'`（child stderr のみ） | §1 の `resolveProjectRoot`                 |
| `type: "stdio"` 省略 | server エントリ自体が無視される                     | mcp-config に `"type": "stdio"` を必ず付与 |
| claude.ai 統合 merge | local server がサイレントに drop                    | `--strict-mcp-config` 必須                 |
| handler 例外         | tools/list は通るが call 時に 500                   | dispatch route を直す（§3）                |

### `type: "stdio"` の話

2.1.x で stdio MCP server には `type` が必須化された。書き忘れると **エラーも警告も出ず**、エントリが消える（`mcp_servers` リストに出ない）。一見動いているように見えるので発見が遅れる。

### `--strict-mcp-config` の話

`--strict-mcp-config` を付けないと Claude CLI は `~/.claude.json` の claude.ai 統合（Canva / Gmail / Drive / Calendar）と `--mcp-config <path>` の中身をマージしようとする。その merge ロジックの中で **ローカル `--mcp-config` の内容がサイレントに消える**ケースを実測した。`--strict-mcp-config` を付けると `--mcp-config` の中身だけが使われる。

### デバッグ手順

silent な以上、こちらが見えるところに情報を引きずり出すしかない:

1. **CLI 引数を JSON dump**（`/tmp/claude-cli-args-<sid>.json`）— `--mcp-config` が渡っているか
2. **`--mcp-config` の中身を dump**（`/tmp/mcp-config-debug-<sid>.json`）— server エントリと env が期待通りか
3. **docker spawn 引数を dump**（`/tmp/docker-args-<sid>.json`）— `-v` mount の host パス側が populated か
4. **手動で `docker run ... claude --mcp-config ...`** を再現 — 親サーバが渡しているのと同じ引数を手で叩いて、ツールが listed されるか確認

3 段目までで原因がほぼ特定できる。

## 3. Plugin の `execute` シグネチャは `(context, args)`

### 問題

§1 を直したら今度は

```
Error: HTTP 500 calling /api/plugins/runtime/%40gui-chat-plugin%2Fweather/dispatch:
{"error":"plugin execute failed: Cannot destructure property 'areaCode' of 't' as it is undefined."}
```

`@gui-chat-plugin/weather` の minified 出力を読むと、`fetchWeather` の実装は

```js
r = async (e, t) => {
  let { areaCode: r } = t, ...  // t が undefined → 死ぬ
}
```

つまり **第 2 引数から args を destructure する** 設計。`gui-chat-protocol` の型定義もそうなっていた:

```ts
export interface ToolPluginCore {
  execute: (context: ToolContext, args: A) => Promise<ToolResult>;
}
```

サーバ側 `runtime-plugin.ts` の dispatch は `plugin.execute(args)` と一引数で呼んでいたので、plugin から見ると args が第 1 引数（無視）に入り、第 2 引数は undefined だった。

### 直し方

```ts
const context = {}; // ToolContext は { currentResult?, app? } 全部 optional
const result = await plugin.execute(context, args);
```

`RuntimePlugin.execute` の TypeScript 型も `(context, args) => unknown` に直して、サーバ側で誤って 1 引数呼びに戻すと型エラーで落とす。

### 学び

- 外部 protocol の関数型は **必ず .d.ts を読む**。minified 実装の挙動から推測すると引数の意味づけを間違える。
- 型定義と実装が分かれているパッケージは「実装が呼んでいる引数の番号」が真実。dispatch route のような橋渡し層は、プロトコル定義の型を import してそれに従う。

## 4. dev / prod × docker / no-docker — 4 パターンのテスト戦略

理屈上は 4 パターン:

|                               | docker                 | no-docker      |
| ----------------------------- | ---------------------- | -------------- |
| **dev**（`npm run dev`）      | サンドボックスマウント | tsx 直接 spawn |
| **prod**（`npx mulmoclaude`） | サンドボックスマウント | tsx 直接 spawn |

実装上は `resolveProjectRoot()` ひとつで 4 パターンとも同じ「populated `node_modules` に着地する」結論になるアーキにしてあるので、**1 つの解決戦略で 2 軸吸収**できる。

テストは 2 レイヤー:

1. **ユニット** — `test/agent/test_agent_config.ts` に「cwd を package dir に切り替えてもマウントが populated `node_modules/` を指す」regression。dev 側で 1 ms で回る。
2. **tarball smoke** — `scripts/mulmoclaude/tarball.mjs` が `npm pack` → install → 起動 → `/api/plugins/runtime/list` を叩いて `plugins.length > 0` を確認。preset loader が prod で 0 件登録になる回帰を CI で捕まえる。

`/` への 200 だけだと「サーバは起きたが MCP child が死んでいる」を見逃す。**プラグインリストまで見る**ことで初めて end-to-end で守れる。

## 5. 推測で直さない — 段階的に絞る

このセッションで時間を食ったのは、症状（"No such tool available"）と原因（docker mount で空ディレクトリ）の間に layer がいくつもあったため。

効いたデバッグ動作:

- **片方向の確認に絞る**: 「MCP server から見て tools/list は何を返しているか？」を独立に確認できれば、CLI 側の問題か server 側の問題かが分かれる。手動 `docker run` で同じ引数を叩いて、tools/list を JSON-RPC で送る。
- **dump をファイルに**: stdout はログに混ざる。`/tmp/docker-args-<sessionId>.json` のように **session ごとに分けてファイルに**書くと、複数試行を比較できる。
- **環境差を 1 つずつ消す**: dev で動いて prod で動かないなら、prod の env を 1 個ずつ dev に揃えていく。今回は cwd 差が原因と分かるまで、CLI 引数 / mcp-config / docker args の順に 3 段絞った。
- **stash / commit のタイミング**: 試行錯誤の途中は commit しない。仕組みが見えたら debug instrumentation を **全削除** してから commit する。debug 残しの commit は後で merge conflict のもとになる。

ユーザの "もっと、順を追って推測して直して。たぶん、かなり絞れるはず" は本当にそう。

## 6. 周辺で踏んだ細かい罠

### `prepare-dist.js` の存在を忘れるとサーバはずっと古いコードを動かす

`packages/mulmoclaude/server/`, `src/` は dev 時は **リポジトリ root からコピーされたスナップショット**。`prepare-dist.js` がコピーする。bin script は `packages/mulmoclaude/server/index.ts` を起動するので、リポジトリ root のソースを編集しただけではサーバ再起動しても反映されない。

```
node packages/mulmoclaude/bin/prepare-dist.js  # 必須
node packages/mulmoclaude/bin/mulmoclaude.js --no-open --port 3099  # 再起動
```

### Vite `preserveEntrySignatures: 'strict'` がないと runtime-vue chunk が 46 byte になる

`src/_runtime/vue.ts` の `export * from "vue"` は production build では **どこからも参照されない**（runtime importmap 経由でブラウザが import する）。Rolldown はこれを tree-shake して 46 byte の side-effect stub にする。runtime plugin の `import { createCommentVNode } from "vue"` が "does not provide an export named 'createCommentVNode'" で死ぬ。

```ts
build: {
  rollupOptions: {
    input: { /* ... */ },
    preserveEntrySignatures: 'strict',  // 公開ライブラリ扱いで named export を保持
  },
},
```

### bin script の `cwd: PKG_DIR` は触らない

`packages/mulmoclaude/bin/mulmoclaude.js` が `spawn(node, [tsx, SERVER_ENTRY], { cwd: PKG_DIR })` で chdir するのには **理由がある**（パッケージ内の相対パスが効く前提のコードがある）。「cwd 問題を直す」で bin 側を変えるのではなく、**サーバ側で project root を `cwd` に依存しない方法で求める**のが正解。

## まとめ

- `process.cwd()` で project root を取らない。`createRequire(import.meta.url).resolve(<known-dep>)` で起点をモジュール位置に固定する。
- MCP child の silent failure は 4 パターン: empty `node_modules` / `type: "stdio"` 抜け / claude.ai 統合 merge / handler 例外。**`--strict-mcp-config` は付ける**。
- runtime plugin の `execute` は `(context, args)`。dispatch 層で 1 引数呼びに退化させない。
- 4 パターン（dev/prod × docker/no-docker）は 1 つの resolveProjectRoot で吸収する。テストは unit（dev で 1ms）+ tarball smoke で `/api/plugins/runtime/list` まで叩く。
- 段階的に dump → 手動再現で原因に絞る。最後に debug instrumentation を全削除してから commit する。
