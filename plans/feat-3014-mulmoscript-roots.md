# feat #3014 — stories の根を複数にする（実装順序 1: プラグイン）

## この段階のスコープ

契約と ops に `root` を通す。**ホストは workspace だけ登録するので挙動は変わらない。**
同一性の鍵を `(root, filePath)` の対に広げるのもここ。

MulmoTerminal 側の宣言・UI（順序 2/3）は別 PR。

## 調査でわかったこと（issue にコメント済み）

制限は性質の違う 2 つの合成だった:

| | 正体 | 変えてよいか |
|---|---|---|
| 封じ込め | エージェント供給パス（`filePath` は `definition.ts:109` の tool schema）に対する二層ガード。字句 `normalizeStoryPath` + realpath `resolveWithinRoot` | **不可** |
| 根が 1 個 | `MulmoScriptServerBackend.storiesDir` が文字列 1 本という実装都合 | **可** |

Docker 由来ではない（plugin の `src/` に docker/container/sandbox の記述ゼロ）。
`stories/` の wire form も歴史的な遺産で、セキュリティ上の意味は無い。

## 決めたこと / 先送りにしたこと

**決めた: `root` はホストが埋める。エージェントには渡させない。**
`definition.ts` は無変更。これが封じ込めの境界そのもの。エージェントが root を
名指しできると (a) が消え、プロンプトインジェクション 1 回で任意のファイルに届く。
「MulmoTerminal を起動したディレクトリ以下」はホストが根として登録すれば足りる。

**先送り: `root` 識別子の具体的な形。**
プラグインは `root` を**不透明な文字列キー**として扱い、`roots: Record<string, …>`
の索きにしか使わない。id の採番規則（宣言キー／realpath ハッシュ／不透明 id）は
ホストの持ち物なので、順序 2 で決めればよい。カードに永続化される決定を、
必要になる前に固めない。

**先送り: 成果物（動画・PDF）の置き場所。**
根が 1 個の現状ではスクリプト置き場と出力置き場が同一で、挙動不変の要件を満たす。
型は「1 根 = スクリプト dir」のまま置き、出力先を分ける必要が出た順序 2 で
`{ scriptsDir, outputsDir }` へ広げる。今わけると使われない分岐が増えるだけ。

## 変更

### `src/server/types.ts`

**追加型にする（置き換えではなく）。** 当初は `storiesDir` を `roots` へ
移すつもりだったが、`@mulmoclaude/mulmoscript-plugin` は npm 公開済みで、
消費者の MulmoTerminal は**別リポジトリ**にある。置き換えると、プラグインを
publish した瞬間に MulmoTerminal が壊れ、同一 PR で追随させることもできない。

- `storiesDir: string` は**そのまま**。これが「既定の根」になる
- `extraRoots?: Record<string, string>` を足す。id → 絶対パス
- wire の `root` が無ければ `storiesDir`、あれば `extraRoots` を索く

後方互換が定義から出る（`root` 無し = 既定の根 = 今の挙動）うえ、
MulmoTerminal は 1 行も変えずに動き続ける。minor で出せる。

### この段階で決めた 2 つの制限（レビューで確定）

**1. 未登録の `root` は既定の根へ fallback せず `bad_request` で拒否する。**
fallback は「名前だけ合った別ファイル」を黙って返す。読み違いは書き違いより
発見が遅いので、落とす方を選ぶ。空文字列・空白のみは既定の根（`root` 無しと
同じ）— これは既存の呼び出しを無改変で通すために必要。

**2. 名前付きの根は「読み取り専用」。書き込みと生成は拒否する。**
この段階で最大の機能制限。理由が 2 つあり、どちらもこのパッケージの外にある:

- **書き**: `executeMulmoScriptSave` と update 系の executor は 1 つの `FileOps`
  で動き、ホストが既定の根に束縛している。別の根を名乗る書きは**既定の根の
  同名ファイルを書き換えて、別の根が変わったと announce する**。
- **生成**: ホストのセッションストアは `generationKey`
  （`@mulmobridge/protocol`）で `(kind, filePath, key)` を鍵にする。1 セッションで
  2 つの根が同じ生成を始めると 1 エントリに潰れ、どちらかの完了が
  他方のインジケータを消す。protocol の変更は消費者を持つので順序 1 の範囲外。

どちらも `guardStoryWriteRoot` / `guardStoryGenerationRoot` が `bad_request` で
閉じ、根を登録したホストには boot で警告する。順序 2 が `generationKey` に
root を通したら、両方まとめて外れる。

### `src/core/contract.ts`
- `MulmoScriptGenerationEvent` / `MulmoScriptChangedEvent` に `root?: string`
- `shouldReloadForScriptChange` を `(root, filePath)` の対で比較
- dispatch args の各 kind に `root?: string`

### `src/server/ops.ts`
- `toStoryRef` / `resolveStory` / `ensureStoriesReal` を根ごとに
- `inFlightGenerations` の鍵に root を含める
- `canonicalWirePath` は wire path だけを正規化（root は別軸なので無変更）

## 「挙動が同じ」の証明

CLAUDE.md の規則どおり、旧実装をそのまま別ハーネスに写して新実装と
突き合わせる。対象は純粋な判定 2 つ:

1. `shouldReloadForScriptChange` — root 無しの入力で旧＝新
2. `canonicalWirePath` / `normalizeStoryPath` — 無変更を確認（回帰の網）

`resolveStory` は fs に触るので、生成した根の下で
「封じ込めが破れない」性質テストを別に置く（絶対パス・`..`・シンボリックリンク脱出）。

## 検証

- 既存テスト（`test/test_paths.ts`, `test_server_ops.ts`, `test_plugin.ts`）が無改変で緑
- 新規テスト（`test_roots.ts`, `test_server_roots.ts`, `test_dispatch_roots.ts`,
  `test_subscription.ts`, `test_transport_parsers.ts`）が緑
- 上の差分ハーネスで旧＝新
- ホスト 2 つ（mulmoclaude / MulmoTerminal）が**無改変で**ビルド緑
  — 追加型を選んだので `roots` への追随作業は発生しない（上の「追加型にする」参照）
