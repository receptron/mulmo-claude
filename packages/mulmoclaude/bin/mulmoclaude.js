#!/usr/bin/env node

// MulmoClaude launcher — `npx mulmoclaude` entry point.
//
// The npm package ships with pre-built server + client in dist/.
// This script starts the Express server in production mode.

import { execSync, fork } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_SERVER = join(__dirname, "..", "dist", "server", "server", "index.js");
const DIST_CLIENT = join(__dirname, "..", "dist", "client");
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

if (!existsSync(DIST_SERVER)) {
  error(`Server dist not found at ${DIST_SERVER}`);
  error("The package may be corrupted. Try: npm cache clean --force && npx mulmoclaude");
  process.exit(1);
}

// ── Start server ────────────────────────────────────────────

log(`Starting MulmoClaude on port ${port}...`);

const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(port),
};

const server = fork(DIST_SERVER, [], {
  cwd: join(__dirname, ".."),
  env,
  stdio: "inherit",
});

// Open browser after a short delay
if (!noOpen) {
  setTimeout(() => {
    const url = `http://localhost:${port}`;
    log(`Opening ${url}`);
    const openCmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    try {
      execSync(`${openCmd} ${url}`, { stdio: "pipe" });
    } catch {
      log(`Open your browser: ${url}`);
    }
  }, 2000);
}

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
