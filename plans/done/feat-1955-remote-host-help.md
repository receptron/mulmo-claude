# feat(#1955): remote-host popover に UI ヘルプ説明を追加

## Summary

`RemoteHostControl.vue` のポップオーバーに、機能の一行説明 + モバイル手順
+ custom remote view のヒントを、静的テキストで追加する。ログイン前と
ログイン後の両方で見える形にする。

## Items to Confirm / Review

- **`.md` 同梱なし** — `packages/core/assets/helps/remote-host.md` は作らない。
  Remote host は mulmoclaude 側だけの機能で MulmoTerminal は使わない上、
  今回のヘルプは UI 表示のみで LLM に読ませない前提だから、core を bump
  する必要が無い。判断根拠は #1955 の議論。
- **LLM 連携ボタンなし** — 「Claude に聞く」ボタンは今回は付けない。
  ユーザーの明示的な指示 (「このヘルプはなしで、単純にUIに説明だけ入れよう」)。
- **常時表示** — 折り畳み / トグル UI は付けない。ポップオーバーはもともと
  クリック開閉なので、開いたら常に説明が読める形にする。
- **モバイル URL のリンク化** — `https://mulmoserver.web.app` を
  `<a target="_blank" rel="noopener noreferrer">` でリンク化 (青 + hover
  アンダーライン)。当初はデスクトップからは意味が薄いので plain text の
  方針だったが、実装レビュー中のユーザー要望でリンクに変更。将来的に
  QR コード化する余地は残す。

## User Prompt

> リモートホスト機能の説明を、ログイン前後のところにヘルプ、もしくは
> クリックするとllmに機能について聞けるなど、簡単でわかりやすくしてほしい。
> このヘルプはなしで、単純にUIに説明だけ入れよう。

## Implementation

### UI (`src/components/RemoteHostControl.vue`)

現在のポップオーバー構造 (ステータス + UID + Connect/Disconnect) の
**下** に info ブロックを追加:

```
● Online / ○ Offline
UID: xxx
(Connect | Disconnect)
(error)
─────────────
[説明]
[モバイル手順 (URL入り)]
[custom remote view ヒント]
```

- コンテナは `mt-3 pt-2 border-t border-gray-100 text-[11px] text-gray-600`
  くらいで区切り、ステータス操作エリアと視覚的に分離。
- URL は `font-mono` で表示。
- 「custom remote view」は他の文脈と区別しやすいよう code タグで囲む。

### i18n (`src/lang/*.ts`) — 8 ロケール lockstep

`remoteHost` ブロックに 3 キー追加:

- `description`: 一行の概要 (1 文)
- `howTo`: モバイル手順、`{url}` プレースホルダー
- `customViewHint`: custom remote view の依頼方法 (1 文)

## Test plan

- `yarn format` / `yarn lint` (0 errors) / `yarn typecheck` / `yarn build`
- 手動: ログイン前 / ログイン後 の両状態で、ja / en それぞれポップオーバーを
  開き、説明が読めることを確認

## Out of scope

- モバイル URL の QR コード化
- ローカライズ済みの `mulmoserver.web.app` (今後リージョン別ホストが増えたら要検討)
- Onboarding フロー (初回起動時に自動でポップオーバーを開くなど)
