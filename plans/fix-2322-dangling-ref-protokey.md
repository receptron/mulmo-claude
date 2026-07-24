# fix #2322 — dangling ref/embed の「null にフォールバック」契約が proto キーで破れる

## 症状 (issue #2322)

コレクションの `ref` / `embed` フィールドの参照解決で、参照先レコード id が
prototype キー (`"constructor"` / `"__proto__"` / `"toString"` など) の場合、
素のオブジェクトへの bare index (`byId[targetId]` / `refRecords[to]?.[slug]`) が
`Object.prototype` の継承メンバ (例: `Object` 関数) を返す。

その結果、本来「dangling ref → `null` (UI では em-dash)」というフェイルソフト
契約が破れ、`enriched[key]` に **関数** が入る。API レスポンスの
`JSON.stringify` でそのキーごと消え、クライアントには「フィールドが存在しない」
ように見える。

`targetId` / `slug` の出所はレコードの `ref` / `embed` フィールド値
(LLM・ユーザー・フィード由来のスラグ) で、**外部入力**。

## 対象サイト (今回修正)

- `packages/core/src/collection/core/deriveAll.ts` `resolveRowRefs`
  — `refRecords[field.to]?.[slug] ?? null`
- `packages/core/src/collection/server/derive.ts` `projectComputed` の embed 分岐
  — `(targetId && linked[field.to]?.byId[targetId]) || null`

## スコープ外 (兄弟 PR で修正済み)

- **#2443** — `where.ts` の `resolveValue` (`valueFrom` の `recordsById[...]`) と
  `schemaRules.ts` のフィールドポインタを `ownProp` でガード済み。別サイト。
- **#2438** — `backlinks.ts` / `draft.ts` / `discovery.ts` / `manageTool.ts` /
  `pathResolver.ts` / `mcp-server.ts` / `resolveActiveTools.ts` /
  `sandboxMounts.ts` / `wikiEmbedHandlers.ts` / `template.ts` をガード済み。

いずれも今回の 2 サイトには触れていない (git 確認済み)。

## 修正方針

#2443 が確立したガードスタイル
(`Object.hasOwn(obj, key) ? obj[key] : undefined`) を踏襲する。

DRY のため、共有の純粋ヘルパを 1 つ新設して両サイトから使う
(where.ts のは private のため参照不可 / 触れない):

- `packages/core/src/collection/core/ownProp.ts` — `ownProp<T>(obj, key)` を export。
- `deriveAll.ts` / `derive.ts` は相対 import で利用。
- 2 段 (外側 `to` / 内側 `slug`|`targetId`) ともガードして完全に正しくする。

## テスト

- `packages/core/test/collection/test_ownProp.ts` — `ownProp` 単体
  (`constructor` / `__proto__` / `toString` / `hasOwnProperty` → undefined、
  実在 own キー `constructor` → 値、通常キー、空オブジェクト)。
- `test/utils/collections/test_deriveAll.ts` — `resolveRowRefs` に
  proto キー slug の回帰テスト (dangling → `null`)、境界: 実在レコード id
  `"constructor"` は解決する。
- `test/workspace/collections/test_derive.ts` — `enrichItems` の embed 経路で
  idField 値が `"constructor"` の dangling embed → `null` (統合)。

ルート test は `@mulmoclaude/core/collection` (dist 解決) で import するため、
ガード反転による red 確認前に `@mulmoclaude/core` を再ビルドする。

## 検証

`yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` / 該当 collection テスト。
パッケージ version bump なし。
