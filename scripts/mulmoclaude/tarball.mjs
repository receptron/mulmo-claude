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
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir, appendFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { fileURLToPath } from "node:url";

// Sandbox build context: `server/system/docker.ts` runs `docker build
// -f Dockerfile.sandbox .` from the launcher's package dir, so both
// the Dockerfile and the entrypoint script it COPYs must be inside
// the published tarball. 0.5.2 silently shipped without them and
// sandbox mode fell back to unrestricted execution at runtime — this
// list is what the smoke verifies post-install.
const REQUIRED_SANDBOX_FILES = ["Dockerfile.sandbox", "sandbox-entrypoint.sh"];

const DEFAULT_BOOT_TIMEOUT_MS = 45_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_PACK_TIMEOUT_MS = 60_000;
const DEFAULT_INSTALL_TIMEOUT_MS = 180_000;
const KILL_GRACE_MS = 2_000;
// Plugin loading runs inside a fire-and-forget IIFE in `server/index.ts`
// that fires AFTER `app.listen()` returns. The `/` route therefore goes
// 200 before presets / user-installed / dev plugins finish resolving.
// On slow boots (cold yarn install) the list is populated by probe
// time; on fast boots the probe wins the race and sees `[]`. Poll the
// list endpoint up to this budget so the assertion survives either
// ordering. 10s comfortably covers preset + dev-fixture import on CI
// hardware while still failing fast when the IIFE actually crashed.
const DEFAULT_PLUGIN_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_PLUGIN_PROBE_INTERVAL_MS = 250;

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
export async function pollHttp({
  url,
  timeoutMs = DEFAULT_BOOT_TIMEOUT_MS,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = defaultSleep,
} = {}) {
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
// filesystem. `overrides` (npm `overrides`) redirects the launcher's
// first-party workspace deps to local `file:` tarballs so the install
// resolves them from the just-built workspace instead of the public
// registry — see packWorkspaceOverrides / plans/done/feat-smoke-local-registry.md.
export function buildInstallerPackageJson({ tarballName, overrides } = {}) {
  const pkg = {
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
  if (overrides && Object.keys(overrides).length > 0) {
    pkg.overrides = overrides;
  }
  return pkg;
}

// The launcher package's own name — it is installed via its tarball, never
// overridden, and is the root of the first-party dependency closure.
const LAUNCHER_NAME = "mulmoclaude";

// Read every workspace package (name, dir, first-party-relevant dep names) by
// expanding the root package.json `workspaces` globs. All globs are `<dir>/*`,
// so a single readdir per parent suffices — no glob library needed. Injectable
// fs impls keep it unit-testable. `deps` folds dependencies + peerDependencies +
// optionalDependencies since any of them can pull a first-party package into the
// install tree.
export async function enumerateWorkspacePackages(root, { readFileImpl = readFile, readdirImpl = readdir } = {}) {
  const rootPkg = JSON.parse(await readFileImpl(path.join(root, "package.json"), "utf8"));
  const globs = rootPkg.workspaces ?? [];
  const packages = [];
  for (const glob of globs) {
    const parent = glob.replace(/\/\*$/, "");
    let entries;
    try {
      entries = await readdirImpl(path.join(root, parent), { withFileTypes: true });
    } catch {
      continue; // a globbed parent dir may not exist in every checkout
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, parent, entry.name);
      let pj;
      try {
        pj = JSON.parse(await readFileImpl(path.join(dir, "package.json"), "utf8"));
      } catch {
        continue; // a `<dir>/*` parent (e.g. packages/plugins) has no package.json of its own
      }
      const deps = [...Object.keys(pj.dependencies ?? {}), ...Object.keys(pj.peerDependencies ?? {}), ...Object.keys(pj.optionalDependencies ?? {})];
      packages.push({ name: pj.name, dir, private: pj.private === true, deps });
    }
  }
  return packages;
}

// Pure BFS: the set of first-party (workspace) package names reachable from
// `rootName`'s deps, excluding the root itself. "First-party" = present in the
// packages list, so third-party deps (@mulmochat-plugin/*, @mulmocast/types, …)
// are naturally excluded and left to resolve from the public registry.
export function computeFirstPartyClosure(packages, rootName) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const firstParty = new Set(byName.keys());
  const root = byName.get(rootName);
  if (!root) return new Set();
  const closure = new Set();
  const queue = root.deps.filter((dep) => firstParty.has(dep));
  while (queue.length > 0) {
    const name = queue.shift();
    if (closure.has(name) || name === rootName) continue;
    closure.add(name);
    const pkg = byName.get(name);
    if (pkg) {
      for (const dep of pkg.deps) {
        if (firstParty.has(dep) && !closure.has(dep)) queue.push(dep);
      }
    }
  }
  return closure;
}

// `npm pack` one workspace package into `destDir` with --ignore-scripts (dist is
// already built by the CI build step, so we archive it as-is rather than paying a
// prepack rebuild per package). Returns the absolute tarball path.
async function packOneWorkspacePackage({ packageDir, destDir, runCommandImpl = runCommand, packTimeoutMs }) {
  const result = await runCommandImpl("npm", ["pack", packageDir, "--ignore-scripts", "--pack-destination", destDir, "--json"], {
    timeoutMs: packTimeoutMs ?? DEFAULT_PACK_TIMEOUT_MS,
  });
  if (result.code !== 0 || result.timedOut) {
    throw new Error(`npm pack failed for ${packageDir} (code=${result.code}, timedOut=${result.timedOut})\n${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout);
  const filename = Array.isArray(parsed) ? parsed[0]?.filename : parsed?.filename;
  if (!filename) throw new Error(`npm pack produced no filename for ${packageDir}`);
  return path.join(destDir, filename);
}

// npm reads a `file:` specifier as a URL-ish path, where `\` is not a separator.
// `path.join` emits `\` on Windows, so normalise to `/` — Windows filesystem APIs
// accept forward slashes. `sep` is injectable so the Windows shape is testable on
// any host; on POSIX it defaults to `/`, leaving a literal `\` in a filename alone.
export function toFileSpecifier(tarballPath, sep = path.sep) {
  return `file:${tarballPath.split(sep).join("/")}`;
}

// Pack the launcher's first-party workspace dependency closure into `packDir` and
// return an npm `overrides` map { name: "file:<abs tarball>" }. This is what lets
// the smoke install a launcher pinned to a bumped-but-unpublished shared package
// (e.g. @mulmoclaude/core@0.12.0) without that version existing on public npm —
// see plans/done/feat-smoke-local-registry.md.
export async function packWorkspaceOverrides({ root, packDir, runCommandImpl = runCommand, enumerateImpl = enumerateWorkspacePackages, packTimeoutMs } = {}) {
  const packages = await enumerateImpl(root);
  const closure = computeFirstPartyClosure(packages, LAUNCHER_NAME);
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const overrides = {};
  for (const name of closure) {
    const pkg = byName.get(name);
    if (!pkg) continue;
    const tarballPath = await packOneWorkspacePackage({ packageDir: pkg.dir, destDir: packDir, runCommandImpl, packTimeoutMs });
    overrides[name] = toFileSpecifier(tarballPath);
  }
  return overrides;
}

// Spawn a child process, collect stdout/stderr as strings, enforce a
// timeout. Returns `{ code, signal, stdout, stderr, timedOut }`.
//
// On timeout we send SIGTERM, then escalate to SIGKILL if the child
// still hasn't exited after `KILL_GRACE_MS` — npm subprocesses under
// load can ignore SIGTERM long enough to hang a CI job past its
// overall budget, so the hard kill is a safety net.
async function runCommand(cmd, args, { cwd, timeoutMs, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let sigkillTimer = null;
    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      sigkillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, KILL_GRACE_MS);
    }, timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS);
    const clearKillTimers = () => {
      clearTimeout(killTimer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
    };
    child.stdout?.on("data", (chunk) => stdout.push(chunk));
    child.stderr?.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (err) => {
      clearKillTimers();
      reject(err);
    });
    child.once("close", (code, signal) => {
      clearKillTimers();
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

// Read the bearer token the launcher writes at boot. The token path
// is logged on stdout/stderr (`bearer token written path=<absolute>
// source=...`) and tee'd into `logFile` by `bootAndProbe`. We grep it
// from there instead of guessing the workspace location, so this
// works regardless of `$HOME` overrides or future workspace-path
// changes. Returns the trimmed token string, or null when the line
// or the file is unavailable.
export async function readTokenFromLauncherLog({ logFile, readFileImpl = readFile } = {}) {
  let logContents;
  try {
    logContents = await readFileImpl(logFile, "utf8");
  } catch {
    return null;
  }
  const match = logContents.match(/bearer token written path=(\S+)/);
  if (!match) return null;
  try {
    const tokenContents = await readFileImpl(match[1], "utf8");
    return tokenContents.trim() || null;
  } catch {
    return null;
  }
}

// Hit `/api/plugins/runtime/list` with the launcher's bearer token to
// confirm the runtime-plugin pipeline reaches the wire. We assert
// status 200 + a JSON body shaped `{ plugins: [...] }` — that already
// proves bearer auth is wired, the route is mounted, and Express is
// serializing JSON correctly. A non-zero `plugins.length` means user-
// installed plugins were resolved through the workspace ledger, but
// is NOT required for ok=true: a fresh install (no presets, no user
// ledger) legitimately reports zero. Plugin count is informational.
//
// `expectedDevPlugin` (optional) extends the assertion: when set, the
// list MUST contain a plugin matching that name with version `"dev"`.
// This is what proves the `--dev-plugin` CLI flag → env-var → server
// loader → registry → /list pipeline made it end-to-end (#1159 PR2).
//
// Plugin loading runs in a fire-and-forget IIFE that resolves AFTER
// `app.listen()`, so the very first request can see an empty list
// even when everything is wired correctly. When `expectedDevPlugin`
// is set we poll the **transient** failure modes (fetch error while
// the server is still binding, or 200 with the dev plugin not yet in
// the list) until the plugin appears or the budget expires.
// Permanent failures — non-200 status, body shape regression, JSON
// parse error — fail immediately so a real auth / route regression
// surfaces in the CI log without 10s of dead poll attempts. For the
// plain probe (no expectation), the list may legitimately be empty
// at any moment after boot, so a single shot is sufficient.
export async function probeRuntimePlugins({
  port,
  token,
  fetchImpl = globalThis.fetch,
  expectedDevPlugin = null,
  pollTimeoutMs = DEFAULT_PLUGIN_PROBE_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_PLUGIN_PROBE_INTERVAL_MS,
  now = Date.now,
  sleep = defaultSleep,
} = {}) {
  if (!token) {
    return { ok: false, status: null, plugins: 0, lastError: "no bearer token (could not extract from launcher log)" };
  }
  // Without an expected plugin we have no signal to wait for; one
  // attempt is the right behaviour (preserves the original semantics).
  if (!expectedDevPlugin) {
    return stripRetryable(await runRuntimePluginsProbeOnce({ port, token, fetchImpl, expectedDevPlugin }));
  }
  const startedAt = now();
  let lastResult = await runRuntimePluginsProbeOnce({ port, token, fetchImpl, expectedDevPlugin });
  while (!lastResult.ok && lastResult.retryable && now() - startedAt < pollTimeoutMs) {
    await sleep(pollIntervalMs);
    lastResult = await runRuntimePluginsProbeOnce({ port, token, fetchImpl, expectedDevPlugin });
  }
  return stripRetryable(lastResult);
}

// `retryable` is an internal contract between the poll loop and the
// single-shot probe — callers see the result without it (keeps the
// public shape stable for unit tests and the smoke driver).
function stripRetryable(result) {
  const { retryable: _retryable, ...rest } = result;
  return rest;
}

// Single-shot probe — one HTTP call, one verdict. The `retryable`
// flag tells the caller whether a !ok result should trigger a retry
// (race against fire-and-forget plugin loader) or fail immediately
// (real configuration / route regression).
async function runRuntimePluginsProbeOnce({ port, token, fetchImpl, expectedDevPlugin }) {
  let response;
  try {
    response = await fetchImpl(`http://127.0.0.1:${port}/api/plugins/runtime/list`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    // Transport-level failure — server is still binding, or the
    // listener went away mid-boot. Retry: the boot probe already
    // confirmed `/` answered 200, so this is transient by design.
    return { ok: false, status: null, plugins: 0, lastError: `fetch failed: ${err instanceof Error ? err.message : String(err)}`, retryable: true };
  }
  if (response.status !== 200) {
    // 401 / 403 / 5xx are configuration or route regressions, not
    // races. Fail fast so the CI log points at the actual problem
    // instead of "we waited 10s and still got 401".
    return { ok: false, status: response.status, plugins: 0, lastError: `status ${response.status}`, retryable: false };
  }
  let body;
  try {
    body = await response.json();
  } catch (err) {
    // 200 with a non-JSON body means the route is serving the wrong
    // content (e.g. an error page proxied through). Permanent.
    return { ok: false, status: 200, plugins: 0, lastError: `json parse failed: ${err instanceof Error ? err.message : String(err)}`, retryable: false };
  }
  if (!Array.isArray(body?.plugins)) {
    // Response shape regression — the contract changed under us.
    // Retrying can't heal a broken contract.
    return { ok: false, status: 200, plugins: 0, lastError: "response body is not { plugins: [...] }", retryable: false };
  }
  if (expectedDevPlugin) {
    const match = body.plugins.find((entry) => entry.name === expectedDevPlugin && entry.version === "dev");
    if (!match) {
      // The race we're actually fixing: route is wired, body shape
      // is right, but the IIFE hasn't registered yet. Retry.
      const seen = body.plugins.map((entry) => `${entry.name}@${entry.version}`).join(", ");
      return { ok: false, status: 200, plugins: body.plugins.length, lastError: `dev plugin "${expectedDevPlugin}@dev" not in list — saw: ${seen}`, retryable: true };
    }
  }
  return { ok: true, status: 200, plugins: body.plugins.length, lastError: null, retryable: false };
}

// Lay out a minimal dev-plugin fixture: a directory with package.json
// (name + ESM exports pointing at dist/index.js) and an index.js
// exporting a TOOL_DEFINITION the runtime loader will accept. Pure
// enough to test without spawning the launcher — see
// `test_tarball.ts`. Returns `{ absPath, name }` for piping into
// `--dev-plugin <absPath>` and the corresponding probe assertion.
export async function makeDevPluginFixture({ workDir, name = "@smoke/dev-fixture", subdir = "dev-plugin-fixture" } = {}) {
  const absPath = path.join(workDir, subdir);
  await mkdir(path.join(absPath, "dist"), { recursive: true });
  const pkg = {
    name,
    version: "0.1.0",
    type: "module",
    exports: { ".": { import: "./dist/index.js" } },
  };
  await writeFile(path.join(absPath, "package.json"), JSON.stringify(pkg, null, 2), "utf8");
  await writeFile(
    path.join(absPath, "dist", "index.js"),
    `export const TOOL_DEFINITION = {
  type: "function",
  name: "smokeDevTool",
  description: "smoke fixture for the --dev-plugin pipeline",
  parameters: { type: "object", properties: {}, required: [] }
};
export const smokeDevTool = async () => ({ ok: true });
`,
    "utf8",
  );
  return { absPath, name };
}

// Verify the sandbox build context made it through `npm pack` / `npm
// install`. Keeps the assertion out of `bootAndProbe` so a missing
// file fails loudly with a precise reason instead of silently letting
// sandbox mode degrade.
export async function verifySandboxFiles({ workDir, files = REQUIRED_SANDBOX_FILES, statImpl = stat } = {}) {
  const installedPkgDir = path.join(workDir, "node_modules", "mulmoclaude");
  const missing = [];
  for (const file of files) {
    try {
      const info = await statImpl(path.join(installedPkgDir, file));
      if (!info.isFile()) missing.push(file);
    } catch {
      missing.push(file);
    }
  }
  return { ok: missing.length === 0, missing, checkedDir: installedPkgDir };
}

// Lay out a throwaway install dir and `npm install` the tarball. First-party
// workspace deps are packed to local tarballs and pinned via `overrides` so the
// install resolves them from the just-built workspace, not the public registry —
// otherwise a launcher pinned to a bumped-but-unpublished shared package would
// fail with ETARGET (plans/done/feat-smoke-local-registry.md).
async function installTarball({ workDir, tarballAbsolutePath, installTimeoutMs, root, packTimeoutMs }) {
  const packDir = path.join(workDir, "local-deps");
  await mkdir(packDir, { recursive: true });
  const overrides = await packWorkspaceOverrides({ root, packDir, packTimeoutMs });
  const pkg = buildInstallerPackageJson({ tarballName: path.basename(tarballAbsolutePath), overrides });
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
//
// Spawn failures (ENOENT on the bin, EACCES, etc.) race the HTTP
// probe via `Promise.race` — otherwise `pollHttp` would eat the
// full boot timeout waiting for a child that never started, and
// the smoke would look like a boot-too-slow failure instead of
// the actual install/permission bug.
async function bootAndProbe({ workDir, port, bootTimeoutMs, logFile, extraArgs = [] }) {
  const bin = path.join(workDir, "node_modules", ".bin", "mulmoclaude");
  const child = spawn(bin, ["--no-open", "--port", String(port), ...extraArgs], {
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
  const spawnErrorPromise = new Promise((resolve) => {
    child.once("error", (err) => {
      resolve({
        ok: false,
        attempts: 0,
        elapsedMs: 0,
        lastError: `launcher spawn failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
  });
  const probe = await Promise.race([
    pollHttp({
      url: `http://127.0.0.1:${port}/`,
      timeoutMs: bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS,
    }),
    spawnErrorPromise,
  ]);
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
// work dir and the child process are tidied up in a finally block
// before returning.
//
// Cleanup policy: the **work dir** under `os.tmpdir()` is removed
// on success when we allocated it ourselves (keeps repeated local
// runs tidy). On failure we leave it so investigators can inspect
// the installed tree. A caller-provided `workDir` is always left
// alone (CI typically uploads it as an artifact).
//
// The **tarball** at `packages/mulmoclaude/mulmoclaude-<X.Y.Z>.tgz`
// is intentionally left in place on both success and failure:
//   - CI's `upload-artifact` step picks it up as a smoke-verified
//     downloadable for release-prep validation.
//   - `packTarball()` (run at the start of every smoke) already
//     deletes any stale `mulmoclaude-*.tgz` first, so leftover
//     tarballs don't pile up across runs.
//   - `*.tgz` is gitignored, so local leftovers never reach a
//     commit.
export async function runTarballSmoke({
  root = process.cwd(),
  workDir,
  logFile,
  bootTimeoutMs,
  packTimeoutMs,
  installTimeoutMs,
  port,
  // When set, the smoke creates a minimal dev-plugin fixture and
  // boots the launcher with `--dev-plugin <absPath>`. The plugin
  // probe then asserts the fixture appears in
  // `/api/plugins/runtime/list` with version `"dev"`. This exercises
  // the full PR2 pipeline (CLI flag → env var → server loader →
  // registry → API list) on every CI run.
  devPlugin = false,
} = {}) {
  const weAllocatedWorkDir = !workDir;
  const runDir = workDir ?? (await mkdtemp(path.join(os.tmpdir(), "mc-smoke-")));
  const resolvedLog = logFile ?? path.join(runDir, "launcher.log");
  await mkdir(runDir, { recursive: true });
  // Truncate log up-front so appends from a failed run don't leak.
  await writeFile(resolvedLog, "", "utf8");

  let tarballPath = null;
  let child = null;
  let succeeded = false;
  try {
    tarballPath = await packTarball({ root, packTimeoutMs });
    await installTarball({ workDir: runDir, tarballAbsolutePath: tarballPath, installTimeoutMs, root, packTimeoutMs });
    const sandboxCheck = await verifySandboxFiles({ workDir: runDir });
    if (!sandboxCheck.ok) {
      throw new Error(`sandbox build context missing from tarball: ${sandboxCheck.missing.join(", ")} (under ${sandboxCheck.checkedDir})`);
    }
    let devPluginExpected = null;
    let extraArgs = [];
    if (devPlugin) {
      const fixture = await makeDevPluginFixture({ workDir: runDir });
      devPluginExpected = fixture.name;
      extraArgs = ["--dev-plugin", fixture.absPath];
    }
    const resolvedPort = port ?? (await allocateRandomPort());
    const booted = await bootAndProbe({ workDir: runDir, port: resolvedPort, bootTimeoutMs, logFile: resolvedLog, extraArgs });
    child = booted.child;
    let pluginProbe = null;
    if (booted.probe.ok) {
      const token = await readTokenFromLauncherLog({ logFile: resolvedLog });
      pluginProbe = await probeRuntimePlugins({ port: resolvedPort, token, expectedDevPlugin: devPluginExpected });
    }
    const overallOk = booted.probe.ok && (pluginProbe?.ok ?? false);
    succeeded = overallOk;
    return {
      ok: overallOk,
      port: resolvedPort,
      attempts: booted.probe.attempts,
      elapsedMs: booted.probe.elapsedMs,
      lastError: overallOk ? null : (pluginProbe && !pluginProbe.ok ? `runtime plugin probe failed: ${pluginProbe.lastError}` : booted.probe.lastError),
      tarballPath,
      workDir: runDir,
      logFile: resolvedLog,
      pluginProbe,
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
      pluginProbe: null,
    };
  } finally {
    if (child) await killGracefully(child);
    if (succeeded && weAllocatedWorkDir) {
      await rm(runDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function main() {
  const result = await runTarballSmoke();
  if (result.ok) {
    console.log(`[mulmoclaude:tarball] OK — HTTP 200 on port ${result.port} after ${result.attempts} attempt(s) (${result.elapsedMs}ms); runtime plugins=${result.pluginProbe?.plugins ?? 0}`);
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
