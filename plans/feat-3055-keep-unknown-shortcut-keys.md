# feat: 共有 shortcuts.json で「知らないキー」を保持する (#3055)

## 問題

`<workspace>/config/shortcuts.json` は MulmoClaude と MulmoTerminal が共有していて、**両方の
サーバがレコードを組み立て直す**（双方の `toShortcut`）。そのため、**片方が足したフィールドは
もう片方が書いた瞬間に消える**。

MulmoTerminal 側は逆向きの事故（MC の書いた `color` を MT が消す、mulmoterminal#1993）を直したうえで、
「名前を書き足す運用そのものが同じ事故を繰り返す」と判断し、**知らないキーはそのまま持ち回す**へ
変えた（mulmoterminal#1996 → PR #1999）。こちらも対称に直さないと、MulmoTerminal が今後足す
フィールドは MulmoClaude が書いた時点で落ちる。

## 決めたこと

| 論点                   | 決定                                                        | 理由                                                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 方針                   | `toShortcut` が**認識しないキーをそのまま持ち回す**         | ファイルは、それを共有する全バージョンの和集合。MulmoTerminal のグローバル config（`serializableAppConfig`）が先例                                                                                |
| 既知フィールドとの優先 | **既知が勝つ**（検証・既定値の適用結果を最後に重ねる）      | 壊れた `title` が素通りしない                                                                                                                                                                     |
| 書き込み時のマージ     | **しない**（読んだものを持ち回すだけ）                      | 相手が消したフィールドを、こちらが「保持」の名目で復活させない                                                                                                                                    |
| プロトタイプ汚染       | `Object.fromEntries` で組み立てる                           | `__proto__` を代入するとオブジェクトが再親付けされ、そのキーが JSON から消える                                                                                                                    |
| `color` の検証         | **今までどおり `isAccentColor` で落とす**（既知キーのまま） | パレットに無い色名をファイルに溜めない（#2987）。issue の `KNOWN_SHORTCUT_KEYS` もそう定義している                                                                                                |
| 型                     | `Shortcut` は既知の形のまま。組み立てはスプレッド           | index signature を足すと、全コードでタイポが合法になる                                                                                                                                            |
| クライアント           | **`refreshShortcut` も同じ扱いにする**                      | MulmoTerminal と違い、こちらの reconcile はエントリを**キーごとに組み立て直す**（#2987）。サーバだけ直しても、index を開いて title/icon/color がドリフトした瞬間にクライアントが落として PUT する |

## 実装

- `src/types/shortcuts.ts` — `KNOWN_SHORTCUT_KEYS` と `unknownShortcutFields(raw)` を置く（サーバと
  クライアントの両方が使うので、browser-safe な型ファイルが唯一の置き場）。`Shortcut` は
  「ファイルが持ち得るものの**部分集合**」であることを契約として書く。
- `server/utils/files/shortcuts-io.ts` — `toShortcut` が、知らないキーを先にスプレッドしてから
  既知キーを重ねる。
- `src/composables/shortcutRefresh.ts` — `refreshShortcut` も同様。**index が所有するフィールド
  （title / icon / color）は今までどおり `fresh` から組み立て直す** ので、色を消したときの
  書き込みループ（#2987）は再発しない（`hasShortcutDrifted` は持ち回しキーを見ない）。

## テスト

- `test/server/utils/files/test_shortcuts-io.ts`
  - 知らないキーが normalize を通り抜け、**write → read のディスク往復で残る**。
  - 既知キーは検証結果が勝つ（壊れた `title` が素通りしない）。
  - **持ち回すが、マージはしない**（そのキーを持たない list を書いたらディスクからも消える）。
  - `__proto__` を含むファイルでプロトタイプが汚染されない。
- `test/composables/test_shortcutRefresh.ts`
  - `refreshShortcut` / `reconcileShortcuts` が知らないキーを保つ。
  - それでも **色を消したドリフトは 1 回で収束する**（#2987 の回帰）。

## やらないこと

- `color` の検証を緩めること（MulmoTerminal は任意の文字列を通すが、こちらは落とす。既存仕様）。
- 書き込み時のファイルとのマージ。
