// Preset plugin loader (#1043 C-2 follow-up).
//
// Reads `config/preset-plugins.ts` at boot and resolves each entry
// against the project's `node_modules/<pkg>/` — already extracted by
// `yarn install`, so no tgz unpack step. The result is the same
// `RuntimePlugin` shape that user-installed plugins produce, so both
// flows share the runtime registry, the dispatch route, and the
// asset route.
//
// Failures don't abort boot. A missing preset (yarn install drift,
// rare) logs a warning; healthy presets still register.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRESET_PLUGINS } from "./preset-list.js";
import { ensureInsideBase, loadPluginFromCacheDir, type RuntimePlugin } from "./runtime-loader.js";
import { log } from "../system/logger/index.js";

const LOG_PREFIX = "plugins/preset";

// `server/plugins/preset-loader.ts` → up two levels = repo root.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const NODE_MODULES = path.join(PROJECT_ROOT, "node_modules");

interface PackageJsonShape {
  version?: string;
}

async function loadOnePreset(packageName: string): Promise<RuntimePlugin | null> {
  const cachePath = path.join(NODE_MODULES, packageName);
  // Same defence-in-depth as the user-installed loader: a preset list
  // entry like `"../../etc"` would otherwise escape the node_modules
  // base. Presets are server-controlled today, but the check is cheap
  // and keeps the asset-route trust model uniform across both loaders.
  if (!ensureInsideBase(cachePath, NODE_MODULES)) {
    log.warn(LOG_PREFIX, "preset entry escapes node_modules — skipping", { packageName });
    return null;
  }
  if (!existsSync(cachePath)) {
    log.warn(LOG_PREFIX, "preset package missing from node_modules — run `yarn install`?", { packageName });
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

/** Load every preset declared in `config/preset-plugins.ts`. Returns
 *  the loaded set; failures are logged and silently skipped. */
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
