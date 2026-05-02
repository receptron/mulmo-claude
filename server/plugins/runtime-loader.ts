// Runtime plugin loader (#1043 C-2).
//
// At server boot:
//   1. Read the install ledger (`plugins/plugins.json`).
//   2. For each entry, ensure the tgz is extracted to
//      `plugins/.cache/<name>/<version>/` (cache hit = skip).
//   3. Dynamic-import the plugin's `dist/index.js` to pull out
//      `TOOL_DEFINITION`. The plugin module is bundled (per the
//      contract documented in `docs/plugin-development.md`) so its
//      bare imports resolve against the on-disk chunk siblings, not
//      against a non-existent `node_modules/` underneath the cache.
//
// This module is called from BOTH the parent server (`server/index.ts`)
// and the spawned MCP child (`server/agent/mcp-server.ts`) — they share
// the cache, so the second call is fast (no re-extract).
//
// Failures don't abort boot. A bad ledger entry, missing tgz, or a
// definition that fails to import gets logged and skipped; healthy
// plugins still load.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolDefinition } from "gui-chat-protocol";
import { WORKSPACE_PATHS } from "../workspace/paths.js";
import { readLedger, type LedgerEntry } from "../utils/files/plugins-io.js";
import { log } from "../system/logger/index.js";

const LOG_PREFIX = "plugins/runtime";

export interface RuntimePlugin {
  /** npm package name, e.g. `@gui-chat-plugin/weather`. */
  name: string;
  /** Semver string from the tgz's `package.json`. */
  version: string;
  /** Absolute path to the extracted plugin directory under
   *  `plugins/.cache/<name>/<version>/`. */
  cachePath: string;
  /** TOOL_DEFINITION export from the plugin's `dist/index.js`. The
   *  shape matches static plugins in `plugin-names.ts`, so the same
   *  MCP merge / dispatch path applies. */
  definition: ToolDefinition;
  /** Server-side handler the dispatch route calls. The convention
   *  across @gui-chat-plugin packages is to export it under the same
   *  key as `TOOL_DEFINITION.name` (e.g. weather → `fetchWeather`,
   *  browse → `browse`); we capture it at load time so the dispatch
   *  route doesn't have to re-resolve. The signature follows
   *  gui-chat-protocol's `ToolPluginCore.execute`:
   *  `(context: ToolContext, args) => Promise<ToolResult>` — context
   *  first, args second. `null` means the module shipped a
   *  TOOL_DEFINITION but no matching handler — the dispatch will 500
   *  with a useful message. */
  execute: ((context: unknown, args: unknown) => unknown) | null;
}

interface PackageJson {
  name?: string;
  version?: string;
  exports?: Record<string, unknown>;
  main?: string;
  module?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isToolDefinition = (value: unknown): value is ToolDefinition => {
  if (!isRecord(value)) return false;
  return typeof value.name === "string" && typeof value.description === "string";
};

/** Resolve the entry-point path from a plugin's `package.json`. Falls
 *  through `exports["."].import` → `module` → `main` so we cover both
 *  the modern `exports` shape and legacy `main`-only packages. */
function resolveEntrySpecifier(pkg: PackageJson): string | null {
  const root = pkg.exports?.["."];
  if (isRecord(root) && typeof root.import === "string") return root.import;
  if (typeof pkg.module === "string") return pkg.module;
  if (typeof pkg.main === "string") return pkg.main;
  return null;
}

/** Sentinel file written at the end of a successful extract. The
 *  loader uses its presence (not just `existsSync(cachePath)`) as the
 *  cache-validity check, so a partial extract (interrupted tar, ENOSPC
 *  half-write) is detected and re-extracted on the next boot instead
 *  of becoming a permanent broken state. */
export const EXTRACT_MARKER = ".extract-complete";

export function isCacheValid(cachePath: string): boolean {
  return existsSync(path.join(cachePath, EXTRACT_MARKER));
}

/** Run `tar xzf` to extract a tgz into the version-keyed cache slot.
 *  `--strip-components=1` drops the `package/` prefix that npm packs
 *  add. `execFileSync` (not `execSync`) so paths bypass shell parsing
 *  and never trip on metacharacters in workspace paths. Synchronous
 *  because boot is single-threaded and the alternative (a stream
 *  pipeline) adds dependencies for no benefit.
 *
 *  On failure, the partial directory is removed so the next boot
 *  re-extracts cleanly (no sticky broken state). The completion
 *  marker is written ONLY after tar exits 0 — readers should test
 *  `isCacheValid()`, not `existsSync(cachePath)`. */
function extractTgz(tgzAbs: string, destDir: string): void {
  // Wipe any leftover from a previous failed extract before writing.
  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  try {
    execFileSync("tar", ["-xzf", tgzAbs, "-C", destDir, "--strip-components=1"], { stdio: "pipe" });
    writeFileSync(path.join(destDir, EXTRACT_MARKER), "");
  } catch (err) {
    // Tear down the partial tree so isCacheValid() stays false next boot.
    try {
      rmSync(destDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}

function readPackageJson(cachePath: string): PackageJson | null {
  const pkgPath = path.join(cachePath, "package.json");
  try {
    return JSON.parse(readFileSync(pkgPath, "utf-8")) as PackageJson;
  } catch (err) {
    log.warn(LOG_PREFIX, "package.json read/parse failed", { path: pkgPath, error: String(err) });
    return null;
  }
}

/** Load a plugin from an already-extracted cache directory. Pure
 *  function — accepts paths explicitly, so tests don't need a real
 *  workspace. Returns null on any structural failure (missing
 *  package.json, missing TOOL_DEFINITION, broken import); the caller
 *  treats nulls as "skip". */
export async function loadPluginFromCacheDir(name: string, version: string, cachePath: string): Promise<RuntimePlugin | null> {
  const pkg = readPackageJson(cachePath);
  if (!pkg) return null;
  const entrySpec = resolveEntrySpecifier(pkg);
  if (!entrySpec) {
    log.warn(LOG_PREFIX, "no entry specifier in package.json — skipping", { name });
    return null;
  }
  const entryAbs = path.join(cachePath, entrySpec);
  try {
    const mod = (await import(pathToFileURL(entryAbs).href)) as Record<string, unknown>;
    const definition = mod.TOOL_DEFINITION;
    if (!isToolDefinition(definition)) {
      log.warn(LOG_PREFIX, "no TOOL_DEFINITION export — skipping", { name, entrySpec });
      return null;
    }
    // The @gui-chat-plugin convention: the server-side handler is
    // exported under the same key as `TOOL_DEFINITION.name` (weather
    // → `fetchWeather`, browse → `browse`, camera → `takePhoto`).
    // Captured here so the dispatch route doesn't have to re-import
    // the module on every call. A missing handler is non-fatal — the
    // plugin still appears in tools/list but the dispatch will fail
    // with a clear server log + 500.
    const handler = mod[definition.name];
    const execute = typeof handler === "function" ? (handler as (context: unknown, args: unknown) => unknown) : null;
    if (!execute) {
      log.warn(LOG_PREFIX, "no execute handler matching TOOL_DEFINITION.name — dispatch will fail", { name, expectedExport: definition.name });
    }
    return { name, version, cachePath, definition, execute };
  } catch (err) {
    log.error(LOG_PREFIX, "import failed", { name, entrySpec, error: String(err) });
    return null;
  }
}

/** Lexical anchor: confirm `candidate` resolves inside `base`. Catches
 *  malformed ledger entries (`name` containing `../../etc`) before we
 *  touch the disk. The asset route trusts registry membership, so a
 *  registered cachePath that escaped the base would expose arbitrary
 *  files via the unauthenticated GET — this check is the first
 *  line of defence (defence-in-depth: realpath after extract is the
 *  symlink-escape backstop). Exported for testing. */
export function ensureInsideBase(candidate: string, base: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedBase = path.resolve(base);
  return resolvedCandidate === resolvedBase || resolvedCandidate.startsWith(resolvedBase + path.sep);
}

async function loadOne(entry: LedgerEntry): Promise<RuntimePlugin | null> {
  const tgzAbs = path.join(WORKSPACE_PATHS.plugins, entry.tgz);
  const cachePath = path.join(WORKSPACE_PATHS.pluginCache, entry.name, entry.version);
  // Anchor checks BEFORE any disk probe (`existsSync` / `realpath`).
  // The ledger has two separate user-controlled fields — `tgz` and
  // (`name`, `version`) — and each joins against a different base
  // (`WORKSPACE_PATHS.plugins` vs. `pluginCache`). Both must stay
  // inside their respective bases; otherwise even a stat-only probe
  // would touch a path outside the intended roots.
  if (!ensureInsideBase(tgzAbs, WORKSPACE_PATHS.plugins)) {
    log.warn(LOG_PREFIX, "ledger entry tgz escapes plugins root — skipping", { name: entry.name, tgz: entry.tgz });
    return null;
  }
  if (!ensureInsideBase(cachePath, WORKSPACE_PATHS.pluginCache)) {
    log.warn(LOG_PREFIX, "ledger entry escapes plugin cache root — skipping", {
      name: entry.name,
      version: entry.version,
    });
    return null;
  }
  if (!existsSync(tgzAbs)) {
    log.warn(LOG_PREFIX, "tgz missing — skipping", { name: entry.name, tgz: entry.tgz });
    return null;
  }
  if (!isCacheValid(cachePath)) {
    try {
      extractTgz(tgzAbs, cachePath);
      log.info(LOG_PREFIX, "extracted", { name: entry.name, version: entry.version });
    } catch (err) {
      log.error(LOG_PREFIX, "extract failed", { name: entry.name, error: String(err) });
      return null;
    }
  }
  return loadPluginFromCacheDir(entry.name, entry.version, cachePath);
}

/** Read the ledger and load every healthy plugin. Returns the loaded
 *  set; failures are logged and silently skipped (see module
 *  comment). */
export async function loadRuntimePlugins(): Promise<RuntimePlugin[]> {
  const entries = readLedger();
  if (entries.length === 0) return [];
  const loaded: RuntimePlugin[] = [];
  for (const entry of entries) {
    const plugin = await loadOne(entry);
    if (plugin) loaded.push(plugin);
  }
  log.info(LOG_PREFIX, "loaded", { requested: entries.length, succeeded: loaded.length });
  return loaded;
}
