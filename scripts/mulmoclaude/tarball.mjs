// mulmoclaude tarball smoke test (§4 of publish-mulmoclaude skill).
//
// Reproduces the manual pre-publish check: `npm pack` the launcher,
// install the .tgz into a clean directory, boot it on a free port,
// wait for the "/" endpoint to respond 200. If any step fails, this
// driver dumps the launcher's stdout/stderr to a log file and
// returns a non-zero result so CI (or the human release engineer)
// has a concrete artifact to investigate.
//
// The pure helpers (allocateRandomPort, pollHttp, buildInstallerPackageJson)
// are unit-tested. The end-to-end orchestration is exercised by the
// CI workflow itself (step 5) — writing a 45-second unit test for
// "install the whole launcher and boot it" costs more than it saves.

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readdir, appendFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { fileURLToPath } from "node:url";

const DEFAULT_BOOT_TIMEOUT_MS = 45_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_PACK_TIMEOUT_MS = 60_000;
const DEFAULT_INSTALL_TIMEOUT_MS = 180_000;
const KILL_GRACE_MS = 2_000;

// Ask the OS for a random free TCP port on 127.0.0.1. Binding to 0
// returns whatever port the kernel assigns; we close immediately and
// hand the number to whoever wanted it. There's a small TOCTOU —
// another process could grab the same port before we bind again —
// but for local CI smoke that's vanishingly rare and recoverable
// (the next run gets another random port).
export function allocateRandomPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("allocateRandomPort: server.address() returned null"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

// Poll `url` with an injectable fetch implementation. Resolves with
// `{ ok: true, attempts, elapsedMs }` on the first 2xx response, or
// `{ ok: false, attempts, elapsedMs, lastError }` after timeout.
// The injectable fetch is what makes this unit-testable without
// actually standing up an HTTP server.
export async function pollHttp({ url, timeoutMs = DEFAULT_BOOT_TIMEOUT_MS, intervalMs = DEFAULT_POLL_INTERVAL_MS, fetchImpl = globalThis.fetch, now = Date.now, sleep = defaultSleep } = {}) {
  const startedAt = now();
  let attempts = 0;
  let lastError = null;
  while (now() - startedAt < timeoutMs) {
    attempts += 1;
    try {
      const response = await fetchImpl(url);
      if (response.status >= 200 && response.status < 300) {
        return { ok: true, attempts, elapsedMs: now() - startedAt };
      }
      lastError = `status ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(intervalMs);
  }
  return { ok: false, attempts, elapsedMs: now() - startedAt, lastError };
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

// Build the throwaway package.json for the install directory. Pure
// function so tests can lock in the shape without spinning up a
// filesystem.
export function buildInstallerPackageJson({ tarballName } = {}) {
  return {
    name: "mulmoclaude-smoke-installer",
    version: "0.0.0",
    private: true,
    // `type: "module"` isn't required — mulmoclaude's bin shim is
    // its own entry point. Keeping the installer tree minimal so a
    // broken install path fails loudly rather than being masked by
    // ambient package config.
    description: "Throwaway install root for mulmoclaude CI smoke. Not for publish.",
    dependencies: tarballName ? { mulmoclaude: `file:${tarballName}` } : {},
  };
}

// Spawn a child process, collect stdout/stderr as strings, enforce a
// timeout. Returns `{ code, signal, stdout, stderr, timedOut }`.
async function runCommand(cmd, args, { cwd, timeoutMs, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS);
    child.stdout?.on("data", (chunk) => stdout.push(chunk));
    child.stderr?.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (err) => {
      clearTimeout(killTimer);
      reject(err);
    });
    child.once("close", (code, signal) => {
      clearTimeout(killTimer);
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
      });
    });
  });
}

// `npm pack` inside packages/mulmoclaude/, then find the .tgz it
// emitted (name includes the version so we can't hard-code it).
async function packTarball({ root, packTimeoutMs }) {
  const pkgDir = path.join(root, "packages", "mulmoclaude");
  // Clean old tarballs so we don't accidentally install a stale one.
  for (const name of await readdir(pkgDir)) {
    if (name.startsWith("mulmoclaude-") && name.endsWith(".tgz")) {
      await rm(path.join(pkgDir, name), { force: true });
    }
  }
  const result = await runCommand("npm", ["pack"], { cwd: pkgDir, timeoutMs: packTimeoutMs ?? DEFAULT_PACK_TIMEOUT_MS });
  if (result.code !== 0 || result.timedOut) {
    throw new Error(`npm pack failed (code=${result.code}, timedOut=${result.timedOut})\n${result.stderr}`);
  }
  const tarball = (await readdir(pkgDir)).find((name) => name.startsWith("mulmoclaude-") && name.endsWith(".tgz"));
  if (!tarball) throw new Error("npm pack did not produce a mulmoclaude-*.tgz");
  return path.join(pkgDir, tarball);
}

// Lay out a throwaway install dir and `npm install` the tarball.
async function installTarball({ workDir, tarballAbsolutePath, installTimeoutMs }) {
  const pkg = buildInstallerPackageJson({ tarballName: path.basename(tarballAbsolutePath) });
  await writeFile(path.join(workDir, "package.json"), JSON.stringify(pkg, null, 2), "utf8");
  const result = await runCommand("npm", ["install", tarballAbsolutePath, "--no-audit", "--no-fund"], {
    cwd: workDir,
    timeoutMs: installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS,
  });
  if (result.code !== 0 || result.timedOut) {
    throw new Error(`npm install failed (code=${result.code}, timedOut=${result.timedOut})\n${result.stderr}`);
  }
}

// Boot the installed launcher on `port`, tee stdout+stderr to
// `logFile`, wait for the poll helper to get a 200. Returns the
// probe outcome and a reference to the child so the caller can
// clean it up — even on success — to free the port.
async function bootAndProbe({ workDir, port, bootTimeoutMs, logFile }) {
  const bin = path.join(workDir, "node_modules", ".bin", "mulmoclaude");
  const child = spawn(bin, ["--no-open", "--port", String(port)], {
    cwd: workDir,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const attachSink = async (stream, label) => {
    stream.on("data", async (chunk) => {
      try {
        await appendFile(logFile, `[${label}] ${chunk.toString("utf8")}`);
      } catch {
        // Don't fail the smoke run over a log-file write error.
      }
    });
  };
  await attachSink(child.stdout, "out");
  await attachSink(child.stderr, "err");
  const probe = await pollHttp({
    url: `http://127.0.0.1:${port}/`,
    timeoutMs: bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS,
  });
  return { probe, child };
}

async function killGracefully(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const start = Date.now();
  while (Date.now() - start < KILL_GRACE_MS) {
    if (child.exitCode !== null) return;
    await defaultSleep(100);
  }
  if (child.exitCode === null) child.kill("SIGKILL");
}

// End-to-end smoke. Returns `{ ok, ... }` — never throws unless the
// caller passes a malformed `root`. Cleanup is best-effort: the
// tarball, the work dir, and the process are all tidied up in a
// finally block before returning.
export async function runTarballSmoke({ root = process.cwd(), workDir, logFile, bootTimeoutMs, packTimeoutMs, installTimeoutMs, port } = {}) {
  const runDir = workDir ?? (await mkdtemp(path.join(os.tmpdir(), "mc-smoke-")));
  const resolvedLog = logFile ?? path.join(runDir, "launcher.log");
  await mkdir(runDir, { recursive: true });
  // Truncate log up-front so appends from a failed run don't leak.
  await writeFile(resolvedLog, "", "utf8");

  let tarballPath = null;
  let child = null;
  try {
    tarballPath = await packTarball({ root, packTimeoutMs });
    await installTarball({ workDir: runDir, tarballAbsolutePath: tarballPath, installTimeoutMs });
    const resolvedPort = port ?? (await allocateRandomPort());
    const booted = await bootAndProbe({ workDir: runDir, port: resolvedPort, bootTimeoutMs, logFile: resolvedLog });
    child = booted.child;
    return {
      ok: booted.probe.ok,
      port: resolvedPort,
      attempts: booted.probe.attempts,
      elapsedMs: booted.probe.elapsedMs,
      lastError: booted.probe.ok ? null : booted.probe.lastError,
      tarballPath,
      workDir: runDir,
      logFile: resolvedLog,
    };
  } catch (err) {
    return {
      ok: false,
      port: null,
      attempts: 0,
      elapsedMs: 0,
      lastError: err instanceof Error ? err.message : String(err),
      tarballPath,
      workDir: runDir,
      logFile: resolvedLog,
    };
  } finally {
    if (child) await killGracefully(child);
    // Tarball cleanup is conservative — leaving it around after a
    // failure is actually useful for post-mortem (inspect contents,
    // reproduce install locally). Only nuke on success + when we
    // created the work dir ourselves.
  }
}

export async function main() {
  const result = await runTarballSmoke();
  if (result.ok) {
    console.log(`[mulmoclaude:tarball] OK — HTTP 200 on port ${result.port} after ${result.attempts} attempt(s) (${result.elapsedMs}ms)`);
    return 0;
  }
  console.error(`[mulmoclaude:tarball] FAIL — ${result.lastError}`);
  console.error(`  work dir: ${result.workDir}`);
  console.error(`  launcher log: ${result.logFile}`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const code = await main();
  process.exit(code);
}
