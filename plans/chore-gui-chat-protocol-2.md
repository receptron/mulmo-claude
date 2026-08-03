# chore: gui-chat-protocol 2.0.0 へ移行する

## Request

`gui-chat-protocol` が **2.0.0**（破壊的）として公開され、依存プラグイン6本も 2.0.0 に揃った。
上げて、壊れたところを直す。

## 何が壊れるのか

release note の一文がすべて:

> **a type parameter that appears only in the return position is a type assertion with nicer syntax.**

`dispatch<Bookmark[]>(args)` と `(await dispatch(args)) as Bookmark[]` は同じもので、後者だけが
レビュアーに見える。2.0.0 は4つの API から「呼び出し側が戻り値の型を名乗る」形を外した:

| | before | after |
|---|---|---|
| `dispatch` | `dispatch<T>(args)` | `dispatch(args)` → `unknown` / `dispatch(args, parse)` |
| `subscribe` | `subscribe<T>(name, handler)` | `subscribe(name, handler)` は `unknown` / `subscribe(name, { parse }, handler)` |
| `getConfig` | `getConfig<T>(key)` | `getConfig(key)` → `unknown` / `getConfig(key, parse)` |
| `publish` | `publish<T>(name, payload)` | `publish(name, payload)` — `payload: unknown` |

`dispatch` は overload なので、**型引数を書いていた箇所は2引数版に解決されて `Expected 2 arguments`
になる** ── これが今回の主なエラー。

`ToolContextApp` の index signature も `any` → `unknown`。

## 実測した影響範囲

依存を上げて `yarn build:packages` を回した結果（**推測ではなくコンパイラの出力**）:

| パッケージ | エラー数 |
|---|---|
| `@mulmoclaude/spotify-plugin` | 38 |
| `@mulmoclaude/debug-plugin` | 17 |
| `@mulmoclaude/recipe-book-plugin` | 12 |
| `@mulmoclaude/html-plugin` | 6 |
| `@mulmoclaude/bookmarks-plugin` | 4 |
| **合計** | **77** |

release note が挙げる「壊れる4パターン」のうち、**型引数を明示していた形（パターン1）が大半**。
残り3つ（handler の引数注釈 / 代入先の型 / `getConfig` の代入先）は grep では見つからず、
コンパイラの出力で拾う。

## 方針 — 「reader を渡す」に素直に従う

型引数を消すだけ（`dispatch(args)` にして `unknown` を受ける）と、呼び出し側が全部
`unknown` の操作になり、結局その場でキャストしたくなる ── **2.0.0 が塞いだ穴を別の場所に開け直す**
ことになるので、しない。

**reader を渡す。** 対象プラグインには **zod が既に入っている**ので、release note の推奨イディオムが
そのまま使える:

```ts
const list = await dispatch({ kind: "list" }, (raw) => Bookmarks.parse(raw));
```

ただし **throw する parse は drop になる**（release note の設計判断）ため、`subscribe` の
`parse` を書く場合は `safeParse(raw).data ?? null` を使う ── 1フレームの不正でチャンネル全体を
落とさないため。`dispatch` は throw して呼び出し側の try/catch に載せてよい。

### スキーマをどこに置くか

各プラグインの dispatch は**そのプラグインのサーバ側と1対1**なので、レスポンス型は
そのプラグイン内に置く。既存の型定義（`contract.ts` 等）があればそこへ、無ければ View の隣に
最小のスキーマを足す。**共有パッケージには上げない** ── 契約はプラグインごとに閉じているため。

## ホスト側の実装

release note:

> Every host implementing `BrowserPluginRuntime` / `PluginRuntime` / `ToolContextApp` must change too.

`src/utils/plugin/runtime.ts` が `BrowserPluginRuntime` を組み立てている（`makeDispatch` /
`makeScopedPubSub` 等）。overload を満たすように直す。コンパイラが落ちなければ既に満たしている
可能性もあるので、**エラーが出た箇所だけ**触る。

## スコープ外

- `useRuntime<E>()` / `pickMessages<M>()` ── 同じ族だが 2.0.0 では**変更されていない**
  （protocol 側 #31 で追跡中）
- `@mulmochat-plugin/ui-image` は 0.4.1 のままで 2.0.0 が無い。上げない

## テスト

型エラーが消えることが第一の検証。加えて:

- reader を入れた各 dispatch について、**不正なレスポンスが型どおり弾かれる**ことを確認できる
  ユニットテストを、既存テストがあるプラグインには足す
- 既存のテストが全て通ること（回帰）
