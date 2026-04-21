#!/usr/bin/env node

// MulmoClaude launcher — `npx mulmoclaude` entry point.
//
// Ships with server source (TypeScript) + pre-built client (Vite).
// Runs the server via tsx (TypeScript executor).

import { execSync, spawn } from "child_process";
import { existsSync } from "fs";
import { get as httpGet } from "http";
import { createRequire } from "module";
import net from "net";
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

function isPortFree(portNum) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(portNum, "127.0.0.1");
  });
}

// Walk forward from `start` to find a free port. `MAX_PORT_PROBES` caps
// the scan so an accidentally-saturated system doesn't spin forever.
const MAX_PORT_PROBES = 20;
async function findFreePort(start) {
  for (let candidate = start; candidate < start + MAX_PORT_PROBES; candidate++) {
    if (await isPortFree(candidate)) return candidate;
  }
  return null;
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
  console.log("mulmoclaude 0.1.2");
  process.exit(0);
}

const { requestedPort, portExplicit } = parsePortArg();
const noOpen = args.includes("--no-open");

function parsePortArg() {
  const idx = args.indexOf("--port");
  if (idx === -1) return { requestedPort: DEFAULT_PORT, portExplicit: false };
  const raw = args[idx + 1];
  if (raw === undefined) {
    error("--port requires a value (integer 1..65535)");
    process.exit(1);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || String(parsed) !== raw || parsed < 1 || parsed > 65535) {
    error(`Invalid --port value: "${raw}" (expected integer 1..65535)`);
    process.exit(1);
  }
  return { requestedPort: parsed, portExplicit: true };
}

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

// ── Resolve a usable port ───────────────────────────────────

// Check the requested port before spawning the server — an explicit
// --port that's taken is a hard error (respect the user's choice),
// while the default can walk forward to the next free slot so casual
// double-launches don't crash.
const port = await chooseAvailablePort(requestedPort, portExplicit);

async function chooseAvailablePort(requested, explicit) {
  if (await isPortFree(requested)) return requested;
  if (explicit) {
    error(`Port ${requested} is already in use. Stop the other process or pick a different --port.`);
    process.exit(1);
  }
  const fallback = await findFreePort(requested + 1);
  if (fallback === null) {
    error(`Port ${requested} is in use and no free port found in ${requested}..${requested + MAX_PORT_PROBES - 1}.`);
    process.exit(1);
  }
  log(`Port ${requested} busy → using ${fallback} instead. (Pass --port <N> to pin.)`);
  return fallback;
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
