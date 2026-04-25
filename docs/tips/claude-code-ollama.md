# Claude Code × Ollama セットアップ知見（2026-04-25 検証）

MacBook Air M4 32GB での Claude Code + Ollama 動作検証で得られた知見。

## 動作環境

- マシン: MacBook Air M4 32GB（統合メモリ）
- Ollama: v0.21.1（サーバ・クライアントとも v0.14.0 以上が必要）
- Claude Code: v2.1.119

## コンテキスト要件の壁

Claude Code は起動時に約 **50,000〜57,000 トークン**のプロンプトを毎回送信する（システムプロンプト + CLAUDE.md + ツール定義 + スキル一覧）。このため **64k 以上のコンテキストウィンドウが必須**。

### OLLAMA_CONTEXT_LENGTH の挙動

デフォルトは 32768（32k）。以下のように拡張する:

```bash
OLLAMA_CONTEXT_LENGTH=65536 ollama serve
```

ただし **Ollama の Runner によって適用の可否が異なる**:

| Runner | OLLAMA_CONTEXT_LENGTH 適用 | 該当モデル |
|--------|:---:|------|
| `--ollama-engine`（新エンジン） | ◯ | `qwen3`, `qwen3.5`, `gpt-oss` など |
| llama.cpp 系（古いランナー） | ✗ | `qwen2.5`, `qwen2.5-coder` 等一部モデル |

ログで見分ける:
- `source=server.go ... starting runner cmd="... --ollama-engine ..."` → 新エンジン（env 有効）
- `source=runner.go:153 msg="truncating input prompt"` → llama.cpp 系（env 無視される）

### Modelfile の `PARAMETER num_ctx` も効かないことがある

Modelfile で明示的に `num_ctx 65536` を指定しても、Ollama の Runner が古い場合は適用されないケースを確認した。

### モデル訓練時の上限

モデル自体の `n_ctx_train` を超えた指定はログで警告が出て訓練値に丸められる:

```text
msg="requested context size too large for model" num_ctx=65536 n_ctx_train=40960
```

例: `qwen3:14b` は 40960（40k）が訓練上限なので Claude Code の 57k プロンプトを受けられない。

## モデル別検証結果

| モデル | サイズ | 結果 | 備考 |
|--------|-------:|:---:|------|
| `qwen3:14b` | 9GB | ✗ | 訓練上限 40k、50k プロンプトが切り詰められる |
| `qwen2.5-coder:14b` | 9GB | ✗ | 古い runner、64k 指定が反映されず 32k 固定 |
| `qwen3.6:35b-a3b` | 23GB | ◯ | MoE（アクティブ 3B）、初回 13 分で応答・日本語 thinking OK |
| `gemma4:e4b` | 3GB（実 weights 約 8.9 GiB） | ◯ | 再検証で動作確認。前回失敗は `OLLAMA_CONTEXT_LENGTH=65536` 未設定が原因と推測。thinking 付きで応答 |
| `gemma4:26b` | 17GB | ✗ | `API Error: Content block not found`（再検証でも同じ。thinking ブロックの形式が Claude Code と非互換） |
| `gpt-oss:20b` | 13GB | ✗ | Ollama のテンプレートにバグ、ツール定義パース失敗で 500 エラー |
| **`qwen3.5:9b`** | **6.6GB** | **◯** | **初回 10 分超（タイムアウト後 cache 再利用で 3 分強で成功）、軽量で最も実用的** |

### qwen3.5:9b が動く条件

- 新 `--ollama-engine` 対応
- 256k コンテキストウィンドウ（Claude Code の 64k 要求を余裕で満たす）
- `OLLAMA_CONTEXT_LENGTH=65536` が適用される

### gpt-oss:20b の 500 エラー詳細

```text
chat prompt error: template: :108:130: executing "" at <index $prop.Type 0>:
  error calling index: reflect: slice index out of range
```

Ollama 側のプロンプトテンプレートが Claude Code の送るツール定義をパースできない。モデル側・Ollama 側どちらのバグかは未確認。

## エラー種別と対処可否

| エラー | 性質 | ユーザー側で対処可能か |
|-------|------|:---:|
| `truncating input prompt` | コンテキスト不足 | ◯（`OLLAMA_CONTEXT_LENGTH` 拡張、対応モデル選択） |
| `API Error: Content block not found` | モデルの応答構造が Claude Code と非互換 | ✗（モデル/Ollama 実装の問題） |
| `template: ... slice index out of range` | Ollama のプロンプトテンプレート側のバグ | ✗（Ollama 実装の問題） |

「待てば解決する」のは最初のパターンのみ。後者 2 つは待っても失敗し続けるため、該当モデルは避けるしかない。

## パフォーマンス実測

OLLAMA_CONTEXT_LENGTH=65536 + MacBook Air M4 での実測:

### `qwen3.5:9b`（6.6GB）

| リクエスト | 処理内容 | 所要時間 |
|-----------|---------|---------|
| 1 回目（コールド） | 57k トークン全部を処理 | **10 分超でタイムアウト**（Claude Code の 10 分制限）|
| 2 回目（cache 温まった後） | KV cache で共通部分は再利用、差分のみ処理 | **3 分 5 秒で成功** |
| 3 回目以降 | 同上 | 1〜3 分 |

### `qwen3.6:35b-a3b`（23GB、MoE アクティブ 3B）

| リクエスト | 処理内容 | 所要時間 |
|-----------|---------|---------|
| 1 回目（コールド） | 57k トークン全部を処理、thinking 付きで応答 | **約 13 分** |
| 2 回目（cache 温まった後） | 差分のみ処理 | **約 3 分 55 秒** |

MoE なのでアクティブ計算量は 3B 相当だが、コールドスタート時のプロンプト処理に時間がかかる傾向は同じ。2 回目以降は qwen3.5:9b と同等の応答時間に落ち着く。

### KV キャッシュの効き方

Claude Code は毎リクエストで同じシステムプロンプト + CLAUDE.md + ツール定義を送る。Ollama はこれを KV cache として保持し、次回以降は差分（新しいユーザーメッセージ）のみ処理する。

1 回目のタイムアウト後も、Ollama は裏で処理を継続するため、2 回目のリクエスト時にはキャッシュが温まっている状態になる。

### キャッシュ保持時間の延長

デフォルトは 5 分無操作で KV cache が消える（`OLLAMA_KEEP_ALIVE:5m0s`）。長時間使うなら:

```bash
OLLAMA_CONTEXT_LENGTH=65536 OLLAMA_KEEP_ALIVE=30m ollama serve
```

## 実用性の結論

- **使える組み合わせ**: `qwen3.5:9b`、2 回目以降は 1〜3 分で応答
- **使えない**: 複雑なエージェント動作、ツール連鎖、頻繁にコンテキストを作り直す用途
- **初回コストが大きい**: コールド状態での最初の 1 ターンが 10 分超
- **割り切り**: 「オフラインでも動く」「課金が気になる場面で」等の緊急用途向け

## メモリ使用量（qwen3.5:9b）

- モデル weights: 5.6 GiB (Metal)
- KV cache (64k): 3.2 GiB
- compute graph: 1.1 GiB
- **合計: 10.5 GiB**

32GB 機なら余裕。OS + 他アプリで 15GB 使っても swap なしで動く。

## 3 ターミナル運用

同時に 3 つのターミナルが必要:

- **ターミナル A**: `OLLAMA_CONTEXT_LENGTH=65536 ollama serve`（開きっぱなし）
- **ターミナル B**: `ollama run <model> "hello"`（初回モデルロード用、閉じて OK）
- **ターミナル C**: `claude --verbose --model <model>`（本体）

### クラウド/ローカル切り替え

ターミナル C 内で環境変数を設定する形なら、ターミナルを閉じればクラウドに戻る。`.zshrc` に永続化する場合はエイリアス化が安全:

```bash
alias claude-local='ANTHROPIC_AUTH_TOKEN="ollama" ANTHROPIC_API_KEY="" ANTHROPIC_BASE_URL="http://localhost:11434" claude'
```

## Ollama ログ場所

Homebrew 起動時: `/opt/homebrew/var/log/ollama.log`
手動 `ollama serve` 時: 起動ターミナルに直接出力

ログで確認すべきポイント:
- `truncating input prompt limit=XXXXX` → コンテキスト不足
- `KvSize:XXXXX` → 実際にロードされたコンテキストサイズ
- `POST /v1/messages` の HTTP ステータス（200 なら成功、500 ならテンプレート/パースエラー）
