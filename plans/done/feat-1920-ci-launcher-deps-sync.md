# feat(#1920): CI gate — root ↔ launcher package.json + plugin peer dep sync

## Summary

#1920 は published `mulmoclaude@0.9.1` の launcher が bundle する 3 plugin の peer dep が launcher pin と乖離しており、ランタイム handshake で落ちる bug。 root fix は PR #1921。 本 PR はその **class of bug が再発しないよう PR CI に mechanical gate を追加**する。

- 新 script `scripts/mulmoclaude/launcherSync.mjs` — 3 つの invariant を検証:
  1. **root ↔ launcher common dep のバージョン一致** — `gui-chat-protocol` / `firebase` / `express` / `puppeteer` 等が両方に登場する場合 range が同一
  2. **workspace source ↔ launcher range 整合** — launcher `@mulmoclaude/*` / `@mulmobridge/*` の range が workspace source `version` を満たす
  3. **plugin peer dep vs launcher pin (#1920 anti-regression)** — bundle 対象 plugin (`@mulmoclaude/*-plugin`) の `peerDependencies` エントリで launcher の pinned バージョンが satisfy されている
- `yarn check:launcher-sync` root script + `.github/workflows/pull_request.yaml` の lint_test に追加
- root ↔ launcher の既存 drift 2 件 (`@mulmobridge/client`, `tsx`) を修正

## Items to Confirm / Review

- [ ] **invariant 1 の粒度**: `dependencies` と `devDependencies` を集めて launcher `dependencies` と比較。 root が dev、launcher が runtime の場合も flag する。 誤検知が出るなら scope を絞れます
- [ ] **invariant 3 の対象**: bundle 対象を `@mulmoclaude/*-plugin` パターンで判定。 将来 `@mulmoclaude/foo-view` 系が追加された場合、判定を launcher に explicit list (`bundlePlugins: [...]`) として持たせるか検討
- [ ] **peer dep 判定の semver 対応範囲**: 現状 `^` / `~` / `>=` / exact をサポート。 URL / `workspace:*` / `*` は skip (`kind: "skipped"`) して operator に triage 委任。 これで十分か
- [ ] **CI job 配置**: `lint_test` matrix (ubuntu + macOS × node 22/24) 全セルで実行 = 8 実行。 script は 100ms 以下なのでコスト無視できる。 `yarn4_smoke` にも入れるかどうか
- [ ] **既存 drift 2 件の版整合**: `@mulmobridge/client` root `^0.1.0` → `^0.1.4`、 `tsx` launcher `^4.22.3` → `^4.22.4`。 意図した ratchet 上げか (source は 0.1.5 と 4.22.4 なので、両者を launcher に合わせる方向で修正)

## User Prompt

> ok 続けて — (前 PR に続いて) 3 は plugin に限らずパッケージ全体で同期できているか、慎重に機械的に CI で確認

## 検知するバグの class

**gate が捕まえるバグ 1 (invariant 3 — #1920 の直接反映):**
launcher が `gui-chat-protocol: 0.4.0` を pin、bundle 対象の `@mulmoclaude/form-plugin` は peer dep `gui-chat-protocol: ^0.3.0`。 npm install で silent override → runtime handshake fail。 現在 gate ONで検知される。

**gate が捕まえるバグ 2 (invariant 1):**
root で `firebase` を 12.15.0 → 13.0.0 に上げても launcher に反映漏れ。 npx consumer は launcher の 12.15.0 を install、host code は 13.0.0 前提の shape を期待 → runtime crash。

**gate が捕まえるバグ 3 (invariant 2):**
launcher が `@mulmoclaude/core: ^0.5.0` を dep 宣言、 workspace source が `0.6.0` に bump 済 (前 PR で version 上げしたのに launcher の range 見落とし)。 published 版は 0.5.x のまま → dev ↔ prod drift。

## Implementation

**新規:**

- `scripts/mulmoclaude/launcherSync.mjs` — auditor 本体 (185 LOC)
- `scripts/mulmoclaude/launcherSync.d.mts` — type sidecar (既存 `deps` / `drift` の convention に合わせる)
- `test/scripts/mulmoclaude/test_launcherSync.ts` — 12 test (`satisfies` + 3 invariant × happy + fail + real-repo self-check)

**変更:**

- `package.json` — root script `check:launcher-sync` 追加、 `@mulmobridge/client` `^0.1.0` → `^0.1.4` (drift 修正)
- `packages/mulmoclaude/package.json` — `tsx` `^4.22.3` → `^4.22.4` (drift 修正)
- `.github/workflows/pull_request.yaml` — `lint_test` job に `yarn run check:launcher-sync` を `build` の直前で挿入

## Test plan

- [x] `yarn tsx --test test/scripts/mulmoclaude/test_launcherSync.ts` (12 pass、 real-repo self-check が失敗した状態 → 2 件を修正 → 通過)
- [x] `node scripts/mulmoclaude/launcherSync.mjs` (CLI, exit 0)
- [x] `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` / `yarn test`
- 手動: 意図的に launcher `gui-chat-protocol` を `^0.3.0` に書き換え → auditor が peer-dep 側でなく **invariant 1 (root ↔ launcher)** で fail することを確認 (両 invariant のどちらでも捕まる二重 gate になっている確認)

## Out of scope

- **`@mulmobridge/*` bridge の peer dep 判定** — 現状 bridge は launcher に bundle されないので gate から除外。 将来 bundle 対象を広げる際は invariant 3 の name filter を拡張
- **published npm registry との比較** — 既存 `scripts/mulmoclaude/drift.mjs` が担う。 本 PR は "source-tree の内部整合" 専任、drift.mjs は "source vs published" 専任と役割分担
- **`optionalDependencies` の一致** — `node-pty` 等の optional は launcher / root で意図的にずれるケースあり (root は dev 用に浅く、launcher は runtime 用に深くなど)。 現状 gate 外
