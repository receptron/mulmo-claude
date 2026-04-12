# feat: Todo file explorer view (kanban / table / list)

## User Prompt

> issueたてる
> ファイルエクスプローラーでtodoのviewをつくる。ラベルで切り替えと、カンバン、表などのviewを切り替えの２つの切り替えと、ステータスを追加する。他にもtodoとして必要な機能があったら盛り込んでplanを作って。githubのカンバンが個人的には使いやすい。チャットからの操作を考慮して作ってね

確認した追加要件:

- ステータスは GitHub 標準4列 (`Backlog` / `Todo` / `In Progress` / `Done`) を初期値として、**ユーザがカラム自体を追加・削除・並び替え**できるようにする。
- Kanban の **drag & drop**（ステータス変更・列内並べ替え）は Phase 1 に含める。
- 追加フィールドは `priority` と `dueDate` の 2 つ。`assignee` / `subtasks` は今回スコープ外。
- **チャット (MCP) からの操作は今回スコープ外**。`manageTodoList` MCP ツールの定義は変更しない。Web UI の操作が REST 経由で永続化されるだけでよい。LLM からの新フィールド操作対応は将来 issue で扱う。

---

## 目的 / Goal

ファイルエクスプローラ (`FilesView.vue`) で `todos/todos.json` を選択した時に、専用の **TODO エクスプローラ** を表示する。GitHub Projects 風の Kanban を中心に、Table / List への切替とラベル / ステータスフィルタを提供する。Web UI 上の操作は専用 REST 経由で永続化される。

> 既存パターン: Scheduler の `items.json` を選択した時に `SchedulerView` を描画する仕組み (`src/components/FilesView.vue:58-60`) と同じ統合方式を採る。

> **MCP ツールには手を付けない**: 既存 `manageTodoList` (`src/plugins/todo/definition.ts`) は無変更。LLM からは引き続き旧フィールド (`text` / `note` / `labels` / `completed`) のみが見える。新フィールド (`status` / `priority` / `dueDate`) を LLM が操作しようとすると無視されるが、Web UI 上は問題なく見える / 編集できる。LLM 連携は別 issue。

## ノンゴール / Non-goals

- **MCP `manageTodoList` ツールの拡張**（チャットから新フィールドを操作する機能）
- Subtasks / チェックリスト機能
- Assignee / 複数ユーザ対応
- 通知 / リマインダ
- Recurring todo（繰り返し）
- 過去の completed の集計ビュー（履歴グラフ等）

これらは後続の issue / PR で扱う。

---

## データモデル

### 現状 (`server/routes/todos.ts:9-16`, `src/plugins/todo/index.ts:6-13`)

```ts
interface TodoItem {
  id: string;
  text: string;
  note?: string;
  labels?: string[];
  completed: boolean;
  createdAt: number;
}
```

### 拡張後

```ts
interface TodoItem {
  id: string;
  text: string;
  note?: string;
  labels?: string[];
  completed: boolean;        // status とは独立に扱う（後述）
  createdAt: number;
  // ── new ──
  status?: string;           // ステータス column の id（未設定時は最初の non-done column）
  priority?: "low" | "medium" | "high" | "urgent";
  dueDate?: string;          // ISO 8601 (YYYY-MM-DD)
  order?: number;            // 同一ステータス内の並び順（小さいほど上）
}
```

> **`completed` と `status` の関係**: 当初は読み込みのたびに `status === doneColumnId` から `completed` を再同期する設計でしたが、これだとレガシー MCP `check` action（`completed=true` を立てるだけで status は触らない）が次の GET で revert されてしまうため廃止。
>
> 現在は **storage 層では完全に独立** に扱い、両者を同期するのは以下の **明示的なユーザ操作** のみ:
> - REST `PATCH /api/todos/items/:id` で `status` を変えると `completed` も sync
> - REST `PATCH` で `completed` を flip すると status を done 列 / default 開いた列に移動
> - REST `POST /api/todos/items/:id/move` で done 列に入った item は `completed=true`
> - 列の add (`isDone:true`) / patch (`isDone:true`) / delete (done 列を消す) は影響範囲の item を `resyncDoneMembership` で sync
>
> migration on read（`migrateItems`）は status の **backfill** はするが completed の **resync は一切しない**。

### ステータスカラム (`workspace/todos/columns.json` — 新規)

カラムをユーザが編集できるよう、**items とは別ファイル**に保存する。items.json を膨らませない & マイグレーションが楽。

```ts
interface StatusColumn {
  id: string;        // "backlog" など URL-safe slug。安定した参照キー
  label: string;     // "Backlog" — 表示名（i18n は将来）
  isDone?: boolean;  // true の列に入った item は completed: true と同期
}

interface ColumnsFile {
  columns: StatusColumn[];
  // ファイルが存在しない/壊れている場合は DEFAULT_COLUMNS にフォールバック
}
```

**初期値**:

```ts
const DEFAULT_COLUMNS: StatusColumn[] = [
  { id: "backlog",     label: "Backlog" },
  { id: "todo",        label: "Todo" },
  { id: "in_progress", label: "In Progress" },
  { id: "done",        label: "Done", isDone: true },
];
```

### マイグレーション

既存 `todos.json` を初回ロード時に変換する（破壊的書き換えはしない、読み込み時に補完）:

| 既存値                          | 補完される値                              |
| ------------------------------- | ----------------------------------------- |
| `status` 未設定 & `completed`   | `status = "done"` (= `isDone: true` 列の id) |
| `status` 未設定 & `!completed`  | `status = "todo"`                         |
| `order` 未設定                  | `createdAt` の昇順で 1000, 2000, ... を割振 |

書き込みが発生したタイミングで normalize 後の値が永続化される。`columns.json` が無ければ `DEFAULT_COLUMNS` を返す。

### `done` 列削除時の扱い

ユーザが `isDone: true` の列を削除した場合:

- 残りの列のうち先頭を新たな `isDone: true` にする（少なくとも 1 つは done 列を維持）
- 削除を許可しない場合のエラー文言を返す（最後の done 列は削除不可）
- 削除対象の列にあった item は最後尾の列へ移動する

`isDone` を別の列に切り替えた場合は、その列にいる item の `completed` を `true` に同期する。

---

## API (Web UI 専用 REST)

> MCP ツール (`manageTodoList`) は無変更。新フィールドの読み書きは Web UI 専用の REST エンドポイントだけが扱う。

### 既存 (互換のため変更しない)

- `GET /api/todos` — 既存形を維持。**`columns` を同梱**するためにレスポンスを `{ data: { items, columns } }` に拡張する（既存の View/Preview は `data.items` を読んでいるだけなので破壊しない）。
- `POST /api/todos` — 既存 MCP 経由の action ディスパッチ。**ハンドラは触らない**（既存 add / check / update / labels 系がそのまま動く）。

### 新規

REST 風に items とカラムを別リソースとして扱う。Express の `Request<Params, ResBody, ReqBody>` 型付けで実装する。

#### Items

| Method | Path                       | Body                                                                     | 動作                                                  |
| ------ | -------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| PATCH  | `/api/todos/items/:id`     | `{ text?, note?, status?, priority?, dueDate?, labels?, completed? }`    | 部分更新。`undefined` 不在キーは保持、`null` は削除   |
| POST   | `/api/todos/items/:id/move`| `{ status?: string, position?: number }`                                 | drag & drop の永続化（列移動 + 列内位置）             |
| DELETE | `/api/todos/items/:id`     | -                                                                        | 削除                                                  |
| POST   | `/api/todos/items`         | `{ text, note?, status?, priority?, dueDate?, labels? }`                 | 新規追加                                              |

`PATCH` を id ベースで提供することで「text 部分マッチで対象を探す」既存 MCP 経路の弱点（重複ヒット / 改名後に見つからない）を回避する。Web UI は item id を直接知っているので問題ない。

#### Columns

| Method | Path                          | Body                                          | 動作                                                       |
| ------ | ----------------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| GET    | `/api/todos/columns`          | -                                             | 現在の columns.json（無ければ DEFAULT_COLUMNS）            |
| POST   | `/api/todos/columns`          | `{ label: string, isDone?: boolean }`         | 列追加。id は label を slug 化して生成、衝突時は `_2` 付与 |
| PATCH  | `/api/todos/columns/:id`      | `{ label?: string, isDone?: boolean }`        | リネーム / done フラグ切替                                 |
| DELETE | `/api/todos/columns/:id`      | -                                             | 削除（中の item は最後尾の列へ退避、最後の done 列は不可） |
| PUT    | `/api/todos/columns/order`    | `{ ids: string[] }`                           | カラムの並び順を上書き                                     |

### ハンドラ実装方針

- `server/routes/todos.ts` を router 単位で分割し、items / columns 用の純粋ハンドラを `server/routes/todosItemsHandlers.ts` / `server/routes/todosColumnsHandlers.ts` (新規) に切り出す。`todosHandlers.ts` (既存 MCP action 用) はそのまま温存。
- すべてのハンドラは `(state, input) => result` の純粋関数として書き、route handler は I/O だけ担当する（既存 `dispatchTodos` パターンを踏襲）。
- I/O は引き続き `server/utils/file.ts` の `loadJsonFile` / `saveJsonFile` を使う。

### 永続化

- `workspace/todos/todos.json` — 既存。新フィールド追加。
- `workspace/todos/columns.json` — 新規。

---

## フロントエンド

### 統合ポイント — `src/components/FilesView.vue`

Scheduler パターンを踏襲。`todos/todos.json` を選択した時に、`todoExplorerResult` を合成して `<TodoExplorer>` を描画する:

```vue
<div v-if="schedulerResult" class="h-full">
  <SchedulerView :selected-result="schedulerResult" />
</div>
<div v-else-if="todoExplorerResult" class="h-full">
  <TodoExplorer :selected-result="todoExplorerResult" />
</div>
```

`todoExplorerResult` computed:

- `selectedPath.value === "todos/todos.json"` のとき
- パース成功時に `{ uuid: "files-todo-preview", toolName: "manageTodoList", data: { items, columns } }` を返す
- columns は別途 `/api/todos/columns` から取得（または `/api/todos` 統一エンドポイントで一緒に返す ← こちらを採用）

### 新コンポーネント

#### `src/components/TodoExplorer.vue` (新規)

ファイルエクスプローラ用のフル画面 todo ビュー。中身:

- **ヘッダ**:
  - View モード切替タブ: `Kanban` / `Table` / `List`（localStorage `todo_explorer_view_mode` に保存）
  - ラベルフィルタチップ（既存 `View.vue` のロジックを抽出して再利用）
  - 検索ボックス（text / note の case-insensitive substring 検索）
  - 「+ Add」ボタン: 新規 item ダイアログ
  - 「+ Column」ボタン (Kanban view 時のみ表示): 列追加ダイアログ
- **ボディ**: 選択中の view モードに応じて子コンポーネントを描画
  - `<TodoKanbanView>` / `<TodoTableView>` / `<TodoListView>`

#### `src/components/todo/TodoKanbanView.vue` (新規)

- `vuedraggable` (`yarn add vuedraggable@next`) で列内 / 列間 drag & drop。
- 各列ヘッダ: column.label + count + メニュー（rename / delete / 「右に列を追加」）
- カード:
  - text（1行・truncate）
  - labels（チップ）
  - priority（左ボーダー or アイコン: low=灰 / medium=青 / high=橙 / urgent=赤）
  - dueDate（バッジ。期限切れは赤、当日はオレンジ）
  - クリックで詳細パネル展開（既存 View.vue の YAML editor を再利用 or 新ダイアログ）
- drag 終了時に `POST /api/todos/items/:id/move` を呼んで永続化。失敗時は state を rollback。

#### `src/components/todo/TodoTableView.vue` (新規)

- 列: text / status / priority / labels / dueDate / created
- ヘッダクリックでソート（client-side）
- 行クリックで詳細パネル展開
- インライン編集（status / priority は select、dueDate は date input）

#### `src/components/todo/TodoListView.vue` (新規 or 既存 View.vue を流用)

- 既存 `src/plugins/todo/View.vue` のロジックをそのまま使う。
- 既存 plugin View はチャット内で tool result として描画される時にも使うので、共通ロジックは `src/plugins/todo/composables/useTodos.ts` に切り出して両方から呼ぶ。

#### `src/plugins/todo/View.vue` (既存)

- 既存のチャット内 view は維持。`useTodos` composable に置き換えて、`TodoExplorer` と共通ロジック化。

### Composable: `src/plugins/todo/composables/useTodos.ts` (新規)

- `loadTodos()` / `loadColumns()` / `callApi(action, body)` / `optimisticUpdate()` を提供
- `useFreshPluginData` を内包し、items + columns を ref で公開
- `applyMove(itemId, statusId, position)` / `applySetStatus()` / `applySetPriority()` / `applySetDueDate()` などの操作を提供
- view component は表示のみに集中できる

### 色 / アイコン

- ラベル色: 既存 `src/plugins/todo/labels.ts` の `colorForLabel()` を流用。
- ステータス列の色: `colorForLabel(column.id)` を流用 or 専用 palette を作る（後者を採用）。
- priority 色: `low` 灰 / `medium` 青 / `high` 橙 / `urgent` 赤 — `src/plugins/todo/priority.ts` (新規) で定数化。
- dueDate 色: 過去 = 赤、当日 = 橙、3 日以内 = 黄、それ以外 = 灰。

---

## 既存 LLM 経路への影響

`manageTodoList` MCP ツール (`src/plugins/todo/definition.ts`) は **無変更**。既存の `add` / `check` / `update` / `add_label` などはそのまま使える。

ただし、**マイグレーション**（後述）によって既存 item にも `status` / `order` フィールドが付与される。LLM はこれらの新フィールドを知らないが、`update` で `text` / `note` だけを書き換える限り、新フィールドは保持される（ハンドラ実装で `...target` のスプレッドを徹底する）。

将来 LLM 経路にも新フィールドを伝えたくなったら、別 issue として `definition.ts` を拡張する。

---

## 実装フェーズ

### Phase 1 — データモデル & REST API

1. `TodoItem` に `status` / `priority` / `dueDate` / `order` を追加（`server/routes/todos.ts` と `src/plugins/todo/index.ts` の両方）
2. `workspace/todos/columns.json` の load / save と `DEFAULT_COLUMNS` 定数を `server/routes/todosColumnsHandlers.ts` (新規) に実装
3. マイグレーションロジック（loadTodos 時に既存 item に status / order を補完）— 既存 MCP 経路の挙動が壊れないことを既存テストで担保
4. 新 REST ルートの実装:
   - `server/routes/todosItemsHandlers.ts` — items 用純粋ハンドラ
   - `server/routes/todosColumnsHandlers.ts` — columns 用純粋ハンドラ
   - `server/routes/todos.ts` に `PATCH /items/:id` / `POST /items/:id/move` / `DELETE /items/:id` / `POST /items` / `GET|POST|PATCH|DELETE /columns(/:id)` / `PUT /columns/order` を追加
5. `GET /api/todos` のレスポンスに `columns` を含める
6. `manageTodoList` MCP の既存ハンドラ (`server/routes/todosHandlers.ts`) は触らないが、**新フィールド保持**のための regression test を追加（`update` を呼んでも `status` / `priority` / `dueDate` が消えないこと）
7. **テスト**:
   - `test/test_todos_items_handlers.ts` (新規) — 新 REST ハンドラのハッピーパス + バリデーション + マイグレーション
   - `test/test_todos_columns_handlers.ts` (新規) — 列追加 / 削除（done 列維持ルール含む）/ リネーム / 並び替え
   - 既存 MCP ハンドラの regression テストを追加

### Phase 2 — TodoExplorer 基本 UI

1. `useTodos` composable の作成 — 新 REST 経路 (`PATCH /items/:id` 等) を呼ぶ薄いラッパ。items + columns を ref で公開
2. 既存 `src/plugins/todo/View.vue` は **触らない**（チャット tool result 用は現状維持。Phase 4 で必要なら refactor を検討）
3. `TodoExplorer.vue` シェル（ヘッダ + view 切替 + ラベルフィルタ + 検索）
4. `FilesView.vue` の特殊ケース追加（todos/todos.json → TodoExplorer）
5. `TodoListView.vue` 描画（最初は List だけで動かす）
6. `TodoTableView.vue` 描画（ソート + インライン編集）

### Phase 3 — Kanban + drag & drop

1. `yarn add vuedraggable@next`
2. `TodoKanbanView.vue` 実装（列描画 + カード描画）
3. drag & drop ハンドラ → `move` action 呼出
4. 列追加 / 削除 / リネームの UI（カラムヘッダのメニュー）
5. priority / dueDate のカード上での視覚化

### Phase 4 — 仕上げ

1. localStorage への view モード / アクティブフィルタ永続化
2. キーボード操作（矢印キーで card 移動など — オプション）
3. README.md / CLAUDE.md の更新（todo plugin の節）
4. `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` を全部緑に

---

## 影響範囲（変更ファイル一覧）

### 新規

- `src/components/TodoExplorer.vue`
- `src/components/todo/TodoKanbanView.vue`
- `src/components/todo/TodoTableView.vue`
- `src/components/todo/TodoListView.vue`
- `src/plugins/todo/composables/useTodos.ts`
- `src/plugins/todo/priority.ts`
- `server/routes/todosItemsHandlers.ts`
- `server/routes/todosColumnsHandlers.ts`
- `test/test_todos_items_handlers.ts`
- `test/test_todos_columns_handlers.ts`

### 編集

- `server/routes/todos.ts` — 新 REST ルート追加・`GET` レスポンスに columns 同梱
- `server/routes/todosHandlers.ts` — マイグレーション後の新フィールドを保持するよう既存 `update` ハンドラを微調整 + regression test
- `src/plugins/todo/index.ts` — TodoItem 拡張（`status` / `priority` / `dueDate` / `order`）
- `src/plugins/todo/Preview.vue` — status / priority / dueDate の小バッジ追加（オプション）
- `src/components/FilesView.vue` — TodoExplorer 統合
- `package.json` — vuedraggable 追加
- `README.md` — todo セクション更新

### 触らない

- `src/plugins/todo/definition.ts` — **MCP ツール定義は無変更**
- `src/plugins/todo/View.vue` — 既存チャット内 view は無変更（必要なら Phase 4 で refactor）
- `server/agent.ts` (`MCP_PLUGINS` には既に `manageTodoList` がいる前提)
- `src/tools/index.ts` (todo plugin 登録済み)
- `src/config/roles.ts` (既存ロールに含まれている前提 — 要確認)

---

## オープンな決定事項

1. **drag & drop ライブラリ**: `vuedraggable@next` か `vue-draggable-plus` か。前者は SortableJS ベースで成熟。**判断**: `vuedraggable@next` を採用。
2. **詳細編集 UI**: 既存 YAML editor を継続するか、フォーム化するか。**判断**: Phase 2 までは既存の YAML editor を継続。Phase 4 でフォーム化を検討。
3. **column id の生成**: ユーザが label を入れた時に slug 化（小文字 + `_` 置換）。重複は `_2` を付与。
4. **キーボード操作**: out of scope (Phase 4 でオプション)。

---

## リスク / 注意

- **`completed` フィールドとの二重管理**: 後方互換のため残すが、`isDone` 列との同期を間違えると view が壊れる。Phase 1 のテストで全パターンを golden test する。
- **drag & drop の競合**: 楽観的更新後にサーバが reject した場合の rollback。`useTodos.applyMove` で前状態を保持して失敗時に戻す。
- **既存 MCP ハンドラとの併存**: マイグレーションで追加された `status` / `order` を、既存 `update` ハンドラ (`server/routes/todosHandlers.ts:132-161`) が上書きで消してしまう罠がある。`...target` のスプレッドが効いていることを regression test で確認する。
- **既存 chat view (`src/plugins/todo/View.vue`) との回帰**: 触らない方針だが、`GET /api/todos` のレスポンス形 `{ data: { items, columns } }` に変わるため、フロントが `data.items` を読んでいる箇所が壊れないかを実機で確認する（既存実装は `result.data?.items` を読んでいるので問題ないはず）。

---

## 参考 (関連ファイル)

- `src/plugins/todo/View.vue` — 既存リスト + YAML editor
- `src/plugins/todo/labels.ts` — 既存ラベルロジック (色 / フィルタ / 集計)
- `src/plugins/todo/Preview.vue` — sidebar preview
- `server/routes/todos.ts:9-16` — TodoItem
- `server/routes/todosHandlers.ts:302-316` — HANDLERS map（新 action 追加先）
- `src/components/FilesView.vue:58-60` / `src/components/FilesView.vue:298-317` — Scheduler の特殊ケース統合パターン
- `src/plugins/scheduler/View.vue` — full-canvas plugin view の参考実装
- `plans/feat-todo-labels.md` — labels 機能の前 PR の設計（流儀の参考）
