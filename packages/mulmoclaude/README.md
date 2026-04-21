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

The npm package ships with pre-built server and client. No cloning, no building — `npx` downloads and starts the Express server in production mode.

Your data lives in `~/mulmoclaude/` (created on first run).

## For developers

To prepare dist for publishing:

```bash
# From repo root
yarn build                              # Build client + server
npx tsc -p server/tsconfig.json         # Build server JS
node packages/mulmoclaude/bin/prepare-dist.js  # Copy to package
cd packages/mulmoclaude && npm publish --access public
```

## License

MIT
