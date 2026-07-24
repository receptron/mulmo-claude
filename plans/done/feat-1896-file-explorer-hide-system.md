# feat(#1896): file-explorer で system 領域を default 非表示

## Summary

Files Explorer (`FilesView.vue` / `FileTree.vue`) のワークスペース root で、
**MulmoClaude がユーザー向けに書き出す top-level dir だけ** を default で
表示する。それ以外の内部ワーク領域 (`conversations/` `feeds/` `.git/` など)
は隠す。ヘッダに「システムファイルを表示」トグルを付けて、on にすると
今と同じ全表示に戻る。

## Items to Confirm / Review

- **Top-level whitelist**: `data/`, `artifacts/`, `config/` の 3 つ。
  - `data/` — wiki / calendar / contacts / clients / attachments / feeds records / cooking recipes / transports / ingest-state
  - `artifacts/` — charts / documents / html / svg / images / spreadsheets / stories / html-scratch
  - `config/` — settings.json / mcp.json / roles/ / helps/ / marp-themes/
  - Plugin が `data/foo-plugin/` のような形で内部に生やしても自然に見える (whitelist は top-level のみ、中は再帰しない)。
- **Blacklist にはしない**: 未知の top-level dir (plugin が root 直下に作った、
  agent が新規に生やした workspace 系 dir) は default で隠れる。安全側。
- **中は再帰的に filter しない**: `data/` を見せると `data/` 配下は全部見える。
  `data/ingest-state/*.json` (skill collection の内部 state) も見える。
  ユーザーが受け入れ済み。
- **`config/helps/*`** (agent が読むヘルプ md 20+ 個) も見える。ユーザー受け入れ済み。
- **トグルは localStorage 永続化**。key: `filesView.showHiddenSystem`。
- **deep-link は tree の filter に影響しない**: `?path=conversations/chat/xxx.jsonl`
  でファイル選択は動くが、tree の下に `conversations/` は現れない。
  ユーザーは必要なら「システムファイルを表示」を on にする。
  MVP 判断 (自動 on 復元は今回スコープ外)。
- **関連 #1874 とはまとめない**: 別 PR で対応 (ユーザー指示)。

## User Prompt

> #1896 の file-explorer 改善: 不要なものは filter して出さない方針。
> B (whitelist top-level dir)。data/ artifacts/ みたいなユーザーが書く対象は
> ゆるく見せる、archive/ github みたいな不要 / 作業用 dir は見せない。
> config/helps ok、data/ingest-state ok、#1874 とはまとめない。

## Implementation

### 新規

- `src/config/visibleWorkspaceDirs.ts`
  - `VISIBLE_TOP_LEVEL_DIRS: readonly string[] = ["data", "artifacts", "config"]`
  - `isVisibleTopLevel(name: string): boolean`
- `src/composables/useShowHiddenSystemFiles.ts`
  - localStorage-backed `Ref<boolean>`, default `false`
  - Key: `filesView.showHiddenSystem`
- `test/config/test_visibleWorkspaceDirs.ts`
  - `isVisibleTopLevel` の各パターン (`data` / `artifacts` / `config` は true、
    `conversations` / `feeds` / `.git` / 未知は false、大文字 / スラッシュ入り
    のエッジケースも false)

### 変更

- `src/components/FileTree.vue`
  - `showHiddenSystem: boolean` prop 追加、再帰的に子コンポーネントに渡す。
  - `visibleChildren` computed: root (`node.path === ""`) のときだけ
    `!showHiddenSystem` なら `isVisibleTopLevel(child.name)` で filter。
    それ以外は素通し。
  - `v-for` を `loadedChildren` → `visibleChildren` に切替。
- `src/components/FileTreePane.vue`
  - sort トグルの左に「システムファイルを表示」チェックボックス追加。
  - `showHiddenSystem` prop 受け取り、`FileTree` に渡す。
  - `update:showHiddenSystem` emit で親に返す。
- `src/components/FilesView.vue`
  - `useShowHiddenSystemFiles` composable を呼び出し、`FileTreePane` に bind。
- `src/lang/*.ts` × 8
  - `fileTreePane.showSystemFiles` (label) を追加。

### 動作

- 初回起動 / localStorage 空: system 表示 OFF、`data/` `artifacts/` `config/`
  だけが root に見える。
- チェックボックス on: 全 top-level dir 表示 (今の挙動)。
- deep-link で hidden path 選択: content pane は開くが tree に該当分岐は出ない
  (ユーザーが on にすれば復元される)。
- Sort mode / expanded dirs はそのまま (直交)。

## Test plan

- `yarn tsx --test test/config/test_visibleWorkspaceDirs.ts` — pure helper。
- `yarn format` / `yarn lint` (0 errors) / `yarn typecheck` / `yarn build`。
- 手動: Files タブを開く。root に `data/` `artifacts/` `config/` の 3 つが
  出て、`conversations/` `feeds/` が消えていること。チェックボックスを
  on すると復元されること。ページリロードで状態が保持されること。

## Out of scope

- 中身の filter (`config/helps/` を config/ の中で更に隠すなど)
- deep-link での自動 toggle 復元
- Files タブ以外の場所 (Wiki 内 backlinks の path 表示など) の filter
- #1874 (別 issue)
