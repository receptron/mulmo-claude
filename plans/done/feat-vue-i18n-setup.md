# vue-i18n スケルトン導入 (#559)

## Problem

CLAUDE.md に「MUST use vue-i18n for text; NEVER hardcode strings in templates (use `$t()`)」と記載があるが、実際には vue-i18n が導入されておらず、既存コンポーネントは日本語/英語の文字列をテンプレートに直書きしている。後から全文字列を `$t()` 化するのは大きな作業なので、まず **基盤だけ整える** ステップを切り出す。

## Goal

- `vue-i18n` を利用可能な状態にする
- Locale は環境変数 (`import.meta.env.VITE_LOCALE`) で切り替え（UI は作らない）
- 辞書データは **TypeScript** で持つ（JSON ではなく `*.ts` の default export）
- 既存文字列の置き換えは **別 PR** で順次対応

## Design

参考: `~/ss/ownplate/src/lib/vue-i18n.ts` の構成をミラー。

### ファイル追加

```text
src/
  lang/
    en.ts        ← default export オブジェクト、スケルトン
    ja.ts        ← 同上
  lib/
    vue-i18n.ts  ← createI18n 呼び出し、default export
```

### src/lib/vue-i18n.ts (骨子)

```ts
import { createI18n } from "vue-i18n";
import en from "../lang/en";
import ja from "../lang/ja";

const locale = import.meta.env.VITE_LOCALE ?? "en";

export default createI18n({
  legacy: false,              // Composition API (CLAUDE.md 準拠)
  locale,
  fallbackLocale: "en",
  messages: { en, ja },
});
```

### src/lang/en.ts スケルトン

```ts
const en = {
  common: {
    save: "Save",
    cancel: "Cancel",
  },
} as const;

export default en;
```

### src/main.ts

既存の `createApp(App)` の後に `app.use(i18n)` を追加。

### .env.example

`VITE_LOCALE=en` の行（コメント付き）を追加。

## Non-goals

- 既存コンポーネントの文字列抽出・置き換え（別 PR で段階的に）
- Locale 切替 UI（`<select>` 等）
- 複数言語の辞書充実（en + ja の骨組みだけ）
- `<i18n-t>` タグの使用例（追加作業時に各 PR で）

## Risk

- 既存コンポーネントで `$t()` を使っていなければ破壊的変更はゼロ
- `legacy: false` を選ぶのは CLAUDE.md の Composition API 指定に合わせるため

## Test plan

- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` clean
- `yarn test` 29/29 pass
- 手動: `VITE_LOCALE=ja yarn dev` で起動できること（実際に `$t()` を使う場所がまだ無いので視覚確認は次 PR 以降）
