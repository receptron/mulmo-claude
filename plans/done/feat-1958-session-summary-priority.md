# feat(#1958): セッション履歴で要約を優先表示、全文はホバーで

## Summary

`SessionHistoryPanel.vue` のセッション行の 2 行表示 (preview + summary)
を 1 本に統合し、要約があれば要約を、なければ preview をフォールバック
表示する。要約は最大 2 行 (`line-clamp-2`) まで見せ、全文はホバー
(native `title`) で読める。

## Items to Confirm / Review

- **要約が truncate される場合の UX** — `line-clamp-2` + native `title`
  で全文を出す。カスタムツールチップは付けない (シンプル、キーボード
  フォーカスでも動く、追加依存なし)。デフォルトのブラウザツールチップ
  の見た目は簡素だが機能は満たす。
- **削除確認は preview のまま** — `session.preview` は「ユーザーが
  自分でタイプした最初の一言」で、AI 要約より「どのセッションを
  消すか」の判断に確実。要約は誤っていたり古かったりする可能性が
  あるので、削除の同意には preview を残す。
- **`aria-label` は要約優先** — スクリーンリーダーには要約の方が
  中身が伝わりやすい。要約が存在する行では preview は隠れる形になる
  (`title` と `aria-label` の重複読み上げは SR ごとに挙動が違うが、
  ほとんどのケースで `aria-label` が勝つ)。
- **行アイコン整列の変更** — 2 行のときアイコンが縦中央にくると
  最初の行と揃わなくて違和感が出るので、`items-center` → `items-start`
  + `mt-0.5` で最初の行にアイコンを合わせる。1 行のときは見た目が
  ほぼ同じ。

## User Prompt

> サイドメニューの改善で要約を作っている。いま、ようやくと最初のテキストの
> ２つがでているけど、要約がある場合にはできる限りようやくを表示させたほうが
> 便利じゃないかな？最初のテキストは消したうえで。あとマウスをおくとホバーして
> 要約を全体みたい。

## Implementation

`src/components/SessionHistoryPanel.vue` のセッション行 (template 部分):

- 行 `<div>` に `:title="session.summary || session.preview || t(...)"`
  を追加 (ホバー / フォーカスでネイティブツールチップ、全文表示)。
- `:aria-label` を要約優先に (`session.summary || session.preview || ...`)。
- 内部レイアウト:
  - `<div class="flex items-center">` → `<div class="flex items-start">`
  - `SessionRoleIcon` に `flex-shrink-0 mt-0.5` を追加 (最初の行と揃える)
  - 要約 / preview 用 `<p>` は 1 本に統合:
    - 内容 `session.summary || session.preview || noMessages`
    - `:class="[previewClasses(session), session.summary ? 'line-clamp-2' : 'truncate']"`
  - 実行中インジケータの `<span>` にも `mt-0.5`
- 旧 2 行目 (`<p v-if="session.summary" ... mt-0.5>`) は削除。

Tailwind 4 なので `line-clamp-2` は built-in、追加設定不要。

## Test plan

- `yarn format` / `yarn lint` (0 errors) / `yarn typecheck` / `yarn build`
- 手動:
  - 要約ありセッション: 主行が要約 (最大 2 行、超えたら `…` で切れる)、
    preview 2 行目は消えている。ホバーで要約全文がツールチップ表示。
  - 要約なしセッション: 主行が preview の 1 行 truncate。
  - 要約なし + preview なし (新規空セッション): `noMessages` プレース
    ホルダーが 1 行表示。
  - キーボードフォーカスでも `title` が発火するか (ブラウザ依存)。

## Out of scope

- カスタムツールチップコンポーネント / floating-ui 導入
- 要約の 3 行以上への拡張 (2 行 UI で十分読める設計、行高が伸びると
  スクロールが増える)
- 削除確認の要約表示 (根拠は上記)
