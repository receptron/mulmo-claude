# #763 PR 1: wiki page write consolidation

Issue: https://github.com/receptron/mulmoclaude/issues/763

## ゴール

wiki page 書き込みを 1 関数に統合する。**履歴機能は入れない**。挙動変化ゼロが目標。後続 PR (snapshot ストレージ / API / UI) のための choke point を main に入れて寝かせる。

副次目標: wiki-backlinks の `fsp.writeFile` 直叩きをアトミック化(独立のバグ修正)。

## 現状の write 経路

| 経路 | 箇所                                                        | 現状                           | trigger                                                       |
| ---- | ----------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| ①    | `server/api/routes/wiki.ts:513` (`saveExistingPage`)        | `writeFileAtomic`              | LLM の `manageWiki` MCP tool / フロントの task-checkbox click |
| ②    | `server/api/routes/files.ts:766` (`PUT /api/files/content`) | `writeFileAtomic`              | FileContentRenderer のユーザ save                             |
| ③    | `server/workspace/wiki-backlinks/index.ts:42,97`            | `fsp.writeFile` (非アトミック) | agent 終了時のセッション backlink 自動追加                    |

## 新規モジュール: `server/workspace/wiki-pages/io.ts`

```ts
export type WikiPageEditor = "llm" | "user" | "system";

export interface WikiWriteMeta {
  editor: WikiPageEditor;
  /** Chat session that triggered the edit. Optional — not all
   *  callers know one (e.g. user opening the file editor). */
  sessionId?: string;
  /** Free-form short reason; LLM-supplied or human-supplied. */
  reason?: string;
}

/** Resolve the absolute path for a slug. Does not check existence. */
export function wikiPagePath(slug: string): string;

/** Read a wiki page; null if missing. Used by writeWikiPage to
 *  capture the pre-write content for future snapshotting. */
export async function readWikiPage(slug: string): Promise<string | null>;

/** Write a wiki page atomically. Records the (old, new) pair to the
 *  snapshot pipeline for #763 PR 2. Currently a no-op stub. */
export async function writeWikiPage(slug: string, content: string, meta: WikiWriteMeta): Promise<void>;

/** Predicate for routing the generic /api/files PUT into the wiki
 *  pipeline. Matches paths under `data/wiki/pages/*.md`. Returns the
 *  derived slug on match. */
export function classifyAsWikiPage(absPath: string): { wiki: true; slug: string } | { wiki: false };
```

`appendSnapshot` は private no-op stub。signature だけ用意して PR 2 で本体を埋める:

```ts
async function appendSnapshot(_slug: string, _oldContent: string | null, _newContent: string, _meta: WikiWriteMeta): Promise<void> {
  // PR 2 で実装。現状は no-op。
}
```

## 移行: 各 caller の書き換え

### ① `server/api/routes/wiki.ts`

`saveExistingPage(pageName, content)` の中で:

```ts
const absPath = await resolvePagePath(pageName);
if (!absPath) return { ok: false, reason: "not-found" };
const slug = path.basename(absPath, ".md");
await writeWikiPage(slug, content, { editor: "user" });
```

editor は暫定的に `"user"`。LLM 経路かユーザ経路かの分離は PR 2 で扱う(リクエスト側に flag を立てる、または `manageWiki` MCP の側で `editor: "llm"` を送る)。

### ② `server/api/routes/files.ts`

PUT /api/files/content の中で、`absPath` を `classifyAsWikiPage` で振り分け:

```ts
const wikiClass = classifyAsWikiPage(absPath);
if (wikiClass.wiki) {
  await writeWikiPage(wikiClass.slug, contentRaw, { editor: "user" });
} else {
  await writeFileAtomic(absPath, contentRaw, { uniqueTmp: true });
}
```

`uniqueTmp` は wiki page では指定しない (writeWikiPage 内部で握る判断)。

### ③ `server/workspace/wiki-backlinks/index.ts`

`defaultDeps.writeFile` を `writeWikiPage(slug, content, { editor: "system", sessionId })` に置き換える。`deps` の seam (テスト用) は残す。

## テスト

新規ユニットテスト `test/workspace/wiki-pages/test_io.ts`:

- `wikiPagePath` が `data/wiki/pages/<slug>.md` を返す (cross-platform: `path.join`)
- `readWikiPage` が存在ファイルの内容を返す
- `readWikiPage` が ENOENT で null を返す
- `writeWikiPage` がファイルを作る (新規)
- `writeWikiPage` がファイルを上書きする (既存)
- `writeWikiPage` がアトミック (tmp ファイルがディレクトリに残らない)
- `classifyAsWikiPage` が `data/wiki/pages/foo.md` を `{ wiki: true, slug: "foo" }` と判定
- `classifyAsWikiPage` が `data/wiki/index.md` を `{ wiki: false }` と判定
- `classifyAsWikiPage` が `data/wiki/pages/foo.txt` を `{ wiki: false }` と判定 (拡張子チェック)
- `classifyAsWikiPage` が path traversal (`..`) で false を返す (defensive)

既存テストは挙動不変のため全て通る前提:

- `test/server/api/routes/test_wiki.ts`
- `test/workspace/wiki-backlinks/test_*.ts`
- `test/server/api/routes/test_files.ts`

## 完了条件

- [ ] `server/workspace/wiki-pages/io.ts` 新規追加
- [ ] 3 経路すべて `writeWikiPage` 経由
- [ ] wiki-backlinks がアトミック化(クラッシュ耐性向上)
- [ ] 新規ユニットテスト (上記 9 ケース)
- [ ] 既存テスト全パス
- [ ] `yarn typecheck && yarn lint && yarn build && yarn test` clean
- [ ] e2e: 既存 wiki / files の e2e が通る

## Out of scope (後続 PR)

- snapshot ストレージ実装 (`appendSnapshot` 本体)
- editor identity の LLM/user 分離 (今は `'user'` placeholder)
- API endpoints (history list / diff / restore)
- UI (History tab / unified diff / restore button)
- GC / 保持ポリシー
- e2e for history flow

## 詰まりどころ予想

1. **editor の placeholder で議論される** — レビューで「LLM と user は分けるべき」と言われたら "PR 2 で扱う" と答える。今は no-op stub なので機能差なし。
2. **wiki-backlinks のテストが落ちる** — `deps.writeFile` の signature が `(filePath, content) => Promise<void>` から内部的に `writeWikiPage` 呼び出しになると、テストの mock 互換性が崩れる可能性。`deps` は維持しつつ、デフォルト実装だけ writeWikiPage 経由にする。
3. **`writeWikiPage` 内で `wikiPagePath(slug)` を呼ぶと `WORKSPACE_PATHS.wikiPages` に依存する** — テストで workspace を override する仕組みが必要かも。既存の `workspaceRoot` injection パターンを踏襲。
