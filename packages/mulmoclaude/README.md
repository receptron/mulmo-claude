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

### Local testing (before publishing)

Exercise the same code path `npx mulmoclaude` uses — without
touching the npm registry. Run everything from the repo root.

```bash
# 1. Build the Vite client into dist/client/
yarn build

# 2. Install workspace deps (tsx is a dependency of mulmoclaude)
yarn install

# 3. Copy client + server + shared src into packages/mulmoclaude/
node packages/mulmoclaude/bin/prepare-dist.js
```

After `prepare-dist`, the package is self-contained and ready to run.

```bash
# 4. Launch the launcher script directly
node packages/mulmoclaude/bin/mulmoclaude.js --no-open --port 3099
```

Expected output:

```
[mulmoclaude] Claude Code CLI ✓
[mulmoclaude] Starting MulmoClaude on port 3099...
... INFO  [workspace] ready workspacePath=/Users/you/mulmoclaude
... INFO  [server] listening port=3099
```

Verify the running server in another terminal:

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3099/
# → HTTP 200

# Check index.html is served with the bearer token injected
curl -s http://localhost:3099/ | grep mulmoclaude-auth

# Check a static asset resolves
curl -s -o /dev/null -w "%{http_code}\n" \
  "http://localhost:3099$(curl -s http://localhost:3099/ \
    | grep -oE '/assets/[^\"]*\.js' | head -1)"
# → 200

# Protected API returns 401 without token (expected)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3099/api/config
# → 401
```

Stop the server with `Ctrl+C`, or:

```bash
kill "$(lsof -ti:3099)"
```

### Simulating the published tarball

To test the exact bits a user would `npx`:

```bash
cd packages/mulmoclaude
npm pack                         # → mulmoclaude-<ver>.tgz
cd /tmp && mkdir mc-test && cd mc-test
npm init -y >/dev/null
npm install /path/to/mulmoclaude-<ver>.tgz
./node_modules/.bin/mulmoclaude --no-open --port 3099
```

### Publishing

```bash
# From repo root
yarn build                                      # Build client (Vite)
node packages/mulmoclaude/bin/prepare-dist.js   # Copy client + server + shared src
cd packages/mulmoclaude && npm publish --access public
```

## License

MIT
