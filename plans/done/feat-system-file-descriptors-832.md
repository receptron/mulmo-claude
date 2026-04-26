# feat: system-file description banner in Files Explorer (#832)

## 背景

Files Explorer で `config/interests.json` のようなシステム管理ファイルを開くと生 JSON だけ表示される。「これは何のファイル？編集していい？」が UI から読み取れない。スキーマ説明は `server/workspace/sources/interests.ts` のヘッダコメント等に散らばっており、ファイルを開いただけでは到達できない。結果ユーザは触っていいか分からず放置 / 雑に編集して壊す / 質問チャットで毎回確認することになる。

## 提案

Files Explorer の右ペイン (`FileContentRenderer.vue`) で、システム管理ファイルを開いたとき、本文の上に short description banner を表示する。banner には:

- title (「このファイルが何か」)
- summary (1-3 行)
- editPolicy バッジ (touch-OK / agent-managed / read-only / fragile-format)
- schemaRef (受信側のスキーマ定義ソース。GitHub の receptron/mulmoclaude へリンク)

を載せる。banner は折りたたみ可で、状態は localStorage にパスごとに persist する (一度読んだら閉じてもらえる)。

## アーキテクチャ

### 1. `src/config/systemFileDescriptors.ts` (新規)

```ts
export type EditPolicy =
  | "agent-managed-but-hand-editable"
  | "user-editable"
  | "agent-managed"
  | "fragile-format"
  | "ephemeral";

export interface SystemFileDescriptor {
  /** i18n key suffix → systemFiles.<id>.title / .summary */
  id: string;
  /** GitHub repo-relative path; if set, rendered as a link */
  schemaRef?: string;
  editPolicy: EditPolicy;
}

interface ExactMatch { kind: "exact"; path: string; descriptor: SystemFileDescriptor; }
interface PatternMatch { kind: "pattern"; regex: RegExp; descriptor: SystemFileDescriptor; }

export const SYSTEM_FILE_DESCRIPTORS: ReadonlyArray<ExactMatch | PatternMatch> = [
  // exact matches first
  { kind: "exact", path: "config/interests.json", descriptor: { id: "interests", schemaRef: "server/workspace/sources/interests.ts", editPolicy: "agent-managed-but-hand-editable" } },
  // ...
];

export function descriptorForPath(filePath: string): SystemFileDescriptor | null {
  for (const entry of SYSTEM_FILE_DESCRIPTORS) {
    if (entry.kind === "exact" && entry.path === filePath) return entry.descriptor;
    if (entry.kind === "pattern" && entry.regex.test(filePath)) return entry.descriptor;
  }
  return null;
}
```

Pattern matching is required because several categories are `<slug>` — e.g. `config/roles/<id>.json`, `data/sources/_state/<slug>.json`, `conversations/summaries/daily/YYYY/MM/DD.md`. Exact matches are checked first to keep deterministic precedence.

### 2. Coverage (一気に全ファイル)

| Path / Pattern | id | editPolicy | schemaRef |
|---|---|---|---|
| `config/interests.json` | interests | agent-managed-but-hand-editable | `server/workspace/sources/interests.ts` |
| `config/mcp.json` | mcp | user-editable | `server/system/config.ts` |
| `config/settings.json` | settings | user-editable | `server/system/config.ts` |
| `config/scheduler/tasks.json` | schedulerTasks | agent-managed | `server/utils/files/user-tasks-io.ts` |
| `config/scheduler/overrides.json` | schedulerOverrides | agent-managed | `server/utils/files/scheduler-io.ts` |
| `config/news-read-state.json` | newsReadState | ephemeral | `server/workspace/news/` |
| `data/scheduler/items.json` | schedulerItems | agent-managed | `server/utils/files/scheduler-io.ts` |
| `data/todos/todos.json` | todosItems | agent-managed-but-hand-editable | `server/utils/files/todos-io.ts` |
| `data/todos/columns.json` | todosColumns | user-editable | `server/utils/files/todos-io.ts` |
| `data/wiki/index.md` | wikiIndex | agent-managed | `server/workspace/wiki/` |
| `data/wiki/log.md` | wikiLog | agent-managed | `server/workspace/wiki/` |
| `data/wiki/summary.md` | wikiSummary | agent-managed | `server/workspace/wiki/` |
| `data/wiki/SCHEMA.md` | wikiSchema | fragile-format | `server/workspace/wiki/` |
| `conversations/memory.md` | memory | agent-managed-but-hand-editable | `server/agent/prompt.ts` |
| `conversations/summaries/_index.md` | summariesIndex | agent-managed | `server/journal/` |
| Pattern `^config/roles/[^/]+\.json$` | rolesJson | user-editable | `src/config/roles.ts` |
| Pattern `^config/roles/[^/]+\.md$` | rolesMd | user-editable | `src/config/roles.ts` |
| Pattern `^data/sources/[^_][^/]*\.md$` | sourceFeed | user-editable | `server/workspace/sources/types.ts` |
| Pattern `^data/sources/_state/[^/]+\.json$` | sourceState | ephemeral | `server/workspace/sources/pipeline/` |
| Pattern `^conversations/summaries/daily/\d{4}/\d{2}/\d{2}\.md$` | journalDaily | agent-managed | `server/journal/` |
| Pattern `^conversations/summaries/topics/[^/]+\.md$` | journalTopic | agent-managed | `server/journal/` |

### 3. `src/components/SystemFileBanner.vue` (新規)

Props: `descriptor: SystemFileDescriptor`, `path: string`.
State: `collapsed = ref(loadCollapsed(path))` — persisted per path key in `localStorage` under `systemFileBanner.collapsed.<path>`.
Layout: title row with editPolicy chip + collapse toggle; summary block; "Schema: `<schemaRef>`" link when set.
i18n: all strings via `t()`. editPolicy chip label from `systemFiles.editPolicy.<policy>`.

### 4. Integrate into `FileContentRenderer.vue`

Add at the top of the rendering body:

```vue
<SystemFileBanner v-if="descriptor" :descriptor="descriptor" :path="selectedPath" />
```

Compute `descriptor = computed(() => selectedPath.value ? descriptorForPath(selectedPath.value) : null)` in the parent (`FilesView.vue`) and pass down, OR compute inside the renderer. **Decision**: compute inside `FileContentRenderer.vue` to keep `FilesView` thin. The descriptor is purely a function of `selectedPath`.

### 5. i18n: `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts`

Add a `systemFiles` group:

```ts
systemFiles: {
  showDetails: "Show details",
  hideDetails: "Hide details",
  schemaLabel: "Schema",
  editPolicy: {
    "agent-managed-but-hand-editable": "Agent-managed (hand-editable)",
    "user-editable": "User-editable",
    "agent-managed": "Agent-managed",
    "fragile-format": "Fragile format",
    ephemeral: "Runtime state — don't edit",
  },
  interests: { title: "...", summary: "..." },
  mcp: { title: "...", summary: "..." },
  // ...for every id above
}
```

8 locales × ~20 ids × 2 strings each + chrome strings = ~340 i18n strings to translate. CLAUDE.md "all 8 locales in lockstep" rule applies — write each translation, don't copy English.

## 完了条件 (issue #832 に基づく)

- [x] `SYSTEM_FILE_DESCRIPTORS` const に上記カテゴリ最低 1 ファイルずつ
- [x] `FileContentRenderer.vue` で descriptor 一致時に banner 表示
- [x] banner は collapse 可 (localStorage persist)
- [x] 各 description は schema 定義ファイルへの GitHub link 付き
- [x] descriptor が無いファイル (e.g. ユーザ作成 `.md`) は banner 無し
- [x] i18n 8 ロケール lockstep
- [x] testid 付与 (`system-file-banner`, `system-file-banner-toggle`)
- [x] unit test: `descriptorForPath` の exact / pattern / no-match
- [x] yarn format / lint / typecheck / build / test 全部 clean

## スコープ外

- 「常に隠す」グローバル設定 (per-banner collapse + localStorage で十分)
- banner 内編集 UI (#823 が GUI 編集の範囲。本 issue は description 表示のみ)
- 画像 / PDF / 動画ファイルの banner (システム管理ファイルはほぼテキスト系のみ)

## ファイル変更リスト

新規:
- `src/config/systemFileDescriptors.ts`
- `src/components/SystemFileBanner.vue`
- `test/config/test_systemFileDescriptors.ts`

変更:
- `src/components/FileContentRenderer.vue` (banner 差し込み)
- `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` (8 ロケール lockstep)
- `docs/ui-cheatsheet.md` (FilesView block に banner 追記)
