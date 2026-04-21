# MulmoClaude

Experience GUI-chat with Claude Code — and long-term memory!

## Quick Start

```bash
# Prerequisites: Node.js 20+, Claude Code CLI
npm install -g @anthropic-ai/claude-code
claude auth login

# Launch MulmoClaude
npx mulmoclaude
```

Your browser opens to `http://localhost:3001`. That's it.

## Options

```
npx mulmoclaude              # Default (port 3001, opens browser)
npx mulmoclaude --port 8080  # Custom port
npx mulmoclaude --no-open    # Don't open browser
npx mulmoclaude --version    # Show version
```

## How it works

The npm package ships with the pre-built client (Vite) and the server
source — TypeScript, executed directly via `tsx`. No cloning, no
build step for end users: `npx` downloads the package and starts the
Express server.

Your data lives in `~/mulmoclaude/` (created on first run).

## For developers

Publish flow and the full local-test recipe (prepare-dist,
direct launch, curl checks, tarball simulation) live in the
header comment of `bin/prepare-dist.js`.

## License

MIT
