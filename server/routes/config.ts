import { Router, type Request, type Response } from "express";
import {
  fromMcpEntries,
  isAppSettings,
  loadMcpConfig,
  loadSettings,
  saveMcpConfig,
  saveSettings,
  toMcpEntries,
  type AppSettings,
  type McpConfigFile,
  type McpServerEntry,
} from "../config.js";

// Public surface of /api/config. GET returns the full config tree so
// the client can render every section in one request. PUT surfaces are
// per-section to keep payloads small and validation obvious.
export interface ConfigResponse {
  settings: AppSettings;
  mcp: { servers: McpServerEntry[] };
}

export interface ConfigErrorResponse {
  error: string;
}

type ConfigRes = Response<ConfigResponse | ConfigErrorResponse>;

function buildFullResponse(): ConfigResponse {
  return {
    settings: loadSettings(),
    mcp: { servers: toMcpEntries(loadMcpConfig()) },
  };
}

function isMcpPutBody(value: unknown): value is { servers: McpServerEntry[] } {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  if (!Array.isArray(c.servers)) return false;
  // Full shape validation happens inside fromMcpEntries (throws on
  // anything malformed). Here we just confirm the envelope.
  return c.servers.every(
    (e) => typeof e === "object" && e !== null && "id" in e && "spec" in e,
  );
}

// Uniform error responder: prefer the exception's message (useful to
// the client) and fall back to a static label. Used for every failure
// path in this router to keep the JSON shape consistent.
function sendError(
  res: ConfigRes,
  status: number,
  err: unknown,
  fallback: string,
): void {
  res.status(status).json({
    error: err instanceof Error ? err.message : fallback,
  });
}

// Parse an MCP payload through `fromMcpEntries` (which does the full
// shape validation and throws on anything malformed). On failure,
// respond 400 and return null so the caller can early-return.
function parseMcpPayloadOrFail(
  res: ConfigRes,
  servers: McpServerEntry[],
): McpConfigFile | null {
  try {
    return fromMcpEntries(servers);
  } catch (err) {
    sendError(res, 400, err, "invalid mcp entries");
    return null;
  }
}

// Run a filesystem save. On failure, respond 500 with the error's
// message and return false so the caller can early-return. Returns
// true on success.
function runSaveOrFail(
  res: ConfigRes,
  save: () => void,
  fallback: string,
): boolean {
  try {
    save();
    return true;
  } catch (err) {
    sendError(res, 500, err, fallback);
    return false;
  }
}

const router = Router();

router.get("/config", (_req: Request, res: Response<ConfigResponse>) => {
  res.json(buildFullResponse());
});

// Atomic save for both settings and MCP. Validates both payloads first
// (no writes happen until every input is known-good), then writes
// settings and captures the previous state so a subsequent saveMcpConfig
// failure can roll back. This is the endpoint the Settings modal should
// use; the per-section PUTs below remain for targeted updates.
interface PutConfigBody {
  settings: AppSettings;
  mcp: { servers: McpServerEntry[] };
}

function isPutConfigBody(value: unknown): value is PutConfigBody {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return isAppSettings(c.settings) && isMcpPutBody(c.mcp);
}

router.put(
  "/config",
  (req: Request<unknown, unknown, PutConfigBody>, res: ConfigRes) => {
    const body = req.body;
    if (!isPutConfigBody(body)) {
      res.status(400).json({ error: "Invalid config payload" });
      return;
    }
    const mcpCfg = parseMcpPayloadOrFail(res, body.mcp.servers);
    if (!mcpCfg) return;

    // Snapshot previous settings so we can roll back if the second
    // write fails — a cross-file atomic write isn't possible, but
    // rollback keeps the pair consistent from the user's perspective.
    const previousSettings = loadSettings();
    if (
      !runSaveOrFail(
        res,
        () => saveSettings(body.settings),
        "saveSettings failed",
      )
    ) {
      return;
    }
    if (
      !runSaveOrFail(res, () => saveMcpConfig(mcpCfg), "saveMcpConfig failed")
    ) {
      // Best-effort rollback; if it fails too, the original mcp error
      // is already on the wire.
      try {
        saveSettings(previousSettings);
      } catch {
        /* swallow — original error already sent */
      }
      return;
    }
    res.json(buildFullResponse());
  },
);

router.put(
  "/config/settings",
  (req: Request<unknown, unknown, AppSettings>, res: ConfigRes) => {
    const body = req.body;
    if (!isAppSettings(body)) {
      res.status(400).json({ error: "Invalid AppSettings payload" });
      return;
    }
    if (!runSaveOrFail(res, () => saveSettings(body), "saveSettings failed")) {
      return;
    }
    res.json(buildFullResponse());
  },
);

router.put(
  "/config/mcp",
  (
    req: Request<unknown, unknown, { servers: McpServerEntry[] }>,
    res: ConfigRes,
  ) => {
    const body = req.body;
    if (!isMcpPutBody(body)) {
      res.status(400).json({ error: "Invalid mcp payload envelope" });
      return;
    }
    // fromMcpEntries rejects malformed client input (400). saveMcpConfig
    // can fail for server-side reasons like disk/permission errors (500).
    const cfg = parseMcpPayloadOrFail(res, body.servers);
    if (!cfg) return;
    if (!runSaveOrFail(res, () => saveMcpConfig(cfg), "saveMcpConfig failed")) {
      return;
    }
    res.json(buildFullResponse());
  },
);

export default router;
