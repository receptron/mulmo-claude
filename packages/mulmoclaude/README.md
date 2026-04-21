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

## What happens on first run

1. Clones the MulmoClaude repo to `~/.mulmoclaude-app/`
2. Installs dependencies + builds
3. Starts the server in production mode
4. Opens your browser

Subsequent runs skip the clone and build — startup is instant.

## Options

```
npx mulmoclaude              # Default (port 3001, opens browser)
npx mulmoclaude --port 8080  # Custom port
npx mulmoclaude --no-open    # Don't open browser
npx mulmoclaude --update     # Pull latest + rebuild
npx mulmoclaude --version    # Show version
```

## Updating

```bash
npx mulmoclaude --update
```

Or manually:
```bash
cd ~/.mulmoclaude-app
git pull origin main
yarn build
```

## Data

All your data lives in `~/mulmoclaude/` (the workspace). The app code lives separately in `~/.mulmoclaude-app/`. Uninstalling the app doesn't touch your data.

## License

MIT
