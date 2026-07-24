# Plan: Wiki auto-rebalance — フラットから自己整列ツリーへ

Status: design / discussion. **Document-only**, no code changes yet.

## Why

`data/wiki/pages/` は現状、**全 page が直下にフラット**に並ぶ:

```
data/wiki/pages/
  stuffed-peppers.md
  ramen-broth.md
  q3-revenue-review.md
  team-1on1-template.md
  ...
```

これは shipping 時の simplicity としては正しかったが、ユーザが増えてくると以下が顕在化:

- ページ数が 50, 100, 200 と増えると **直下が濁ってくる** (ls / Finder で読めなくなる)
- Obsidian / Notion から **既存の階層構造を持ち込みたい** ユーザがいる (recipes/japanese/, projects/q3/, journal/2026-05/ といったツリー)
- ジャンル横断の閲覧 (cooking 関連だけ、business 関連だけ) を **物理パスの近接で支えたい** 場面が出てくる
- 一方で **ユーザにファイル整理の認知負荷を負わせない** のが MulmoClaude の哲学 ("Files are the database" だが、整理は AI に任せたい)

ここで参考になるのが既存の memory レイヤ。`conversations/memory/` は #1029 で flat atomic から #1070 で `<type>/<topic>.md` の topic-clustered 構造に移行している。**同じ発想を wiki にも適用する**。

ただし memory の "stage → review → swap" 方式は wiki にはオーバースペック。理由:

- memory は LLM が裏で淡々と書き溜めるので **review が必須**
- wiki はユーザも能動的に編集するので **review を強要すると体験が悪い**
- wiki は `[[link]]` でつながったグラフなので、**slug 同一性さえ保てば物理移動は user-invisible でよい**

## Why MulmoClaude

- ワークスペースが **ファイルそのもの** = 物理レイアウトを動かしても破綻しない (DB の reorganize と違って transactions 不要)
- **slug ベースのリンク** (`[[stuffed-peppers]]`) が既に確立されているので、絶対パス参照は本来発生しない
- LLM が分類を提案できる = "B-tree 平衡化" に **意味論的判断**を混ぜられる (= 人間が手で整理した時の "あの感じ" を再現できる)
- scheduler + skill 機構があるので、**定期実行のインフラはタダ**

## ユーザから引き出した制約 (= 設計の出発点)

これがそのまま設計判断を縛る:

1. **バックアップ的な"ゴミファイル"を残さない** — `memory.md.backup` / `<slug>.bak` / `pages.next/` 的なものは作らない
2. **定期的に自動でリバランス** — ユーザが手動キックしなくて良い。scheduler 任せ
3. **移動履歴だけは永続データとして保持** — リンク切れ救済の根拠データ
4. **ユーザはファイル構造を知らなくて良い** — slug 1 つで全てが解決される世界観

これらを組み合わせると、メモリ流の `stage → swap` ではなく、**event-sourced な "moves.jsonl が真実" 設計** になる。

## Architecture

### データ構造 (3つだけ)

```
data/wiki/
  pages/
    stuffed-peppers.md                     ← フラット (まだ移動されていない)
    recipes/
      ramen-broth.md                       ← rebalancer が clustered で移動済み
      japanese/
        miso-soup.md
    business/q3-revenue-review.md
  .index/
    slug-paths.json                        ← slug → 現在パス のキャッシュ (再構築可能)
    moves.jsonl                            ← append-only 移動ログ (唯一の真実)
```

#### `pages/`

`pages/.../<slug>.md` の任意の深さを許可。slug はファイル名 (拡張子を除いた) 部分で **一意**。`recipes/foo.md` と `business/foo.md` の共存は禁止。これは memory の topic-slug uniqueness と同じ規約。

#### `slug-paths.json`

```json
{
  "stuffed-peppers": "pages/stuffed-peppers.md",
  "ramen-broth": "pages/recipes/ramen-broth.md",
  "miso-soup": "pages/recipes/japanese/miso-soup.md",
  "q3-revenue-review": "pages/business/q3-revenue-review.md"
}
```

- 起動時に `pages/**/*.md` から再生成可能 → **これ自体は捨てて良いキャッシュ**
- read 性能のためのインデックス、リンク解決の第一段
- ファイル変更通知 (chokidar) で increment 更新

#### `moves.jsonl` (= 設計の肝, Write-Ahead Log として運用)

各 move は **2 行で 1 トランザクション** (WAL):

```jsonl
{"ts":"2026-05-07T10:15:23Z","slug":"ramen-broth","from":"pages/ramen-broth.md","to":"pages/recipes/ramen-broth.md","reason":"cluster:cooking","by":"rebalancer","status":"pending"}
{"ts":"2026-05-07T10:15:23Z","slug":"ramen-broth","status":"committed","refTs":"2026-05-07T10:15:23Z"}
{"ts":"2026-05-08T14:02:01Z","slug":"miso-soup","from":"pages/recipes/japanese/miso-soup.md","to":"pages/recipes/miso-soup.md","reason":"merge:sparse-japanese","by":"rebalancer","status":"pending"}
{"ts":"2026-05-08T14:02:01Z","slug":"miso-soup","status":"committed","refTs":"2026-05-08T14:02:01Z"}
```

**書き込み順 (= 設計の肝)**:

1. `pending` 行を append + fsync
2. fs.rename を実行 (atomic)
3. `committed` 行を append + fsync (失敗時は `failed` 行)

これにより:

- **クラッシュが rename 前**: pending 行だけが残る → 起動時に from が存在 / to が存在しない → 再試行可能、または `failed` を追記して打ち切り
- **クラッシュが rename 後・committed 前**: pending 行のみ + to 側に実体 → 起動時に検知して `committed` を遡及追記
- **正常終了**: `pending` + `committed` のペアで揃う

**Resolver は `status:"committed"` 行 (またはペア未完だが to 側に実体がある行) のみを真とみなす**。pending 単独行は無視。

**Recovery (起動時)**:

```
moves.jsonl を末尾から走査:
  各 pending 行について同 slug の committed/failed が後続にあるか確認
    なし → fs を見て:
      - to が存在 → "committed" を遡及追記
      - from が存在 → "failed" を追記 (rename 未実行とみなす)
      - 両方無い / 両方ある → warn ログ、人間判断扱い (= moves.jsonl は触らず、運用者に委ねる)
```

その他の特性:

- **append-only** — 過去エントリは絶対に書き換えない (WAL なので追記のみ)
- 履歴を全部辿れば slug の現在地が分かる (= `slug-paths.json` がなくても再構築可能)
- 古いチャットセッション JSONL が `data/wiki/pages/miso-soup.md` を絶対パスで言及していた場合、**最新位置に転送できる**
- ユーザが手で移動した場合も、watcher が検出してこのログに `"by":"user","status":"committed"` の単独行で append する (rename はユーザが既に終えているので pending phase スキップ)

### リンク解決の3段フォールバック

`[[stuffed-peppers]]` の解決:

```
1. slug-paths.json[slug]                   (ホットパス、in-memory キャッシュ)
   ↓ miss
2. moves.jsonl の最新エントリの `to`        (キャッシュ再構築前 / インデックス壊れ時)
   ↳ moves-archive/<YYYY>.jsonl も併読     (古い slug の救済)
   ↓ miss (slug がログ全体にも無い)
3. pages/**/*.md を再スキャン               (最終救済、あとで slug-paths.json を再生成)
   ↓ miss
4. 404 (page not found)
```

**重要**: ステップ 2 の "log 走査" は **moves.jsonl + moves-archive/\*.jsonl の両方を見る**。
ログ rotation で古いエントリが archive 行きになっても resolver からは見える。
頻度が低い fallback パスなので I/O コストは許容範囲。
完全 in-memory にしたい場合は `moves-compact.json` (slug → 最新 `to` のスナップショット) を別途生成してキャッシュする選択肢あり。これは PR-A スコープ外で必要なら後追い。

これで **インデックスが壊れていてもユーザ画面が壊れない** ことを保証する。

### Markdown 本体内の絶対パス書き換えはしない

LLM が `![](../../images/foo.png)` のような相対パスや `data/wiki/pages/foo.md` のような workspace-rooted パスを書くことはあり得る。**これらをリバランスのたびに書き直すのは "ゴミを残さない" 原則と逆走** (本文書き換え = 別の意味でのゴミ生成、編集履歴の汚染)。

代わりに:

- `[[slug]]` 形式は資産 (= リバランス耐性あり)
- 相対画像パスは "リバランスでリンク切れし得る" と割り切る (rebalancer は画像参照を持つページの移動を保守的にする)
- **画像も slug 化する別議論**は将来 (e.g. `![[asset:foo]]`) — 本 plan のスコープ外

## Rebalancer

scheduler が定期起動する skill / 内部 job。LLM が分類を提案、決定的コードが移動を実行する分業。

### 起動条件

- scheduler trigger: 週 1 回 `interval 168h` (デフォルト) — 設定で変更可
- ページ数閾値: `pages/` 直下が N 個超えたら手動キック可 (将来)
- skip 条件:
  - 直近 N 時間以内に既に走っていた (二重起動防止)
  - 全ページの mtime が直近 24h 以内 (ユーザが集中編集中、触らない)

### フロー

```
1. スキャン
   - pages/**/*.md を全列挙、メタ情報収集 (slug, 現在パス, mtime, 本文サイズ, タグ, [[link]] 数)
   - 直近 24h 編集 mtime ページは "frozen" マーク

2. LLM クラスタリング提案
   - 入力: { slug, title, tags, currentPath, neighbors_via_links: [...] } の配列
   - 出力: { slug, suggestedPath, reason, confidence } の配列
   - LLM プロンプト: "スラッグ群を意味論的にグルーピングして、フォルダ階層を提案。深さ 2 まで。同じカテゴリに 3 件未満なら親に merge。confidence < 0.7 は触らない"
   - memory の `topic-cluster.ts` の MemoryClusterer 関数シグネチャを参考に書く

3. 移動候補のフィルタ + 正規化
   - frozen ページは除外
   - confidence < 0.7 の提案は除外
   - 今回 cycle で移動先がフラッパーになる (前回も今回も提案され続けて行ったり来たり) は除外
   - **suggestedPath の正規化境界** ← LLM 出力を信用しない:
     ```ts
     const pagesRoot = path.resolve(workspaceRoot, "data/wiki/pages");
     const candidate = path.resolve(pagesRoot, suggestedPath);
     reject if !candidate.startsWith(pagesRoot + path.sep);   // .. / 絶対パス escape
     reject if path.basename(candidate) !== `${slug}.md`;     // basename ≠ slug
     reject if fsSync.lstatSync(parent).isSymbolicLink();     // symlink escape
     reject if depth > MAX_DEPTH (= 3);                       // 暴発防止
     ```
   - 拒否された候補は warn ログ + その slug は skip (次回再試行)
   - 結果が空なら no-op で終了

4. 実行ループ — Write-Ahead Log 順 (各 move)
   for each validated (slug, fromPath, toPath):
     a. mkdir -p (toPath の親)
     b. moves.jsonl に append: { ts, slug, from, to, status: "pending", attempt }   ← まずログ
     c. fsync moves.jsonl
     d. fs.rename(fromPath, toPath)                 ← atomic、ここが commit point
     e. moves.jsonl に append: { ts, slug, status: "committed", refTs: <b の ts> }   ← commit marker
     f. slug-paths.json を increment 更新
     g. rename が失敗したら: { ts, slug, status: "failed", error } を append、次回再試行
   - **クラッシュ復旧**: 起動時に moves.jsonl を末尾走査し、`pending` のままで `committed`/`failed` がペアにない slug について
     fs に from/to のどちらが存在するかで実態判定 → 正しい side で committed か failed を補追記

5. インデックス整合チェック
   - slug-paths.json の各エントリが実在ファイルを指しているか
   - 不整合があれば再スキャンで再構築 + warn ログ

6. 完了通知
   - notifier に "20 ページを再整理しました" 程度の lifecycle="fyi" 通知
   - 通知本文に主要な変更だけ要約 (全ページ列挙はしない)
```

### LLM クラスタラ

memory の `topic-cluster.ts:MemoryClusterer = (entries) => Promise<ClusterMap | null>` の wiki 版:

```ts
type WikiPageMeta = {
  slug: string;
  title: string;
  currentPath: string;       // pages/ からの相対
  tags: string[];
  outlinks: string[];        // [[slug]] で参照しているもの
  inlinks: string[];         // 自分を参照しているもの
};

type WikiClusterProposal = {
  slug: string;
  suggestedPath: string;     // pages/ からの相対 (= toPath 相当)
  reason: string;
  confidence: number;        // 0.0 - 1.0
};

type WikiClusterer = (
  pages: readonly WikiPageMeta[],
  movesHistory: readonly MoveLogEntry[],   // フラッパー検出に使う
) => Promise<readonly WikiClusterProposal[]>;
```

LLM の判断材料に **moves.jsonl の最近 N 件**を渡すのが大事。「先週 cooking/ から moved out したのを今週また cooking/ に戻そうとしないで」という制約を LLM 側で守れる。

## Memory pipeline との対応関係

| memory (`#1070`) | wiki rebalance | 流用 / 差分 |
|---|---|---|
| `topic-detect.ts` (atomic vs topic 判定) | 不要 — wiki は最初からツリー許容 | **削除** |
| `topic-cluster.ts` (LLM clusterer) | `wiki-cluster.ts` (LLM proposal generator) | **流用** (関数シェイプそのまま) |
| `topic-migrate.ts` (staging に書き出し) | 不要 — staging dir なし | **削除** |
| `topic-swap.ts` (rename で promote) | `wiki-rebalance.ts` の rename ループ | **簡素化** (バックアップなし、moves.jsonl が backup の代わり) |
| `topic-run.ts` (一回起動オーケストレータ) | `wiki-rebalance-run.ts` (定期起動) | **流用 + 改造** (one-shot → recurring) |
| `topic-io.ts` (topic ファイル R/W) | `pages/io.ts` (既存 `wiki-pages/io.ts`) | **流用** (slug-paths.json 更新を追加) |
| (なし) | `wiki-moves.ts` (moves.jsonl の append + 読み出し) | **新規** |
| (なし) | `wiki-resolve.ts` (3段フォールバックリンク解決) | **新規** |

`topic-detect` / `topic-migrate` / `topic-swap` 相当のレイヤは消える = memory より **シンプルに** なる。

## Phased rollout

1 PR で全部入れるとリスクと review 負荷が高い。3 PR に切る。

### PR-A: 階層パス対応 (rebalancer 不在でもユーザ価値あり)

**何が入る**:
- `pages/<sub>/<slug>.md` の任意深さを R/W で許可 (既存 `writeWikiPage` / `readWikiPage` の slug 解決を変更)
- `slug-paths.json` の生成・更新 (起動時 + watcher で incremental)
- `moves.jsonl` の append API (`appendMove(slug, from, to, reason, by)`)
- ユーザが手動でファイルを **mv した時** の検出 (chokidar) → moves.jsonl に `"by":"user"` で記録
- 既存の `[[link]]` 解決を 3 段フォールバックにする (= リンク解決の堅牢化)

**ユーザ視点**:
- Obsidian / Notion から階層付きでコピーしてくるとそのまま使える
- Wiki UI が「flat な dir」を前提にしていなければそのまま動く (要 UI 側監査)

**まだ無い**:
- 自動リバランス
- LLM クラスタラ

### PR-B: 手動リバランス (LLM clusterer + 提案 UI)

**何が入る**:
- `wiki-cluster.ts` (LLM clusterer)
- `manageWiki` プラグインに `kind: "rebalanceProposal"` action を追加 — proposal を返すだけで実行はしない
- Settings UI に "整理を提案させる" ボタン (任意) — 提案を見て承認すると実行

**ユーザ視点**:
- 「今ページ整理して」と言うと AI が提案 → 承認 → 整理される
- まだ自動ではない、手動キック

### PR-C: 定期自動リバランス (scheduler 統合)

**何が入る**:
- `wiki-rebalance-run.ts` (one-shot orchestrator)
- scheduler の built-in job として登録 (週 1 デフォルト、Settings で変更可)
- mtime guard / フラッパー検出
- 完了時の notifier `lifecycle="fyi"` 通知

**ユーザ視点**:
- 何もしなくても、ある朝起きたら wiki が整っている
- 通知で「20 ページを再整理しました」と分かる
- 嫌なら scheduler off

## 安全性 (リスクと緩和策)

### リスク 1: 古いチャット JSONL の絶対パス参照

**リスク**: `Read` ツールで `data/wiki/pages/foo.md` を直接読んだセッションがあとで再開された時、ファイルが移動済みだと "file not found"。

**緩和**:
- moves.jsonl で resolve できる → セッション再開時に自動で新パスにリダイレクトする hook を入れる (= chat 側のファイル参照に moves.jsonl を噛ませる)
- 現実的には絶対パス参照は LLM が選ぶ書き方ではない (`[[link]]` を選ぶ) ので影響は限定的

### リスク 2: 外部ツール (Obsidian, VS Code) で開きっぱなしのファイルを移動

**リスク**: 編集中ファイルが移動されると保存先が古いパスのままになる。

**緩和**:
- mtime guard で 24h 以内のファイルは触らない
- chokidar で外部編集を検出して frozen 期間を延長
- それでもレースする可能性はある → ドキュメントに「リバランス中は外部編集を避けて」と書く (= 完全防止ではない)

### リスク 3: フラッパー (毎週違う場所に移動される)

**リスク**: LLM の判断が安定しない slug が cooking/ ↔ recipes/ ↔ food/ を行き来する。

**緩和**:
- moves.jsonl の最近 N 件を LLM に context として渡す ("最近移動済み slug は触らないで")
- confidence threshold 0.7+
- "直近 N 週で M 回以上動いた slug は frozen" ルール

### リスク 4: 並行 rebalance (server 二重起動 / 別ホスト)

**リスク**: 2 つの server プロセスが同時に rebalance を走らせると move ループが crash する。

**緩和**:
- `data/wiki/.index/.rebalance-lock` を fcntl ロックで取る (mkdir でも可)
- ロック取れなければ skip + warn

### リスク 5: moves.jsonl が肥大化

**リスク**: 1000 page × 数年で moves.jsonl が MB オーダ。

**緩和**:
- 古いエントリ (例: 90 日超え) を `moves-archive/<YYYY>.jsonl` に rotate
- リンク解決時は **moves.jsonl + archive を併読** (= §"リンク解決の3段フォールバック" のステップ 2 がこれを織り込む)
- archive 側のエントリも committed/failed が解決済みであることが前提 — rotation 時に pending 単独行は持ち越さない (commit されてれば committed と一緒に rotate、未 commit なら現役 jsonl に残す)
- 90 日以内の slug 移動だけが "ホットな" 解決対象、それより古いものは原則 slug-paths.json でカバー
- 完全 in-memory 化したい場合は `moves-compact.json` (slug → 最新 `to`) を別途生成 (PR-A スコープ外)

### リスク 6: LLM 提案 `suggestedPath` の path-traversal

**リスク**: LLM が `../../../../etc/passwd.md` や `/tmp/escape.md` を返してきた場合、未検証の `fs.rename` で `pages/` 外にファイルが脱出し得る。symlink を経由した escape も同様。

**緩和** (リバランサ §3 の "正規化境界" として実装):

```ts
const pagesRoot = path.resolve(workspaceRoot, "data/wiki/pages");
const candidate = path.resolve(pagesRoot, suggestedPath);
// 1. pagesRoot 配下に収まっているか (../../, 絶対パス escape の防止)
if (!candidate.startsWith(pagesRoot + path.sep)) reject;
// 2. ファイル名が slug と一致 (LLM が別 slug を提案できないようにする)
if (path.basename(candidate) !== `${slug}.md`) reject;
// 3. 親ディレクトリが symlink でない (mount escape の防止)
if (lstatSync(path.dirname(candidate)).isSymbolicLink()) reject;
// 4. 深さ制限 (任意の暴発防止)
if (depth(candidate, pagesRoot) > MAX_DEPTH) reject;
```

拒否された候補は warn ログ + 該当 slug は今回 cycle で skip (次回 LLM が別案を出すかもしれない)。
これは **LLM 出力を信用しない原則** であって、フラッパー検出やフリーズなどの "意味論的フィルタ" の前段で実行される、ハードな構造的ガード。

## Open questions

1. **画像 / その他 asset の slug 化** — 本 plan ではスコープ外にしたが、いずれ `[[asset:foo]]` 形式が要る。`data/wiki/sources/` の取り扱いと合わせて別 plan。
2. **手動編集と自動移動の競合 UX** — 「ユーザが今 Obsidian で開いているファイル」を完全に検出する手段はない。割り切るか、Lock ファイル方式 (`<slug>.md.editing-by-user`) を採用するか。後者は "ゴミを残さない" 制約に違反する可能性。たぶん割り切る。
3. **チャット側の絶対パス転送 hook** — リスク 1 緩和策。実装するなら `Read` tool 側に moves.jsonl を見せる必要がある = SDK 境界をまたぐ。やらない選択肢もある (= LLM が `[[link]]` を選ぶ確率が高い前提)。
4. **Obsidian の `.obsidian/` ディレクトリ** — Vault と兼用ユーザは `.obsidian/` も `pages/` の中に置く可能性がある。スキャン除外リスト要。

## Cleanup (将来)

- 本 plan の機能が安定したら memory の `topic-detect.ts` / `topic-migrate.ts` / `topic-swap.ts` の "stage → swap" パターンを `moves.jsonl` 方式に揃え直すのもあり (memory も append-only ログ駆動に統一)
- ただし memory は LLM 自動書き込みが主流で staging review が価値を持つ可能性 — 別議論

---

## 参考実装

- `server/workspace/memory/topic-cluster.ts` — LLM clusterer のシェイプ
- `server/workspace/memory/topic-run.ts` — one-shot orchestrator (本 plan は recurring 版に変える)
- `server/workspace/wiki-pages/io.ts` — wiki page R/W の choke point (slug 解決を拡張)
- `server/workspace/wiki-pages/snapshot.ts` — 編集履歴 (`.history/`) — slug 単位なのでパス変更しても追従可
- `src/lib/wiki-page/slug.ts` — slug 規約 (kebab-case, ASCII-safe)
- `server/api/routes/scheduler.ts` — scheduler 統合先 (PR-C)
