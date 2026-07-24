# fix #2388 — text 関数の複数のエッジ

`src/plugins/spreadsheet/engine/functions/text.ts` の複数関数が境界入力で Excel と異なる値を静かに返す。

## 対応マトリクス

| サブケース              | 症状（この実装）                                | 根本原因                                   | 修正                                                                  | テスト                                 |
| ----------------------- | ----------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------- |
| SUBSTITUTE 空 old_text  | `SUBSTITUTE("abc","","-")` → `"a-b-c"`          | `"".split("")` が全文字間に挿入            | `substituteText`: `oldText === ""` なら text をそのまま返す           | `substituteText — empty old_text`      |
| SUBSTITUTE instance ≤ 0 | `SUBSTITUTE("aa","a","b",0)` → `"aa"`（無変更） | `count === instance` が 0 に一致せず素通り | `Math.trunc(instance)` が非有限 or ≤ 0 なら `#VALUE!`                 | `substituteText — instance validation` |
| RIGHT / LEFT 負値       | `RIGHT("Hello",-1)` → `""`                      | `substring` が負値を静かに空文字化         | `takeLeft` / `takeRight`: count < 0 で `#VALUE!`                      | `takeRight` / `takeLeft` describe      |
| PROPER 句読点境界       | `PROPER("o'neil-jr")` → `"O'neil-jr"`           | 空白のみで単語分割                         | `toProperCase`: 先頭 or 非文字（`\p{L}`）の次を大文字化、他は小文字化 | `toProperCase — word boundaries`       |

## 純粋関数として切り出したもの（text.ts に export）

- `substituteText(text, oldText, newText, instance?)`
- `takeLeft(text, count)` / `takeRight(text, count)`
- `toProperCase(text)`
- 内部: `replaceNthOccurrence`（split/join で非重複マッチ）、`isLetter`（`\p{L}` Unicode 対応）

エラーは既存慣習に合わせて Excel エラー文字列（`"#VALUE!"`）を返す。

## 各サブ修正の RED 確認

各サブ修正を一時的に外し、対応テストが RED になることを確認済み（SUBSTITUTE 空 / instance / RIGHT 負値 / PROPER 境界）。復元後 29 件全通過。

## 見送り（follow-up）

- **TEXT の formatter 委譲**: `TEXT(5,"$0")` `TEXT(1234.5,"$#,##0.00")` は `formatNumber` に委譲すれば正しくなる（`"$5"` `"$1,234.50"`）。だが `TEXT(0.5,"0%")` は `formatNumber` でも `"50.00%"` になり Excel の `"50%"` にならない（`%` ブランチが小数点なし書式で既定 2 桁）。完全修正には共有の `formatNumber` のパーセント既定桁数を変える必要があり、これは `calculator.ts` のセル表示にも使われる共有関数のため e2e / 表示差分リスクがある。issue も「PR を分けてよい」としているため、TEXT は別 PR（formatter.ts 改修 + 回帰テスト付き）に送る。
- **SEARCH ワイルドカード** (`SEARCH("a?c","abc")`): 本 issue のスコープ外。未対応。
