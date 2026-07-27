// Node-side entry point for the icon launcher. The .app's shell stub
// hands over here as soon as it has recovered a usable PATH.
//
// Everything user-visible happens on a browser page (launcher-page.mjs);
// this file only decides which page to show and when. The order matters:
// an already-running server is answered before any prerequisite check,
// so clicking the icon while the app is open never stalls behind a
// `claude --version` probe.

import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, closeSync, mkdirSync, openSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { findRunningServerPort } from "./detect-server.mjs";
import { fillPlaceholders, launcherMessages, pickLauncherLocale } from "./messages.mjs";
import { renderErrorPage, renderLauncherPage } from "./launcher-page.mjs";
import { runPreflight } from "./preflight.mjs";
import { findAvailablePort } from "../port.mjs";

const DEFAULT_PORT = 3001;
const LOG_SIZE_CAP_BYTES = 1_000_000;

/** macOS keeps per-app logs here, which is also where Console.app looks. */
export function launcherLogPath(home = homedir()) {
  return join(home, "Library", "Logs", "MulmoClaude", "launcher.log");
}

function log(logPath, message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    capLogSize(logPath);
    appendFileSync(logPath, line);
  } catch {
    // A launcher that dies because it could not write its own log has
    // failed at the only thing it exists to do.
  }
}

function capLogSize(logPath) {
  try {
    if (statSync(logPath).size > LOG_SIZE_CAP_BYTES) truncateSync(logPath, 0);
  } catch {
    // No log yet — nothing to cap.
  }
}

// A GUI launch inherits no LANG, so the system preference is the only
// reliable source. Falls back to the env vars for a terminal run.
function readAppleLocale() {
  try {
    return execFileSync("defaults", ["read", "-g", "AppleLocale"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

/** The OS UI language, as macOS reports it (`ja_JP`, `pt_BR`, …). */
export function detectLocale({ env = process.env, run = readAppleLocale } = {}) {
  const fromSystem = run();
  if (typeof fromSystem === "string" && fromSystem.trim().length > 0) return pickLauncherLocale(fromSystem.trim());
  return pickLauncherLocale(env.LANG?.split(".")[0] ?? env.LC_ALL?.split(".")[0]);
}

function openInBrowser(target) {
  spawn("open", [target], { stdio: "ignore", detached: true }).unref();
}

function showPage(html, { tmpDir, name }) {
  const path = join(tmpDir, name);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(path, html);
  openInBrowser(path);
  return path;
}

function showFailure({ failure, messages, locale, logPath, tmpDir }) {
  const html = renderErrorPage({ messages, failure, logPath, locale });
  showPage(html, { tmpDir, name: "mulmoclaude-error.html" });
}

// The prerequisite failures carry `{required}` / `{found}`, and the
// Claude Code one carries the commands to run. Fold the catalog entry
// and the measured values into what the page renders.
function toPageFailure(messages, { key, values }) {
  const entry = messages[key];
  return {
    title: entry.title,
    body: fillPlaceholders(entry.body, values),
    action: entry.action,
    steps: entry.steps,
    stepsNote: entry.stepsNote,
    hint: entry.hint,
  };
}

// `npx mulmoclaude@latest` is spawned detached so the server outlives
// this process: there is no window to keep open and nothing to keep the
// launcher alive for. Clicking the icon again finds the running server
// and just opens the browser, so a lingering server is harmless.
//
// Its output goes straight to the log file by descriptor, NOT through
// pipes. Piping would keep the launcher's event loop alive forever
// holding the read ends — the process never exits, which is the exact
// opposite of detaching — and killing it would then break the server's
// stdout mid-write.
/**
 * What to spawn, and from where.
 *
 * The working directory is set explicitly because a GUI launch runs with
 * cwd `/` (measured), and the CLI loads `<cwd>/.env` to pick up keys like
 * `GEMINI_API_KEY`. Left alone, an icon user's `.env` could only ever be
 * `/.env` — a path they cannot write — so the documented way to supply a
 * key would silently do nothing for exactly the people who never open a
 * terminal. Home is the one directory that is theirs and always exists.
 *
 * @param {{ port: number, home?: string }} options
 * @returns {{ command: string, args: string[], cwd: string }}
 */
export function serverSpawnPlan({ port, home = homedir() }) {
  return {
    command: "npx",
    args: ["mulmoclaude@latest", "--port", String(port), "--no-open"],
    cwd: home,
  };
}

function spawnServer({ port, logPath, env }) {
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, "a");
  const { command, args, cwd } = serverSpawnPlan({ port });
  try {
    const child = spawn(command, args, {
      env,
      cwd,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
    return child;
  } finally {
    closeSync(logFd);
  }
}

/**
 * @param {import("./start.d.mts").StartLauncherOptions} [options]
 * @returns {Promise<"opened-existing" | "preflight-failed" | "starting" | "no-port">}
 */
export async function startLauncher({ env = process.env, tmpDir, localeRunner } = {}) {
  const logPath = launcherLogPath();
  const locale = detectLocale({ env, run: localeRunner });
  const messages = launcherMessages(locale);
  const pageDir = tmpDir ?? join(homedir(), "Library", "Caches", "MulmoClaude");
  log(logPath, `launcher start (locale=${locale})`);

  const runningPort = await findRunningServerPort(DEFAULT_PORT);
  if (runningPort !== null) {
    log(logPath, `already running on ${runningPort} — opening browser`);
    openInBrowser(`http://localhost:${runningPort}/`);
    return "opened-existing";
  }

  const failure = runPreflight({ env });
  if (failure !== null) {
    log(logPath, `preflight failed: ${failure.key}`);
    showFailure({ failure: toPageFailure(messages, failure), messages, locale, logPath, tmpDir: pageDir });
    return "preflight-failed";
  }

  const port = await findAvailablePort(DEFAULT_PORT);
  if (port === null) {
    log(logPath, `no free port from ${DEFAULT_PORT}`);
    const { noPort } = messages;
    const body = fillPlaceholders(noPort.body, { port: DEFAULT_PORT });
    showFailure({ failure: { ...noPort, body }, messages, locale, logPath, tmpDir: pageDir });
    return "no-port";
  }

  log(logPath, `starting server on ${port}`);
  showPage(renderLauncherPage({ messages, port, logPath, locale }), { tmpDir: pageDir, name: "mulmoclaude-starting.html" });
  spawnServer({ port, logPath, env });
  return "starting";
}
