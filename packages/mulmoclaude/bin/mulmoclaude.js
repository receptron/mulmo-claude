#!/usr/bin/env node

// MulmoClaude launcher — `npx mulmoclaude` entry point.
//
// Strategy: clone (or update) the repo into ~/.mulmoclaude-app/,
// install dependencies, build, and start the server in production
// mode. This avoids shipping the entire monorepo as an npm package.

import { execSync, spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const REPO_URL = "https://github.com/receptron/mulmoclaude.git";
const APP_DIR = join(homedir(), ".mulmoclaude-app");
const DEFAULT_PORT = 3001;

// ── Helpers ─────────────────────────────────────────────────

function log(msg) {
  console.log(`\x1b[36m[mulmoclaude]\x1b[0m ${msg}`);
}

function error(msg) {
  console.error(`\x1b[31m[mulmoclaude]\x1b[0m ${msg}`);
}

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", cwd: APP_DIR, ...opts });
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
  --update          Force git pull + rebuild
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
const forceUpdate = args.includes("--update");

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

// ── Clone or update ─────────────────────────────────────────

if (!existsSync(APP_DIR)) {
  log("First run — cloning MulmoClaude...");
  mkdirSync(APP_DIR, { recursive: true });
  execSync(`git clone --depth 1 ${REPO_URL} "${APP_DIR}"`, {
    stdio: "inherit",
  });
  log("Installing dependencies...");
  run("yarn install --frozen-lockfile --network-timeout 120000");
  log("Building...");
  run("yarn build");
} else if (forceUpdate) {
  log("Updating MulmoClaude...");
  run("git pull origin main");
  run("yarn install --frozen-lockfile --network-timeout 120000");
  run("yarn build");
} else {
  // Quick check if build exists
  if (!existsSync(join(APP_DIR, "dist", "client"))) {
    log("Building...");
    run("yarn install --frozen-lockfile --network-timeout 120000");
    run("yarn build");
  }
}

log("Starting MulmoClaude...");

// ── Start server ────────────────────────────────────────────

const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(port),
};

const server = spawn("npx", ["tsx", "server/index.ts"], {
  cwd: APP_DIR,
  env,
  stdio: "inherit",
  shell: true,
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
  }, 3000);
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
