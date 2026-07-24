# fix(#1920): plugin `gui-chat-protocol` peer dep が `^0.3.0` のまま → `^0.4.0` に揃える

## Summary

`mulmoclaude@0.9.1` (npm launcher) は `gui-chat-protocol@0.4.0` を pin する一方、bundle 対象の `@mulmoclaude/form-plugin` / `markdown-plugin` / `spotify-plugin` は peer dep を `^0.3.0` のまま published していたため、npm install で `ERESOLVE overriding peer dependency` warning が出た上、handshake 時にプラグインが registry から drop され、ランタイムで `handlePermission not found` が出る (Windows 11 で再現、Issue #1920)。

本 PR で:

1. **bundle 対象の 3 plugin** (form / markdown / spotify) の peer dep を `^0.3.0` → `^0.4.0` に修正、patch bump
2. **残り 5 plugin** (email / recipe-book / bookmarks / debug / edgar) も peer dep を同時に統一 — bundle 対象ではないが技術負債の解消
3. `packages/mulmoclaude/package.json` の 8 plugin バージョンを新しい版に上げ、mulmoclaude 本体を `0.9.1` → `0.9.2` に bump

CI での root vs `packages/mulmoclaude/package.json` 同期チェックは **本 PR には含めず別 PR で対応**。プラグイン以外にも sync が必要な dep が多数あり (`gui-chat-protocol` / `firebase` / `express` / `puppeteer` 等)、全体をカバーする mechanical check を設計する必要があるため。

## Items to Confirm / Review

- [ ] **markdown-plugin のバージョン跳ね**: source は 0.1.9、published 最新は 0.1.7。中間 0.1.8 は skip、0.1.9 も未 publish。今回 `0.1.9 → 0.1.10` に bump することで npm registry と source を同一化。この飛び方 (0.1.7 → 0.1.10) で問題無いか確認
- [ ] **debug-plugin / edgar-plugin / recipe-book-plugin / bookmarks-plugin** は launcher に bundle されないが、本 PR で peer dep 統一するか。統一しない場合、次に「なぜあの 5 plugin だけ古いか」の混乱を残す
- [ ] publish 順序: 8 plugin を先に publish → `packages/mulmoclaude/package.json` の依存版を新版に更新した diff は本 PR で入れる → merge 後 launcher を publish。順序を守らないと launcher が発行できない
- [ ] mulmoclaude 本体の bump 幅は patch (0.9.1 → 0.9.2) で妥当か。 peer dep 修正だけでコード変更無しなので patch 妥当

## User Prompt

> npm版は、`packages/mulmoclaude/package.json` なので、ここは dependency が更新漏れる。我々は yarn で root の package.json を使っているので、気にならない。
> なので、これを最新にして publish する必要があるのと、ci などで root とここの package.json の同期を確認する必要あり。
> 2 含め更新して publish、その後 3 だけど、3 は plugin に限らずパッケージ全体で同期できているか、慎重に機械的に ci で確認

## 対象プラグインと bump 表

| プラグイン | 現 (source) | 新 | bundle対象 | 内容 |
|---|---|---|---|---|
| `@mulmoclaude/form-plugin` | 0.1.3 | 0.1.4 | ✓ | peer dep `^0.3.0` → `^0.4.0` |
| `@mulmoclaude/markdown-plugin` | 0.1.9 (unpublished) | 0.1.10 | ✓ | peer dep `^0.3.0` → `^0.4.0` (+ 未 publish 分含む) |
| `@mulmoclaude/spotify-plugin` | 0.1.0 | 0.1.1 | ✓ | peer dep `^0.3.0` → `^0.4.0` |
| `@mulmoclaude/email-plugin` | 0.1.3 | 0.1.4 | | peer dep `^0.3.0` → `^0.4.0` |
| `@mulmoclaude/recipe-book-plugin` | 0.1.0 | 0.1.1 | | peer dep `^0.3.0` → `^0.4.0` |
| `@mulmoclaude/bookmarks-plugin` | 0.1.0 | 0.1.1 | | peer dep `^0.3.0` → `^0.4.0` |
| `@mulmoclaude/debug-plugin` | 0.2.0 | 0.2.1 | | peer dep `^0.3.0` → `^0.4.0` |
| `@mulmoclaude/edgar-plugin` | 0.1.1 | 0.1.2 | | peer dep `^0.3.0` → `^0.4.0` |
| **`mulmoclaude`** | 0.9.1 | 0.9.2 | (launcher 本体) | 上記 bundle 対象 3 plugin 版数上げ |

## 実装手順

1. **本 PR** — 8 plugin の `package.json` を編集: `version` patch bump + `peerDependencies.gui-chat-protocol` を `^0.4.0` に。 `packages/mulmoclaude/package.json` の該当 dep 3 個 (form / markdown / spotify) を新版に、`version` を `0.9.2` に。
2. `yarn install` → lockfile 更新
3. `yarn format` / `yarn lint` / `yarn build` / `yarn typecheck` / `yarn test` を通す
4. PR 作成
5. Merge 後 — 8 plugin を `/publish` で発行 (順不同、互いに独立)
6. その後、launcher を `/publish-mulmoclaude` で発行 (bundle 対象の 3 plugin が npm に上がってから)

## Test plan

- 手動: `npx mulmoclaude@0.9.2` を Windows 11 相当環境で fresh install し、install-time に `ERESOLVE overriding peer dependency` warning が消えていること、startup log の `[plugins/preset] loaded requested=N succeeded=N` が全数一致することを確認
- 回帰: `yarn test` (既存 unit test に破壊が無いこと)

## Out of scope (next PR)

- **CI mechanical sync check** — root と `packages/mulmoclaude/package.json` の全 dep 一致検証。plugin だけでなく `gui-chat-protocol` / `firebase` / `express` / `puppeteer` 等の runtime dep も対象。 次 PR で実装。
