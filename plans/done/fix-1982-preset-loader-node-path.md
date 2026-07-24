# fix(#1982): resolvePresetRoot ignores NODE_PATH on Windows + Docker sandbox

## Summary

`server/plugins/preset-loader.ts` の `resolvePresetRoot()` は Node 標準の
CJS resolver を通さず、`__dirname` から `<dir>/node_modules/<pkg>/package.json`
を親方向に手歩き探索する。この walker は `process.env.NODE_PATH` を一切
参照しないため、PR #1974 が導入した `/app/pkg_modules/@mulmoclaude/<name>`
+ `NODE_PATH=/app/node_modules:/app/pkg_modules` の fallback が効かない。

Windows + Docker sandbox 環境では `<repo>/node_modules/@mulmoclaude/*` が
absolute な NTFS junction で、Linux container 内では dangle するため
`existsSync` が false を返す → walker は親方向にも見つけられずに null を
返す → `spotify-plugin` / `debug-plugin` / `edgar-plugin` / `email-plugin`
の全 preset plugin が silent に load 失敗する (devOnly の 3 個は
`log.debug` だけで実質サイレント)。

#1946 の本体クラッシュは PR #1974 で解消済み (`@mulmoclaude/x-plugin` を含む
静的 import 連鎖は Node 標準 resolver 経由で NODE_PATH fallback を掴む) が、
`resolvePresetRoot()` はその外側にいる。#1982 は #1946 の残債。

## Items to Confirm / Review

- **user 症状との scope 一致は 100% ではない**: user report は
  `mcp__mulmoclaude__handlePermission not found`。`handlePermission` 自体は
  `server/agent/mcp-tools/handlePermission.ts` の built-in で、preset-loader
  を通らず `mcp-tools/index.ts:39` の `mcpTools` 配列に静的登録される。
  preset-loader の failure だけでは runtime での "not found" を直接説明
  しない。ただし preset plugin が 4 個消える現象は明確に修正すべきで、
  再検証で user 症状が消えるかは fix 適用後に確認する。
- **fix 方式**: 投資結果は「`resolvePresetRoot()` 内で `process.env.NODE_PATH`
  を手パース + 探索追加」だが、より直接的な `require.resolve.paths()` に
  丸投げ形式を採用する:
  ```typescript
  function resolvePresetRoot(packageName: string): string | null {
    const paths = require.resolve.paths(packageName);
    if (!paths) return null;
    for (const dir of paths) {
      const candidate = path.join(dir, packageName);
      if (existsSync(path.join(candidate, "package.json"))) return candidate;
    }
    return null;
  }
  ```
  Node 標準 resolver が返す path list (親方向の各 `node_modules` + NODE_PATH
  entry) をそのまま使う。手パースを避けるので Node の未来の resolution
  仕様変更にも自動追従。`existsSync` gate は既存と同じで
  `ERR_PACKAGE_PATH_NOT_EXPORTED` (`@gui-chat-plugin/*` の exports gate) を
  引き続き回避。
- **Windows + Docker CI test**: 新規 workflow
  `.github/workflows/docker_sandbox_windows.yaml` を追加。
  `runs-on: windows-latest` で Docker Desktop の engine を Linux に切り替え、
  実際に `node_modules/@mulmoclaude/*` の NTFS junction が Linux container で
  dangle する環境を作り、fix 前後の resolver 挙動を確認する probe (`.mjs`)
  を走らせる。手動 trigger + daily schedule のみ (通常 PR は
  `paths:` filter で対象ファイルが触れた時だけ)。

## User Prompt

> #1982 次これ。調査結果あるのでそれを参考に、こちらでも 0 ベースで考えて。
> あと `runs-on: windows-latest` + `docker run ubuntu:24.04 uname -a`
> みたいに github 上の windows で linux 動かせるらしいから、これで
> 何か検証できない? これらの問題用のテストを作るとか。
> まずこれ検証用の専用 CI でよいよ。で、それで fix したらその ci を
> スケジュールで動かすようにしておく。

## Implementation

### 1. fix — `server/plugins/preset-loader.ts`

現在の parent-walk + `existsSync` gate を `require.resolve.paths()` + 同じ
gate に置き換え。`resolvePresetRoot` を named export に変更 (テスト用)。

### 2. POSIX unit test — `test/plugins/test_preset_loader_node_path.ts`

`process.platform === "win32"` skip。fixture 木を作成:

- `<fixture>/pkg_modules/@mock/preset/package.json` (fallback root、本物)
- `<fixture>/node_modules/@mock/preset` (dangling symlink、junction 相当)

child process を spawn (NODE_PATH を fixture の fallback root に設定)、
child は `resolvePresetRoot` を import して return path が fallback root に
なることを assert。`test/agent/test_workspace_module_fallback.ts` と同じ流儀。

### 3. Windows + Docker CI — `.github/workflows/docker_sandbox_windows.yaml`

- Triggers: `workflow_dispatch` + `schedule` (daily 19:00 UTC = 4:00 JST) +
  `push`/`pull_request` on paths (`server/agent/config.ts`,
  `server/plugins/preset-loader.ts`, `Dockerfile.sandbox`,
  `packages/plugins/*/package.json`, `test/sandbox-repro/**`, self)
- `runs-on: windows-latest`
- `yarn install` → yarn workspace が `node_modules/@mulmoclaude/*` に junction
  作成 (`Get-Item ... LinkType == Junction` で sanity check)
- `SwitchLinuxEngine` で Docker を Linux mode に切替、`docker info` で
  `OSType: linux` を確認
- `docker run --rm node:22-slim` で production の bind mount 構成を再現:
  - `node_modules → /app/node_modules:ro` (junction が dangle する側)
  - `packages/plugins/<name> → /app/pkg_modules/@mulmoclaude/<name>:ro` (fallback)
  - `packages/core → /app/pkg_modules/@mulmoclaude/core:ro`
  - `test/sandbox-repro → /repro:ro`
  - `NODE_PATH=/app/node_modules:/app/pkg_modules`
- container 内で `node /repro/probe.mjs` — probe が env + fix pattern を検証

### 4. probe — `test/sandbox-repro/probe.mjs`

Self-contained node:22-slim 用スクリプト。preset-loader.ts 本体には depend
しない (server 側 build を CI で走らせず、resolver パターン自体を検証):

1. **env sanity**: `/app/node_modules/@mulmoclaude/x-plugin/package.json` が
   dangle (`existsSync === false`) を確認 — 環境が本当に再現しているか
2. **fallback mount 確認**: `/app/pkg_modules/@mulmoclaude/x-plugin/package.json`
   が存在
3. **buggy version reproduces the bug**: 現行 (parent-walk only) の
   `resolvePresetRoot` inline 実装が null を返す
4. **fixed version works**: `require.resolve.paths()` 版が
   `/app/pkg_modules/@mulmoclaude/spotify-plugin` を返す
5. Node 標準の `require.resolve('@mulmoclaude/x-plugin')` も同経路で解決

3 が null 以外なら env が壊れている / 4 が null なら fix が効いていない、と
明示的にエラー。将来 PR #1974 の bind mount 構成や NODE_PATH 設定を変える人が
`resolvePresetRoot()` に手を入れなくても、この probe が Windows regression を
拾う。

## Test plan

- `yarn tsx --test test/plugins/test_preset_loader_node_path.ts` — POSIX 上で fix 挙動確認
- `yarn format` / `yarn lint` (0 errors) / `yarn typecheck` / `yarn build`
- `gh workflow run docker_sandbox_windows.yaml --ref feat/1982-preset-loader-node-path`
  で新規 workflow を trigger、Windows runner で Linux Docker が起動し
  probe が全 pass することを確認
- user (@ystknsh) に再検証依頼: fix commit を pull した Windows +
  Docker sandbox 環境で `mcp__mulmoclaude__handlePermission not found` が
  消えるかを確認。消えれば #1982 (と #1946 の残債) は解消。消えない場合、
  別の crash / registration bug の可能性が残るので次の調査へ

## Out of scope

- Preset plugin が devOnly のとき warn ではなく debug で silent 化する
  ポリシー自体 (`server/plugins/preset-loader.ts:80-84`) は現状維持。
  今回の fix で解決失敗が根絶されれば silent でも実害はなくなる
- `handlePermission not found` の別原因 (もし preset fix 後も残ったら) —
  別 issue
- Windows CI の Docker Desktop engine 切替の flake 対策 (最初の実測で頻発
  するようであれば retry / backoff を追加検討、今は 45 秒 poll)
