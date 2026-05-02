// HTTP routes for runtime-loaded plugins (#1043 C-2).
//
//   GET  /api/plugins/runtime/list
//        → { plugins: [{ name, version, toolName, description }, …] }
//
//   POST /api/plugins/runtime/:pkg/dispatch
//        body: <args> directly — same convention as static plugin
//              endpoints (see server/api/routes/plugins.ts), so
//              mcp-server's generic `postJson(endpoint, args)` works
//              unchanged for runtime plugins.
//        → whatever the plugin's `execute()` returns (forwarded as JSON)
//
//   GET  /api/plugins/runtime/:pkg/:version/*
//        Static-mount of the extracted cache directory; the frontend
//        loader uses this for `import("/api/plugins/runtime/<pkg>/<ver>/dist/vue.js")`.
//
// The registry is owned by `server/plugins/runtime-registry.ts` and
// populated at boot from the install ledger. A 404 from any of these
// routes means the plugin isn't installed (or failed to load — see
// boot logs).

import path from "node:path";
import { realpathSync, promises as fsp } from "node:fs";
import { Router, type Request, type Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { getRuntimePlugins } from "../../plugins/runtime-registry.js";
import { notFound, serverError } from "../../utils/httpError.js";
import { errorMessage } from "../../utils/errors.js";
import { isRecord } from "../../utils/types.js";
import { resolveWithinRoot } from "../../utils/files/safe.js";
import { log } from "../../system/logger/index.js";

const LOG_PREFIX = "api/plugins/runtime";

const router = Router();

interface ListedPlugin {
  name: string;
  version: string;
  toolName: string;
  description: string;
  /** Absolute URL prefix the frontend uses for static-mount fetches. */
  assetBase: string;
}

router.get(API_ROUTES.plugins.runtimeList, (_req: Request, res: Response<{ plugins: ListedPlugin[] }>) => {
  const plugins = getRuntimePlugins().map<ListedPlugin>((entry) => ({
    name: entry.name,
    version: entry.version,
    toolName: entry.definition.name,
    description: entry.definition.description,
    assetBase: `/api/plugins/runtime/${encodeURIComponent(entry.name)}/${encodeURIComponent(entry.version)}`,
  }));
  res.json({ plugins });
});

router.post(API_ROUTES.plugins.runtimeDispatch, async (req: Request<{ pkg: string }>, res: Response) => {
  const pkg = decodeURIComponent(req.params.pkg);
  const plugin = getRuntimePlugins().find((entry) => entry.name === pkg);
  if (!plugin) {
    notFound(res, `runtime plugin "${pkg}" not registered`);
    return;
  }
  if (!plugin.execute) {
    serverError(res, `runtime plugin "${pkg}" has no execute() — the package's dist/index.js must export a function under "${plugin.definition.name}"`);
    return;
  }
  const args = isRecord(req.body) ? req.body : {};
  try {
    // gui-chat-protocol's ToolPluginCore.execute is
    // `(context: ToolContext, args) => Promise<ToolResult>`. The
    // server has no UI-side state to share, so context is an empty
    // object — but it MUST be the first arg, otherwise the plugin
    // destructures its args from `undefined` and the call fails with
    // "Cannot destructure property '<field>' of '<arg>' as it is
    // undefined".
    const context = {};
    const result = await plugin.execute(context, args);
    // Forward whatever the plugin returns as the response body
    // (mirrors static plugin routes — see plugins.ts). MCP server
    // spreads this into the toolResult event downstream.
    res.json(result);
  } catch (err) {
    log.error(LOG_PREFIX, "execute failed", { pkg, error: errorMessage(err) });
    serverError(res, `plugin execute failed: ${errorMessage(err)}`);
  }
});

// Static-mount of an installed plugin's directory. Resolution flow:
//
//   1. Look up `(pkg, version)` in the runtime registry. Presets and
//      user-installed plugins are both registered server-side, with
//      cachePath set from a trusted source (preset list or workspace
//      ledger). If the URL doesn't match any registered entry, 404 —
//      this is the trust boundary that prevents arbitrary-file reads
//      via percent-encoded `../` in `pkg` / `version` (the bearer-
//      auth exemption makes this an unauthenticated path).
//   2. realpath the registered cachePath. Symlinks inside the
//      extracted tree (e.g. dist/foo.js → /etc/passwd) cannot escape
//      because `resolveWithinRoot(rootReal, subPath)` rejects any
//      target that resolves outside the plugin's own root.
//
// The earlier "must be inside WORKSPACE_PATHS.pluginCache" anchor is
// gone — presets live under `node_modules/<pkg>/`, not in the
// workspace cache. The registry-membership check replaces that
// anchor: the registry is server-set, so its cachePath values are
// already trusted regardless of where on disk they point.
/** Look up a registered plugin and return the realpath of its root.
 *  Returns null when the (pkg, version) pair is not registered, when
 *  the cachePath does not exist on disk, or when realpath fails.
 *  Exported for tests. */
export function resolvePluginRoot(pkg: string, version: string): string | null {
  const plugin = getRuntimePlugins().find((entry) => entry.name === pkg && entry.version === version);
  if (!plugin) return null;
  try {
    return realpathSync(plugin.cachePath);
  } catch {
    return null;
  }
}

router.get(API_ROUTES.plugins.runtimeAsset, async (req: Request<{ pkg: string; version: string; splat?: string | string[] }>, res: Response) => {
  const pkg = decodeURIComponent(req.params.pkg);
  const version = decodeURIComponent(req.params.version);
  // Express 5 returns `splat` as `string[]` when the wildcard
  // matched multiple segments, `string` for a single segment, and
  // empty/undefined for an empty wildcard. Normalise to the joined
  // path so downstream `path.join` works on every shape.
  const rawSplat = req.params.splat;
  const subPath = Array.isArray(rawSplat) ? rawSplat.join("/") : (rawSplat ?? "");
  const rootReal = resolvePluginRoot(pkg, version);
  if (!rootReal) {
    notFound(res, "asset not found");
    return;
  }
  const resolved = resolveWithinRoot(rootReal, subPath);
  if (!resolved) {
    notFound(res, "asset not found");
    return;
  }
  try {
    const data = await fsp.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const contentType = contentTypeFor(ext);
    res.setHeader("Content-Type", contentType);
    res.send(data);
  } catch (err) {
    log.error(LOG_PREFIX, "asset read failed", { pkg, version, subPath, error: errorMessage(err) });
    serverError(res, "asset read failed");
  }
});

function contentTypeFor(ext: string): string {
  switch (ext) {
    case ".js":
    case ".mjs":
    case ".cjs":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".map":
      return "application/json; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

export default router;
