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
} from "../../system/config.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { isRecord } from "../../utils/types.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import {
  loadCustomDirs,
  saveCustomDirs,
  ensureCustomDirs,
  validateCustomDirs,
  type CustomDirEntry,
} from "../../workspace/custom-dirs.js";
import {
  loadReferenceDirs,
  saveReferenceDirs,
  validateReferenceDirs,
  type ReferenceDirEntry,
} from "../../workspace/reference-dirs.js";

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
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.servers)) return false;
  // Full shape validation happens inside fromMcpEntries (throws on
  // anything malformed). Here we just confirm the envelope.
  return value.servers.every((e) => isRecord(e) && "id" in e && "spec" in e);
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
    badRequest(res, err instanceof Error ? err.message : "invalid mcp entries");
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
    serverError(res, err instanceof Error ? err.message : fallback);
    return false;
  }
}

const router = Router();

router.get(
  API_ROUTES.config.base,
  (_req: Request, res: Response<ConfigResponse>) => {
    res.json(buildFullResponse());
  },
);

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
  if (!isRecord(value)) return false;
  return isAppSettings(value.settings) && isMcpPutBody(value.mcp);
}

router.put(
  API_ROUTES.config.base,
  (req: Request<unknown, unknown, PutConfigBody>, res: ConfigRes) => {
    const body = req.body;
    if (!isPutConfigBody(body)) {
      badRequest(res, "Invalid config payload");
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
  API_ROUTES.config.settings,
  (req: Request<unknown, unknown, AppSettings>, res: ConfigRes) => {
    const body = req.body;
    if (!isAppSettings(body)) {
      badRequest(res, "Invalid AppSettings payload");
      return;
    }
    if (!runSaveOrFail(res, () => saveSettings(body), "saveSettings failed")) {
      return;
    }
    res.json(buildFullResponse());
  },
);

router.put(
  API_ROUTES.config.mcp,
  (
    req: Request<unknown, unknown, { servers: McpServerEntry[] }>,
    res: ConfigRes,
  ) => {
    const body = req.body;
    if (!isMcpPutBody(body)) {
      badRequest(res, "Invalid mcp payload envelope");
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

// ── Workspace custom directories (#239) ──────────────────────────

router.get(
  API_ROUTES.config.workspaceDirs,
  (_req: Request, res: Response<{ dirs: CustomDirEntry[] }>) => {
    res.json({ dirs: loadCustomDirs() });
  },
);

router.put(
  API_ROUTES.config.workspaceDirs,
  (
    req: Request<unknown, unknown, { dirs: unknown }>,
    res: Response<{ dirs: CustomDirEntry[] } | ConfigErrorResponse>,
  ) => {
    const body = req.body;
    if (!isRecord(body) || !("dirs" in body)) {
      badRequest(res, "expected { dirs: [...] }");
      return;
    }
    const result = validateCustomDirs(body.dirs);
    if ("error" in result) {
      badRequest(res, result.error);
      return;
    }
    try {
      saveCustomDirs(result.entries);
      ensureCustomDirs(result.entries);
      res.json({ dirs: result.entries });
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : "save failed");
    }
  },
);

// ── Reference directories (#455) ────────────────────────────────

router.get(
  API_ROUTES.config.referenceDirs,
  (_req: Request, res: Response<{ dirs: ReferenceDirEntry[] }>) => {
    res.json({ dirs: loadReferenceDirs() });
  },
);

router.put(
  API_ROUTES.config.referenceDirs,
  (
    req: Request<unknown, unknown, { dirs: unknown }>,
    res: Response<{ dirs: ReferenceDirEntry[] } | ConfigErrorResponse>,
  ) => {
    const body = req.body;
    if (!isRecord(body) || !("dirs" in body)) {
      badRequest(res, "expected { dirs: [...] }");
      return;
    }
    const result = validateReferenceDirs(body.dirs);
    if ("error" in result) {
      badRequest(res, result.error);
      return;
    }
    try {
      saveReferenceDirs(result.entries);
      res.json({ dirs: result.entries });
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : "save failed");
    }
  },
);

// ── Scheduler overrides (#493) ──────────────────────────────────

import {
  loadSchedulerOverrides,
  saveSchedulerOverrides,
  UTC_HH_MM_RE,
  type ScheduleOverrides,
} from "../../utils/files/scheduler-overrides-io.js";
import { applyScheduleOverride } from "../../events/scheduler-adapter.js";
import { SCHEDULE_TYPES } from "@receptron/task-scheduler";

router.get(
  API_ROUTES.config.schedulerOverrides,
  (_req: Request, res: Response<{ overrides: ScheduleOverrides }>) => {
    res.json({ overrides: loadSchedulerOverrides() });
  },
);

router.put(
  API_ROUTES.config.schedulerOverrides,
  async (
    req: Request<unknown, unknown, { overrides: unknown }>,
    res: Response<{ overrides: ScheduleOverrides } | ConfigErrorResponse>,
  ) => {
    const body = req.body;
    if (!isRecord(body) || !("overrides" in body)) {
      badRequest(res, "expected { overrides: { ... } }");
      return;
    }
    const raw = body.overrides;
    if (!isRecord(raw)) {
      badRequest(res, "overrides must be an object");
      return;
    }
    const overrides = raw as ScheduleOverrides;
    try {
      saveSchedulerOverrides(overrides);

      // Apply to running task-manager immediately
      for (const [taskId, ovr] of Object.entries(overrides)) {
        if (typeof ovr.intervalMs === "number" && ovr.intervalMs > 0) {
          await applyScheduleOverride(taskId, {
            type: SCHEDULE_TYPES.interval,
            intervalMs: ovr.intervalMs,
          });
        } else if (
          typeof ovr.time === "string" &&
          UTC_HH_MM_RE.test(ovr.time)
        ) {
          await applyScheduleOverride(taskId, {
            type: SCHEDULE_TYPES.daily,
            time: ovr.time,
          });
        }
      }

      res.json({ overrides: loadSchedulerOverrides() });
    } catch (err) {
      serverError(res, err instanceof Error ? err.message : "save failed");
    }
  },
);

export default router;
