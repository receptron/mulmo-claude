# feat: chat-index summarizer を sonnet 化 + 入力窓を拡大

## 背景

セッションが増えるとチャットを探すのに迷子になる（umbrella #1883）。タイトル付与（#1880）を検討する中で、**タイトルは既に自動生成されている**ことが分かった：`server/workspace/chat-index/` の summarizer が毎ターン後（15分スロットル）+ 1h backfill で `claude` を回し `{title, summary, keywords}` を生成し、サイドバーの `preview` に表示している。

つまり要望「手動は大変→自動でサマリータイトル」は仕組みとしては動いている。残る問題は **タイトル/サマリーの品質** で、原因は2つ：

1. **モデルが haiku**（事後要約の弱モデル）→ 内容の頭打ち。
2. **入力窓が狭い**（`MAX_INPUT_CHARS = 8000`、先頭3000 + 末尾5000）→ 長い・話題が変遷したセッションの **中盤が要約に入らない**。各メッセージも500字で切り詰め。

短いセッション（少ターン）はターン数のゲートが無いので問題なく要約される（テキストが1つでもあれば対象。skip は「実行中」「テキスト皆無」のみ）。

## 変更（すべて `server/workspace/chat-index/summarizer.ts`）

| 定数 | 旧 | 新 | 理由 |
|---|---|---|---|
| model | `haiku` | `sonnet`（新 `SUMMARY_MODEL`） | 内容品質 |
| `MAX_BUDGET_USD` | `0.15` | `0.40` | sonnet 単価＋初回キャッシュ生成。低すぎると budget 超過で**要約が付かない** |
| `MAX_INPUT_CHARS` | `8000` | `30000` | 長セッションの中盤を拾う |
| `HEAD_CHARS` | `3000` | `12000` | 窓拡大に追従 |
| `TAIL_CHARS` | `5000` | `16000` | 同上（head+tail=28000 < 30000 を維持し truncate が必ず縮む） |
| `PER_MESSAGE_MAX` | `500` | `1500` | 長い発言の過剰な切り詰めを緩和 |

- 4つの窓定数を `export` し、`test/chat-index/test_summarizer.ts` がそこから fixture を導出するよう変更（定数変更でテストが腐らない）。
- コストは sonnet で1セッションあたり概ね $0.03〜0.13、100件 backfill でも数ドル程度。

## 効果

- 短い → これまで通り確実に付く。
- 長い → 中盤も要約に入る。
- 内容 → sonnet で底上げ。

## テスト

- `test/chat-index/test_summarizer.ts`：`truncateMiddle` / per-message クリップを export 定数ベースに更新。`extractText` / `parseClaudeJsonResult` / `validateSummaryResult` / `formatSpawnError` は不変。
- summarizer はモデル名以外の spawn 経路を変えていないので既存の DI フェイク（`IndexerDeps.summarize`）テストはそのまま通る。

## 将来（別 issue）

- #1880：agent 主導タイトル（`updateSessionTitle` MCP ツール）。本変更で summarizer 品質が上がれば不要かもしれず、必要なら **置き換えではなく override**（`meta.agentTitle ?? indexEntry.title ?? firstUserMessage` の precedence、indexer は放置）。理由：agent 主導単独は「ツールを呼ぶ確実性」と「話題 pivot 後の追従性」を失うため、haiku/sonnet ベースラインを安全網に残す。
- #1881：単発/長期フィルタ（user query count を meta に記録 + 24h 時間フィルタ）。

## 関連

umbrella #1883 / #1880 / #1881
