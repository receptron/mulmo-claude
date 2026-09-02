# fix(#3031): staged view の先読みを slug 単位にする

## 症状

staging を持つワークスペースで、**staged ではない**コレクションの view が、
古い staging のコピーに乗っ取られる。

- コレクション A: 正しく staged（`data/skills/a/schema.json` あり）
- コレクション B: `.claude/skills/b/views/v1.html` に commit 済み（direct / imported）
- 古い `data/skills/b/views/v1.html` が残っている（`data/skills/b/schema.json` は**無い**）

→ B の view は「古い staging のコピー」が返る。

## 原因

`packages/core/src/collection/server/skillAssets.ts` の `readSourceAwareFile`:

```ts
const staging = collection.source === "project" ? stagingSkillDir(workspaceRoot, safeSlug) : null;
const bases = staging === null ? [collection.skillDir] : [staging, collection.skillDir];
```

`stagingSkillDir(root, slug)` は `<skillsStagingDir(root)>/<slug>` を**組み立てるだけ**で、
その slug が本当に staged かは見ていない。判定は **root 単位**になっている。

一方 `views.ts` の削除側 `canonicalBase` / `schemaWriteTargets` は per-slug で見ている:

```ts
if (staging !== null && (await fileExists(path.join(staging, SCHEMA_FILE)))) return staging;
```

しかも `canonicalBase` の JSDoc は **"Matches `readCustomViewHtml` so reads and deletes agree on
both layouts"** と書いているのに、実際には一致していない。読み側にだけ証拠チェックが無い。

ホスト側では直せない。束縛は `skillsStagingDir: (workspaceRoot: string) => string | null` で
slug を受け取らず、`<staging>/<slug>` を join するのは core 内部だから
（receptron/mulmoterminal#1957 で確認済み）。

## 決定

### D1: 「この slug は staged か」を 1 つの関数にして、読みと削除の両方が使う

`skillAssets.ts` に:

```ts
export async function stagedSkillDir(workspaceRoot: string, safeSlug: string): Promise<string | null> {
  const staging = stagingSkillDir(workspaceRoot, safeSlug);
  if (staging === null) return null;
  return (await isRegularFile(path.join(staging, SCHEMA_FILE))) ? staging : null;
}
```

読み（`readSourceAwareFile`）と削除（`canonicalBase` / `schemaWriteTargets`）の両方をこれに
通す。**式を 2 か所に書き写すのではなく共有する**のが要点で、`canonicalBase` の JSDoc が
主張している「読みと削除が一致する」が、そこで初めて構造的に本当になる。

証拠が `schema.json` なのは、それが staged なコレクションが実際に持つ形だから。
`putSchema` が書き、`canonicalBase` が既に見ているファイル。

### D2: 証拠の判定は `isRegularFile`（`io.ts` の共有ヘルパー）にする

`views.ts` の private `fileExists` は `stat` —— symlink を辿る。`isRegularFile` は `lstat` で、
symlink を「通常ファイルではない」と答える。このリポジトリが record 読み取りで採っている
symlink 防御と同じ向き。

**削除側にとっては挙動の変更**（staging の `schema.json` が symlink のとき、staging を
canonical と見なさなくなる）。方向としては安全側だが、PR で明示する。

`fileExists` はこれで使われなくなるので削除する。

### D3: 既存 fixture 2 件は「実際の authoring レイアウト」に直す

`test/workspace/collections/test_io.ts` の

- "reads project views from the staging dir (authoring layout)"
- "prefers the staging-dir copy over the skillDir copy when both exist"

は staging に `views/` だけを置き、`schema.json` を置いていない。実際の authoring レイアウトは
`putSchema` が `schema.json` を書くので、**fixture が実物より薄い**。schema.json を足して
実物に合わせる。

そのうえで **#3031 のケース**（staging に view はあるが schema.json は無い）を新規テストで
留める —— これが今回の振る舞いの変更点。

## 何が変わらないか

| レイアウト | 変化 |
|---|---|
| staged なコレクション（`<staging>/<slug>/schema.json` あり） | 変化なし。staging が勝つ |
| imported なコレクション（staging tree 自体が無い） | 変化なし。skillDir を読む（probe が 1 回減るだけ） |
| staging を持たない root（`skillsStagingDir` → `null`） | 変化なし |
| user / feed スコープ | 変化なし（`source !== "project"`） |
| **staged でない slug に古い staging view が残っている** | **commit 済みが勝つ ← 修正** |

## 変更

| 変更 | 場所 |
|---|---|
| `stagedSkillDir` を足し、`readSourceAwareFile` を通す | `packages/core/src/collection/server/skillAssets.ts` |
| `canonicalBase` / `schemaWriteTargets` をそれに通し、`fileExists` を削除 | `packages/core/src/collection/server/views.ts` |
| fixture を実物に合わせ、#3031 のケースを追加 | `test/workspace/collections/test_io.ts` |
| per-slug の証拠を core のテストでも留める | `packages/core/test/collection/test_stagedPerSlug.ts`（新規） |
