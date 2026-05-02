// Preset plugin loader (#1043 C-2 follow-up).
//
// Reads `server/plugins/preset-list.ts` at boot and resolves each
// entry against the package's installed location via Node's standard
// module-resolution (`import.meta.resolve`). The package is already
// laid out by `npm install` / `yarn install`; no tgz unpack step.
// The result is the same `RuntimePlugin` shape user-installed plugins
// produce, so both flows share the runtime registry, the dispatch
// route, and the asset route.
//
// Why not a hardcoded `node_modules/<pkg>` join: yarn workspaces
// hoist deps to the repo root, so the launcher sees the package in
// `<repo>/node_modules/...` while `<repo>/packages/mulmoclaude/node_modules/`
// is empty. `import.meta.resolve` walks the same way Node does at
// runtime, so it finds the package wherever the package manager put
// it. (npm's flat install doesn't have this issue — it lands under
// `<package>/node_modules/...` directly. Both work with the same
// resolver call.)
//
// Trust model: the package name comes from the server-side hardcoded
// preset list, not from user input. We trust the resolved path
// without an `ensureInsideBase` anchor because there is no base —
// the resolver returns wherever the package manager chose. The asset
// route's `realpathSync(plugin.cachePath)` still pins to whatever was
// resolved here at registration time; a route caller cannot redirect
// to a different path via URL params.
//
// Failures don't abort boot. A missing preset (install drift, rare)
// logs a warning; healthy presets still register.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRESET_PLUGINS } from "./preset-list.js";
import { loadPluginFromCacheDir, type RuntimePlugin } from "./runtime-loader.js";
import { log } from "../system/logger/index.js";

const LOG_PREFIX = "plugins/preset";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PackageJsonShape {
  version?: string;
}

/** Resolve the on-disk root of a preset package by walking up from
 *  this file looking for `<dir>/node_modules/<pkg>/`. Mirrors Node's
 *  CommonJS resolution algorithm so it works in every layout the
 *  installer might choose:
 *
 *    - yarn workspaces: deps hoisted to the repo root's `node_modules`
 *    - npm flat install: package's `node_modules` directly
 *    - npm nested install: under a parent package's `node_modules`
 *
 *  Why not `import.meta.resolve('<pkg>/package.json')`: many packages
 *  (including `@gui-chat-plugin/*`) ship an `exports` field that
 *  doesn't expose `./package.json`, so the ESM resolver throws
 *  `ERR_PACKAGE_PATH_NOT_EXPORTED`. The walk-up sidesteps the
 *  exports gate entirely. */
function resolvePresetRoot(packageName: string): string | null {
  let dir = __dirname;
  while (true) {
    const candidate = path.join(dir, "node_modules", packageName);
    if (existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function loadOnePreset(packageName: string): Promise<RuntimePlugin | null> {
  const cachePath = resolvePresetRoot(packageName);
  if (!cachePath) {
    log.warn(LOG_PREFIX, "preset package not resolvable — run `yarn install`?", { packageName });
    return null;
  }
  const pkgJsonPath = path.join(cachePath, "package.json");
  let pkg: PackageJsonShape;
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as PackageJsonShape;
  } catch (err) {
    log.warn(LOG_PREFIX, "preset package.json read/parse failed", { packageName, error: String(err) });
    return null;
  }
  const { version } = pkg;
  if (typeof version !== "string" || version.length === 0) {
    log.warn(LOG_PREFIX, "preset package has no version", { packageName });
    return null;
  }
  return loadPluginFromCacheDir(packageName, version, cachePath);
}

/** Load every preset declared in `server/plugins/preset-list.ts`.
 *  Returns the loaded set; failures are logged and silently
 *  skipped. */
export async function loadPresetPlugins(): Promise<RuntimePlugin[]> {
  if (PRESET_PLUGINS.length === 0) return [];
  const loaded: RuntimePlugin[] = [];
  for (const entry of PRESET_PLUGINS) {
    const plugin = await loadOnePreset(entry.packageName);
    if (plugin) loaded.push(plugin);
  }
  log.info(LOG_PREFIX, "loaded", { requested: PRESET_PLUGINS.length, succeeded: loaded.length });
  return loaded;
}
