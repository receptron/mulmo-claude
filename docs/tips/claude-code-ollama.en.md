# Claude Code × Ollama Setup Findings (verified 2026-04-25)

Findings from running Claude Code against a local Ollama instance on a MacBook Air M4 32GB.

## Test environment

- Machine: MacBook Air M4 32GB (unified memory)
- Ollama: v0.21.1 (server and client both need v0.14.0+)
- Claude Code: v2.1.119

## The context-window wall

On every turn Claude Code sends a prompt of about **50,000–57,000 tokens** (system prompt + CLAUDE.md + tool definitions + skill list). A context window of **at least 64k tokens is required**.

### `OLLAMA_CONTEXT_LENGTH` behavior

Default is 32768 (32k). Extend it with:

```bash
OLLAMA_CONTEXT_LENGTH=65536 ollama serve
```

But **whether this is honored depends on the Ollama runner**:

| Runner | Honors `OLLAMA_CONTEXT_LENGTH` | Models |
|--------|:---:|------|
| `--ollama-engine` (new engine) | ✓ | `qwen3`, `qwen3.5`, `gpt-oss`, etc. |
| llama.cpp-based (older runner) | ✗ | Some models like `qwen2.5`, `qwen2.5-coder` |

How to tell from logs:
- `source=server.go ... starting runner cmd="... --ollama-engine ..."` → new engine (env var works)
- `source=runner.go:153 msg="truncating input prompt"` → llama.cpp runner (env var ignored)

### `PARAMETER num_ctx` in a Modelfile may not work either

We confirmed cases where setting `num_ctx 65536` in a Modelfile is also ignored when the model uses the older runner.

### Model training-time limit

Specifying a context larger than the model's `n_ctx_train` is clamped to the training value with a warning:

```text
msg="requested context size too large for model" num_ctx=65536 n_ctx_train=40960
```

Example: `qwen3:14b` is trained with a 40960 (40k) limit, so it cannot fit Claude Code's 57k prompt.

## Per-model results

| Model | Size | Result | Notes |
|-------|----:|:---:|------|
| `qwen3:14b` | 9GB | ✗ | Training limit 40k, 50k prompt is truncated |
| `qwen2.5-coder:14b` | 9GB | ✗ | Old runner, 64k setting ignored, stuck at 32k |
| `qwen3.6:35b-a3b` | 23GB | ✓ | MoE (3B active), first turn 13 min, Japanese thinking OK |
| `gemma4:e4b` | 3GB (actual weights ~8.9 GiB) | ✓ | Confirmed working on re-test. Earlier failure likely due to missing `OLLAMA_CONTEXT_LENGTH=65536`. Responds with thinking blocks |
| `gemma4:26b` | 17GB | ✗ | `API Error: Content block not found` (re-verified — thinking block format is incompatible with Claude Code) |
| `gpt-oss:20b` | 13GB | ✗ | Bug in Ollama's prompt template, 500 error parsing tool definitions |
| **`qwen3.5:9b`** | **6.6GB** | **✓** | **First turn 10+ min (after timeout, cache reuse succeeds in ~3 min); lightest practical option** |

### Why `qwen3.5:9b` works

- Uses the new `--ollama-engine`
- 256k context window (well above Claude Code's 64k requirement)
- `OLLAMA_CONTEXT_LENGTH=65536` is honored

### `gpt-oss:20b` 500 error details

```text
chat prompt error: template: :108:130: executing "" at <index $prop.Type 0>:
  error calling index: reflect: slice index out of range
```

Ollama's prompt template cannot parse the tool definitions Claude Code sends. Whether the bug is on the model side or Ollama's side is not determined.

## Error categories and recoverability

| Error | Nature | User-recoverable? |
|-------|--------|:---:|
| `truncating input prompt` | Insufficient context | ✓ (extend `OLLAMA_CONTEXT_LENGTH`, choose a supporting model) |
| `API Error: Content block not found` | Model's response structure incompatible with Claude Code | ✗ (model/Ollama implementation issue) |
| `template: ... slice index out of range` | Bug in Ollama's prompt template | ✗ (Ollama implementation issue) |

Only the first category is solved by waiting. The other two will keep failing — the only fix is to avoid that model.

## Performance measurements

With `OLLAMA_CONTEXT_LENGTH=65536` on MacBook Air M4:

### `qwen3.5:9b` (6.6GB)

| Request | Work done | Time |
|---------|-----------|------|
| 1st (cold) | Process all 57k tokens | **Over 10 min — Claude Code's 10-minute timeout fires** |
| 2nd (cache warm) | KV cache reuses common prefix, only diff is processed | **3 min 5 sec, success** |
| 3rd+ | Same | 1–3 min |

### `qwen3.6:35b-a3b` (23GB, MoE, 3B active)

| Request | Work done | Time |
|---------|-----------|------|
| 1st (cold) | Process all 57k tokens, respond with thinking | **About 13 min** |
| 2nd (cache warm) | Diff-only processing | **About 3 min 55 sec** |

Even though active compute is 3B-equivalent, the first-turn prompt-processing cost is similar. Subsequent turns settle to roughly the same time as `qwen3.5:9b`.

### How the KV cache helps

Claude Code sends the same system prompt + CLAUDE.md + tool definitions on every request. Ollama keeps these in the KV cache, and from the second turn onward only the diff (the new user message) needs processing.

Even when the first turn times out, Ollama keeps processing in the background, so by the time the second request arrives the cache is already warm.

### Extending cache TTL

Default is 5 minutes idle, then the KV cache is dropped (`OLLAMA_KEEP_ALIVE:5m0s`). For longer sessions:

```bash
OLLAMA_CONTEXT_LENGTH=65536 OLLAMA_KEEP_ALIVE=30m ollama serve
```

## Practical takeaways

- **What works**: `qwen3.5:9b`, ~1–3 min responses after the cache is warm
- **What doesn't**: Complex agent flows, tool chaining, scenarios that frequently rebuild context
- **High first-turn cost**: A cold first turn takes over 10 minutes
- **Use cases**: "Works offline," "avoid metered cost spikes," and similar fallback scenarios

## Memory footprint (qwen3.5:9b)

- Model weights: 5.6 GiB (Metal)
- KV cache (64k): 3.2 GiB
- Compute graph: 1.1 GiB
- **Total: 10.5 GiB**

Comfortable on a 32GB machine. Even with 15GB used by OS + other apps there is no swap.

## Three-terminal workflow

You need three terminal windows in parallel:

- **Terminal A**: `OLLAMA_CONTEXT_LENGTH=65536 ollama serve` (keep open)
- **Terminal B**: `ollama run <model> "hello"` (one-shot warm-up; can be closed)
- **Terminal C**: `claude --verbose --model <model>` (your actual session)

### Switching between cloud and local

If you set the env vars only in Terminal C, closing the terminal restores cloud mode. To make this permanent, prefer an alias rather than `export` in `.zshrc`:

```bash
alias claude-local='ANTHROPIC_AUTH_TOKEN="ollama" ANTHROPIC_API_KEY="" ANTHROPIC_BASE_URL="http://localhost:11434" claude'
```

## Ollama log location

Homebrew-managed: `/opt/homebrew/var/log/ollama.log`
Manually-launched `ollama serve`: streamed to the launching terminal directly.

What to watch for in the logs:
- `truncating input prompt limit=XXXXX` → context too small
- `KvSize:XXXXX` → context size actually loaded
- `POST /v1/messages` HTTP status (200 = success, 500 = template/parse error)
