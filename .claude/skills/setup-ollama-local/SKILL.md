---
name: setup-ollama-local
description: Interactively guide setup for connecting the Claude Code CLI to a local Ollama LLM on Mac. NOTE — This is for the standalone Claude Code CLI itself, NOT MulmoClaude (MulmoClaude does not currently support Ollama as a backend). Covers Ollama install, model pull, env switching, and verification. Respond in the user's language.
allowed-tools: Read, Bash, Glob, Grep
---

# Setup Claude Code × Ollama (local LLM)

> **Scope / 適用範囲**
>
> This skill sets up the **standalone `claude` CLI** to talk to a local Ollama server. It is **independent of MulmoClaude**; MulmoClaude itself does not currently support Ollama (see `plans/feat-mulmoclaude-ollama-support.md` for a tentative plan).
>
> このスキルは **`claude` CLI 単体**をローカルの Ollama サーバに接続するセットアップです。**MulmoClaude とは独立**しており、MulmoClaude 本体は現在 Ollama 接続をサポートしていません（実装案は `plans/feat-mulmoclaude-ollama-support.md` を参照）。

For detailed findings and pitfalls, see [`docs/tips/claude-code-ollama.md`](../../../docs/tips/claude-code-ollama.md) (Japanese) / [`docs/tips/claude-code-ollama.en.md`](../../../docs/tips/claude-code-ollama.en.md) (English).

## Prerequisites / 前提知識

- Ollama **v0.14.0 or later** is required (Anthropic Messages API compatibility was added in that version).
- Claude Code sends roughly **50,000–57,000 tokens per request**, so the model needs **at least a 64k context window**.
- 3B-class small models effectively cannot drive Claude Code (no tool calling, broken templates).
- Even on supported models, the first turn often takes **10+ minutes** on a MacBook Air; subsequent turns benefit from KV cache and drop to 1–3 minutes.

## Step 1: Verify / install Ollama

### 1-1. Check existing install

```bash
which ollama && ollama --version
```

- **Installed and v0.14.0+**: proceed to 1-2.
- **Older version**: `brew upgrade ollama` and then `brew services restart ollama` (Homebrew installs).
- **Not installed**: suggest one of:
  - Official installer (recommended): https://ollama.com/download/mac
  - Homebrew: `brew install ollama`

### 1-2. Verify the server is running

```bash
curl -s http://localhost:11434/api/tags | head -c 200
```

- **Got JSON back**: server is up, go to Step 2.
- **Empty / connection refused**: start it.
  - Official app: click the Ollama menu-bar icon.
  - Homebrew: `brew services start ollama` or `ollama serve`.

## Step 2: Verify Claude Code

```bash
which claude && claude --version
```

- **Installed**: continue to Step 3.
- **Not installed**: install via npm (recommended), the official script, or Homebrew:
  - `npm install -g @anthropic-ai/claude-code`
  - `curl -fsSL https://claude.ai/install.sh | sh`
  - `brew install anthropic/tap/claude-code`

## Step 3: Choose and pull a model

Confirm the user's RAM and use case before recommending. Verified working models on a MacBook Air M4 32GB are summarized in [`docs/tips/claude-code-ollama.md`](../../../docs/tips/claude-code-ollama.md). Quick picks:

| RAM | Recommended | Size | Notes |
|-----|-------------|------|-------|
| 8–16GB | (Claude Code × Ollama is impractical here) | — | Cold start exceeds 10 min timeout |
| 32GB | **`qwen3.5:9b`** | 6.6GB | Most practical, lightest fit |
| 32GB | `qwen3.6:35b-a3b` | 23GB | MoE (3B active), heavier but works |
| 16–32GB | `gemma4:e4b` | 3GB on disk (~10.9 GiB resident) | Verified on 32GB; thinking blocks render correctly |
| 24GB+ (NVIDIA) | `glm-4.7-flash` | 19GB | 198k context, untested on Mac |

Avoid: `qwen3:14b` (40k training limit), `qwen2.5-coder:14b` (older runner ignores `OLLAMA_CONTEXT_LENGTH`), `gemma4:26b` (Content block parse errors — note: `gemma4:e4b` is fine), `gpt-oss:20b` (Ollama template bug). See findings doc for details.

```bash
ollama pull <model>
ollama list
```

## Step 4: Start Ollama with the right context window

Claude Code requires ≥64k context. The default is 32k, so **always extend it** when launching Ollama for Claude Code:

```bash
brew services stop ollama   # if running under brew services
OLLAMA_CONTEXT_LENGTH=65536 ollama serve
```

This terminal must stay open for the duration of the session. For longer sessions add `OLLAMA_KEEP_ALIVE=30m` so the KV cache survives idle gaps.

## Step 5: Warm up the model

In a second terminal, load the model into memory and confirm it responds at all:

```bash
ollama run <model> "hello"
```

Expect a response within a few seconds. If this hangs, the model is unsuitable for Claude Code.

## Step 6: Run Claude Code against Ollama

In a third terminal, set the env vars and launch:

```bash
export ANTHROPIC_AUTH_TOKEN="ollama"
export ANTHROPIC_API_KEY=""
export ANTHROPIC_BASE_URL="http://localhost:11434"
claude --verbose --model <model>
```

Role of each variable:

| Variable | Value | Purpose |
|----------|-------|---------|
| `ANTHROPIC_AUTH_TOKEN` | `"ollama"` | Enables Ollama mode |
| `ANTHROPIC_API_KEY` | `""` (empty) | Disables the cloud API key (prevents collision) |
| `ANTHROPIC_BASE_URL` | `http://localhost:11434` | Routes API calls to the local server |

Send a simple message (e.g. "Hello, what model are you?") to confirm. **The first turn can take 10+ minutes**; subsequent turns drop to 1–3 minutes once the KV cache is warm.

While waiting, watch the Ollama log in another terminal to see what's happening:

```bash
tail -f /opt/homebrew/var/log/ollama.log    # Homebrew install
# or just watch the terminal where `ollama serve` is running
```

Key log signals:
- `KvSize:65536` ✓ — context is correctly extended
- `truncating input prompt limit=XXXXX` ✗ — model/runner ignores the env var; switch model
- `POST /v1/messages 200` ✓ — successful turn
- `POST /v1/messages 500` ✗ — template incompatibility; switch model

## Step 7: Switching back to cloud Claude

The local mode is scoped to the terminal where the env vars were set:

1. **Easiest**: close that terminal and open a fresh one — back to cloud.
2. Or unset explicitly:
   ```bash
   unset ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY ANTHROPIC_BASE_URL
   ```

## Step 8 (optional): Convenience alias

If the user wants a one-liner, suggest an alias in `~/.zshrc`. **Do not** put bare `export ANTHROPIC_BASE_URL=...` lines in a startup file — that breaks normal cloud usage everywhere.

```bash
alias claude-local='ANTHROPIC_AUTH_TOKEN="ollama" ANTHROPIC_API_KEY="" ANTHROPIC_BASE_URL="http://localhost:11434" claude'
```

After `source ~/.zshrc`, usage is:

```bash
claude-local --model qwen3.5:9b   # local
claude                            # cloud, unchanged
```

## Key pitfalls to highlight

- **Ollama < v0.14.0** has no Anthropic API compatibility — always check the version first.
- `ANTHROPIC_API_KEY` must be **explicitly empty**; otherwise an existing cloud key may collide.
- 3B-class models cannot reliably emit Claude's tool-use JSON, so file edits and shell commands fail.
- Even tool-capable open models (Gemma 4, gpt-oss) are not fully aligned with Anthropic's response format — complex skill chains misbehave.
- Large models (20B+) eat memory; watch with `vm_stat` or Activity Monitor.
- Permanent `export ANTHROPIC_BASE_URL=...` in `.zshrc` / `.bashrc` will silently break normal cloud Claude usage. Use an alias instead.
- The first-turn 10-minute Claude Code timeout is unavoidable, but Ollama keeps processing in the background, so a retry usually succeeds via cache reuse.

## Reference links

- Ollama Claude Code integration: https://docs.ollama.com/integrations/claude-code
- Ollama Anthropic compatibility blog: https://ollama.com/blog/claude
- Claude Code official docs: https://code.claude.com/docs/en/overview
- Local findings: [`docs/tips/claude-code-ollama.md`](../../../docs/tips/claude-code-ollama.md) (ja) / [`.en.md`](../../../docs/tips/claude-code-ollama.en.md) (en)
