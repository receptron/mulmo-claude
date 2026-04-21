#!/usr/bin/env node

// MulmoClaude launcher — `npx mulmoclaude` entry point.
//
// Ships with server source (TypeScript) + pre-built client (Vite).
// Runs the server via tsx (TypeScript executor).

import { execSync, spawn } from "child_process";
import { existsSync } from "fs";
import { get as httpGet } from "http";
import { createRequire } from "module";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(__dirname, "..");
const SERVER_ENTRY = join(PKG_DIR, "server", "index.ts");
const DEFAULT_PORT = 3001;

// ── Helpers ─────────────────────────────────────────────────

function log(msg) {
  console.log(`\x1b[36m[mulmoclaude]\x1b[0m ${msg}`);
}

function error(msg) {
  console.error(`\x1b[31m[mulmoclaude]\x1b[0m ${msg}`);
}

function checkClaude() {
  try {
    execSync("claude --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function pickOpenCommand() {
  if (process.platform === "darwin") return "open";
  if (process.platform === "win32") return "start";
  return "xdg-open";
}

// Poll the server until it answers an HTTP request, then call `onReady`.
// Gives up after ~15s so the launcher doesn't hang forever on a crash loop.
function waitUntilReady(portNum, onReady) {
  const startedAt = Date.now();
  const timeoutMs = 15000;
  const intervalMs = 300;

  const attempt = () => {
    const req = httpGet({ host: "127.0.0.1", port: portNum, path: "/", timeout: 1000 }, (res) => {
      res.resume();
      onReady();
    });
    req.on("error", retry);
    req.on("timeout", () => {
      req.destroy();
      retry();
    });
  };

  const retry = () => {
    if (Date.now() - startedAt > timeoutMs) return;
    setTimeout(attempt, intervalMs);
  };

  attempt();
}

function printReadyBanner(url) {
  const bar = "─".repeat(50);
  console.log("");
  console.log(`\x1b[32m${bar}\x1b[0m`);
  console.log(`\x1b[32m  ✓ MulmoClaude is ready\x1b[0m`);
  console.log(`\x1b[32m  → ${url}\x1b[0m`);
  console.log(`\x1b[32m  Press Ctrl+C to stop.\x1b[0m`);
  console.log(`\x1b[32m${bar}\x1b[0m`);
  console.log("");
}

// ── Parse args ──────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage: npx mulmoclaude [options]

Options:
  --port <number>   Server port (default: ${DEFAULT_PORT})
  --no-open         Don't open browser automatically
  --version         Show version
  --help            Show this help
`);
  process.exit(0);
}

if (args.includes("--version")) {
  console.log("mulmoclaude 0.2.0");
  process.exit(0);
}

const portIdx = args.indexOf("--port");
const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : DEFAULT_PORT;
const noOpen = args.includes("--no-open");

// ── Pre-flight checks ───────────────────────────────────────

if (!checkClaude()) {
  error("Claude Code CLI not found.");
  error("");
  error("Install it first:");
  error("  npm install -g @anthropic-ai/claude-code");
  error("  claude auth login");
  error("");
  error("Then try again: npx mulmoclaude");
  process.exit(1);
}

log("Claude Code CLI ✓");

if (!existsSync(SERVER_ENTRY)) {
  error(`Server source not found at ${SERVER_ENTRY}`);
  process.exit(1);
}

// ── Start server ────────────────────────────────────────────

log(`Starting MulmoClaude on port ${port}...`);

// Resolve tsx's CLI entry via Node's module resolution so this works
// whether tsx is nested (`npx`/local install) or hoisted (`npm i -g`).
// tsx doesn't export `./cli`, so locate via its package.json + `bin`.
let tsxCli;
try {
  const tsxPkgJson = require.resolve("tsx/package.json");
  const tsxPkg = require(tsxPkgJson);
  tsxCli = join(dirname(tsxPkgJson), tsxPkg.bin);
} catch {
  error("Failed to locate 'tsx' — the package may be installed incorrectly.");
  process.exit(1);
}

const server = spawn(process.execPath, [tsxCli, SERVER_ENTRY], {
  cwd: PKG_DIR,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
  },
  stdio: "inherit",
});

// Print a ready banner + optionally open the browser once the server
// actually responds — not a fixed-delay timer, so the banner appears
// right when the UI is reachable.
const url = `http://localhost:${port}`;
waitUntilReady(port, () => {
  printReadyBanner(url);
  if (noOpen) return;
  const openCmd = pickOpenCommand();
  try {
    // openCmd is a hard-coded literal; url is http://localhost:<numeric-port>.
    // eslint-disable-next-line sonarjs/os-command
    execSync(`${openCmd} ${url}`, { stdio: "pipe" });
  } catch {
    log(`Open your browser: ${url}`);
  }
});

// Graceful shutdown
process.on("SIGINT", () => {
  server.kill("SIGTERM");
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.kill("SIGTERM");
  process.exit(0);
});

server.on("exit", (code) => {
  process.exit(code ?? 1);
});
