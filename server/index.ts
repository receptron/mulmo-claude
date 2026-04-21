import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import agentRoutes from "./api/routes/agent.js";
import todosRoutes from "./api/routes/todos.js";
import schedulerRoutes from "./api/routes/scheduler.js";
import sessionsRoutes from "./api/routes/sessions.js";
import chatIndexRoutes from "./api/routes/chat-index.js";
import sourcesRoutes from "./api/routes/sources.js";
import pluginsRoutes from "./api/routes/plugins.js";
import imageRoutes from "./api/routes/image.js";
import presentHtmlRoutes from "./api/routes/presentHtml.js";
import chartRoutes from "./api/routes/chart.js";
import rolesRoutes from "./api/routes/roles.js";
import { DEFAULT_ROLE_ID } from "../src/config/roles.js";
import mulmoScriptRoutes from "./api/routes/mulmo-script.js";
import wikiRoutes from "./api/routes/wiki.js";
import pdfRoutes from "./api/routes/pdf.js";
import filesRoutes from "./api/routes/files.js";
import configRoutes from "./api/routes/config.js";
import skillsRoutes from "./api/routes/skills.js";
import { createNotificationsRouter } from "./api/routes/notifications.js";
import {
  type NotificationDeps,
  initNotifications,
} from "./events/notifications.js";
import { createChatService } from "@mulmobridge/chat-service";
import { loadAllSessions } from "./api/routes/sessions.js";
import { readSessionJsonl } from "./utils/files/session-io.js";
import { onSessionEvent } from "./events/session-store/index.js";
import { getRole, loadAllRoles } from "./workspace/roles.js";
import { WORKSPACE_PATHS } from "./workspace/paths.js";
import { serverError } from "./utils/httpError.js";
import {
  mcpToolsRouter,
  mcpTools,
  isMcpToolEnabled,
} from "./agent/mcp-tools/index.js";
import { initWorkspace, workspacePath } from "./workspace/workspace.js";
import { env, isGeminiAvailable } from "./system/env.js";
import { buildSandboxStatus } from "./api/sandboxStatus.js";
import fs from "fs";
import os from "os";
import {
  isDockerAvailable,
  ensureSandboxImage,
  getDockerBridgeIp,
} from "./system/docker.js";
import { maybeRunJournal } from "./workspace/journal/index.js";
import { backfillAllSessions } from "./workspace/chat-index/index.js";
import { createPubSub } from "./events/pub-sub/index.js";
import { PUBSUB_CHANNELS } from "../src/config/pubsubChannels.js";
import { createTaskManager } from "./events/task-manager/index.js";
import type { ITaskManager } from "./events/task-manager/index.js";
import {
  initScheduler,
  type SystemTaskDef,
} from "./events/scheduler-adapter.js";
import schedulerTasksRoutes from "./api/routes/schedulerTasks.js";
import {
  loadSchedulerOverrides,
  UTC_HH_MM_RE,
} from "./utils/files/scheduler-overrides-io.js";
import type { IPubSub } from "./events/pub-sub/index.js";
import { initSessionStore } from "./events/session-store/index.js";
import { requireSameOrigin } from "./api/csrfGuard.js";
import { bearerAuth } from "./api/auth/bearerAuth.js";
import {
  deleteTokenFile,
  generateAndWriteToken,
  getCurrentToken,
} from "./api/auth/token.js";
import { log } from "./system/logger/index.js";
import { startChat } from "./api/routes/agent.js";
import { registerScheduledSkills } from "./workspace/skills/scheduler.js";
import { registerUserTasks } from "./workspace/skills/user-tasks.js";
import { API_ROUTES } from "../src/config/apiRoutes.js";
import { EVENT_TYPES } from "../src/types/events.js";
import { SESSION_ORIGINS } from "../src/types/session.js";
import { ONE_SECOND_MS, ONE_MINUTE_MS, ONE_HOUR_MS } from "./utils/time.js";
import { SCHEDULE_TYPES, MISSED_RUN_POLICIES } from "@receptron/task-scheduler";

const HTML_TOKEN_PLACEHOLDER = "__MULMOCLAUDE_AUTH_TOKEN__";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const debugMode = process.argv.includes("--debug");

initWorkspace();

let sandboxEnabled = false;

const app = express();
const PORT = env.port;

app.disable("x-powered-by");
// No `cors()` middleware. The Vite dev proxy forwards `/api/*`
// from :5173 to :3001 server-side, and in production Express
// serves the built client from the same origin, so every
// legitimate request is same-origin and doesn't need CORS
// headers at all. Dropping the middleware means a page at
// `http://evil.example` can still send a request to
// `localhost:3001` but the browser refuses to expose the
// response to the calling script (no
// `Access-Control-Allow-Origin` header). See
// plans/done/fix-server-lockdown-cors-localhost.md for the threat
// model.
app.use(express.json({ limit: "50mb" }));
// CSRF guard: reject state-changing requests that arrive with a
// non-localhost Origin header. Allows missing Origin (server-to-
// server / CLI callers) because the listener is already bound to
// localhost (#148); if that ever changes, tighten this middleware
// too. See plans/done/fix-server-csrf-origin-check.md.
app.use(requireSameOrigin);

// Bearer token auth: every `/api/*` request must carry
// `Authorization: Bearer <token>` matching the per-startup token.
// Layered *on top of* CSRF guard so we catch both cross-origin
// browser attacks (origin check) and local sibling processes that
// bypass browser CORS (bearer check). See #272 and
// plans/feat-bearer-token-auth.md.
//
// /api/files/* is exempt because <img src="/api/files/raw?path=...">
// tags in rendered markdown can't attach Authorization headers.
// The CSRF origin check + loopback-only binding still apply.
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/files/")) return next();
  bearerAuth(req, res, next);
});

app.get(API_ROUTES.health, (_req: Request, res: Response) => {
  res.json({
    status: "OK",
    geminiAvailable: isGeminiAvailable(),
    sandboxEnabled,
  });
});

// Sandbox credential-forwarding state (#329). Returns `{}` when the
// sandbox is disabled — the popup already renders a distinct
// "No sandbox" branch in that case and extra fields would be noise.
// When enabled, returns `{ sshAgent, mounts }`; full debug detail
// (host paths, skip reasons, unknown names) stays in the server log.
app.get(API_ROUTES.sandbox, (_req: Request, res: Response) => {
  const status = buildSandboxStatus({
    sandboxEnabled,
    sshAgentForward: env.sandboxSshAgentForward,
    configMountNames: env.sandboxMountConfigs,
    sshAuthSock: process.env.SSH_AUTH_SOCK,
  });
  res.json(status ?? {});
});

// Routers register FULL `/api/...` paths internally (see
// `src/config/apiRoutes.ts`), so they mount at root. The previous
// `app.use("/api", ...)` prefix was dropped when #289 part 1 moved
// the `/api` literal into each `router.post(API_ROUTES.…)` call.
app.use(agentRoutes);
app.use(todosRoutes);
app.use(schedulerRoutes);
app.use(sessionsRoutes);
app.use(chatIndexRoutes);
app.use(sourcesRoutes);
app.use(pluginsRoutes);
app.use(imageRoutes);
app.use(presentHtmlRoutes);
app.use(chartRoutes);
app.use(rolesRoutes);
app.use(mulmoScriptRoutes);
app.use(wikiRoutes);
app.use(pdfRoutes);
app.use(filesRoutes);
app.use(configRoutes);
app.use(skillsRoutes);
async function listSessionsForBridge(opts: { limit: number; offset: number }) {
  const rows = await loadAllSessions();
  const sorted = rows.sort((a, b) => b.changeMs - a.changeMs);
  const total = sorted.length;
  const sessions = sorted
    .slice(opts.offset, opts.offset + opts.limit)
    .map((r) => ({
      id: r.summary.id,
      roleId: r.summary.roleId,
      preview: r.summary.preview,
      updatedAt: r.summary.updatedAt,
    }));
  return { sessions, total };
}
async function getSessionHistoryForBridge(
  sessionId: string,
  opts: { limit: number; offset: number },
) {
  const content = await readSessionJsonl(sessionId);
  if (!content) return { messages: [], total: 0 };
  const allMessages: Array<{ source: string; text: string }> = [];
  const lines = content.split("\n").filter(Boolean);
  // Collect all text events newest-first
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (
        entry.type === EVENT_TYPES.text &&
        typeof entry.message === "string"
      ) {
        allMessages.push({
          source: entry.source ?? "unknown",
          text: entry.message,
        });
      }
    } catch {
      // skip malformed lines
    }
  }
  const total = allMessages.length;
  const messages = allMessages.slice(opts.offset, opts.offset + opts.limit);
  return { messages, total };
}
const chatService = createChatService({
  startChat,
  onSessionEvent,
  loadAllRoles,
  getRole,
  defaultRoleId: DEFAULT_ROLE_ID,
  transportsDir: WORKSPACE_PATHS.transports,
  logger: log,
  // Socket.io handshake (see #268 Phase A) needs to validate the
  // same bearer token the HTTP middleware enforces.
  tokenProvider: getCurrentToken,
  listSessions: listSessionsForBridge,
  getSessionHistory: getSessionHistoryForBridge,
});
app.use(chatService.router);

// Notifications router. The route file needs the pub-sub publisher
// (only created inside `startRuntimeServices` after `app.listen`) and
// the chat-service push handle (available at module scope). We mount
// the router now so it sits behind the same bearer middleware as
// every other /api route, and back-fill the pub-sub dep once
// `startRuntimeServices` has it. Calls that arrive before fill-in
// (impossible in practice — the HTTP server isn't listening yet)
// would no-op on publish but still queue the bridge push.
const notificationDeps: NotificationDeps = {
  publish: () => {
    /* replaced by startRuntimeServices */
  },
  pushToBridge: chatService.pushToBridge,
};
app.use(createNotificationsRouter(notificationDeps));
app.use(mcpToolsRouter);
app.use(schedulerTasksRoutes);

if (env.isProduction) {
  // `{ index: false }` so express.static doesn't intercept `GET /`
  // with the built index.html. We need our own handler that reads
  // the file and substitutes the bearer token placeholder on each
  // request — see the `app.get("*")` fallback below.
  app.use(express.static(path.join(__dirname, "../client"), { index: false }));
  const indexHtmlPath = path.join(__dirname, "../client/index.html");
  app.get("*", (_req: Request, res: Response) => {
    let html: string;
    try {
      html = fs.readFileSync(indexHtmlPath, "utf-8");
    } catch (err) {
      log.error("server", "failed to read index.html", { error: String(err) });
      serverError(res, "Internal Server Error");
      return;
    }
    const token = getCurrentToken() ?? "";
    html = html.replace(HTML_TOKEN_PLACEHOLDER, token);
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });
}

app.use((err: Error, _req: Request, res: Response, __next: NextFunction) => {
  log.error("express", "unhandled error", {
    error: err.message,
    stack: err.stack,
  });
  serverError(res, "Internal Server Error");
});

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    // Probe the same interface we'll actually bind to so a port
    // held by a different process on a different interface doesn't
    // give us a false "free" reading.
    server.listen(port, "127.0.0.1");
  });
}

async function ensureCredentialsAvailable(): Promise<void> {
  const credentialsPath = path.join(
    os.homedir(),
    ".claude",
    ".credentials.json",
  );
  if (fs.existsSync(credentialsPath)) return;

  if (process.platform === "darwin") {
    const { refreshCredentials } = await import("./system/credentials.js");
    const ok = await refreshCredentials();
    if (ok) return;
    log.error(
      "sandbox",
      "Failed to export credentials from macOS Keychain. Run `npm run sandbox:login` manually.",
    );
    process.exit(1);
  }
  log.error(
    "sandbox",
    "Missing credentials file at ~/.claude/.credentials.json. Run `claude auth login` to authenticate Claude Code.",
  );
  process.exit(1);
}

async function setupSandbox(): Promise<boolean> {
  if (env.disableSandbox) {
    log.info(
      "sandbox",
      "DISABLE_SANDBOX=1 — running unrestricted (debug mode)",
    );
    return false;
  }
  try {
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      log.info("sandbox", "Docker not found — claude will run unrestricted");
      return false;
    }
    await ensureCredentialsAvailable();
    log.info("sandbox", "Docker available — building sandbox image if needed");
    await ensureSandboxImage();
    log.info("sandbox", "Sandbox ready");
    return true;
  } catch (err) {
    log.error("sandbox", "Failed to set up sandbox, running unrestricted", {
      error: String(err),
    });
    return false;
  }
}

function logMcpStatus(): void {
  const enabledMcpTools = mcpTools.filter(isMcpToolEnabled);
  const disabledMcpTools = mcpTools.filter((t) => !isMcpToolEnabled(t));
  if (enabledMcpTools.length > 0) {
    log.info("mcp", "Available", {
      tools: enabledMcpTools.map((t) => t.definition.name).join(", "),
    });
  }
  if (disabledMcpTools.length > 0) {
    const names = disabledMcpTools
      .map(
        (t) =>
          t.definition.name + " (" + (t.requiredEnv ?? []).join(", ") + ")",
      )
      .join(", ");
    log.info("mcp", "Unavailable (missing env)", { tools: names });
  }
}

function maybeForceJournalRun(): void {
  // Debug switch: set JOURNAL_FORCE_RUN_ON_STARTUP=1 to run a full
  // journal pass immediately without waiting for a session end or
  // the hourly interval. Fire-and-forget — journal errors never
  // propagate out of maybeRunJournal.
  if (!env.journalForceRunOnStartup) return;
  log.info("journal", "JOURNAL_FORCE_RUN_ON_STARTUP=1 — running now");
  maybeRunJournal({ force: true }).catch((err) => {
    log.warn("journal", "forced startup run failed", { error: String(err) });
  });
}

function maybeForceChatIndexBackfill(): void {
  // Companion switch for the chat indexer: force-rebuild every
  // session's title summary on startup. Useful the first time the
  // feature is rolled out over an existing workspace, or when
  // debugging the indexer itself.
  if (!env.chatIndexForceRunOnStartup) return;
  log.info("chat-index", "CHAT_INDEX_FORCE_RUN_ON_STARTUP=1 — running now");
  backfillAllSessions()
    .then((result) => {
      log.info("chat-index", "startup backfill complete", {
        indexed: result.indexed,
        total: result.total,
        skipped: result.skipped,
      });
    })
    .catch((err) => {
      log.warn("chat-index", "forced startup backfill failed", {
        error: String(err),
      });
    });
}

function startRuntimeServices(httpServer: ReturnType<typeof app.listen>): void {
  log.info("server", "listening", { port: PORT });

  // --- Pub/Sub ---
  const pubsub = createPubSub(httpServer);
  // Back-fill the notifications router with the live publisher (see
  // module-scope placeholder above).
  notificationDeps.publish = (channel, payload) =>
    pubsub.publish(channel, payload);

  // --- Notification system (#144) ---
  initNotifications({
    publish: (channel, payload) => pubsub.publish(channel, payload),
    pushToBridge: chatService.pushToBridge,
  });

  // --- Chat socket transport (Phase A of #268) ---
  chatService.attachSocket(httpServer);

  // --- Session Store ---
  initSessionStore(pubsub);

  // --- Task Manager ---
  const taskManager = createTaskManager({
    tickMs: debugMode ? ONE_SECOND_MS : ONE_MINUTE_MS,
  });

  if (debugMode) {
    registerDebugTasks(taskManager, pubsub);
  }

  // --- Scheduler (Phase 1 of #357) ---
  // Register system tasks with persistence + catch-up. The journal
  // and chat-index also fire from the agent finally-hook for
  // responsiveness; the scheduler ensures catch-up after gaps.
  const systemTasks: SystemTaskDef[] = [
    {
      id: "system:journal",
      name: "Journal daily pass",
      description: "Summarize recent chat sessions into daily + topic files",
      schedule: { type: SCHEDULE_TYPES.interval, intervalMs: ONE_HOUR_MS },
      missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
      run: () => maybeRunJournal({}),
    },
    {
      id: "system:chat-index",
      name: "Chat index backfill",
      description: "Generate AI titles + summaries for un-indexed sessions",
      schedule: { type: SCHEDULE_TYPES.interval, intervalMs: ONE_HOUR_MS },
      missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
      run: () => backfillAllSessions().then(() => {}),
    },
  ];

  // Apply user-configurable schedule overrides from
  // config/scheduler/overrides.json. Missing file or unknown keys
  // are silently ignored — the hardcoded defaults above remain.
  const overrides = loadSchedulerOverrides();
  for (const task of systemTasks) {
    const ovr = overrides[task.id];
    if (!ovr) continue;
    if (
      task.schedule.type === SCHEDULE_TYPES.interval &&
      typeof ovr.intervalMs === "number" &&
      ovr.intervalMs > 0
    ) {
      log.info("scheduler", "applying override", {
        id: task.id,
        intervalMs: ovr.intervalMs,
      });
      task.schedule = {
        type: SCHEDULE_TYPES.interval,
        intervalMs: ovr.intervalMs,
      };
    }
    if (
      task.schedule.type === SCHEDULE_TYPES.daily &&
      typeof ovr.time === "string" &&
      UTC_HH_MM_RE.test(ovr.time)
    ) {
      log.info("scheduler", "applying override", {
        id: task.id,
        time: ovr.time,
      });
      task.schedule = { type: SCHEDULE_TYPES.daily, time: ovr.time };
    }
  }

  initScheduler(taskManager, systemTasks).catch((err) => {
    log.error("scheduler", "init failed (non-fatal)", {
      error: String(err),
    });
  });

  // Register skills with schedule: frontmatter as scheduled tasks.
  // Fire-and-forget — skill scan errors are logged but don't block
  // server startup.
  registerScheduledSkills({
    taskManager,
    workspaceRoot: workspacePath,
    startChat,
  })
    .then((count) => {
      if (count > 0) {
        log.info("skills", "scheduled skills registered", { count });
      }
    })
    .catch((err) => {
      log.warn("skills", "failed to register scheduled skills", {
        error: String(err),
      });
    });

  // Register user-created scheduled tasks from tasks.json.
  registerUserTasks({ taskManager, startChat })
    .then((count) => {
      if (count > 0) {
        log.info("user-tasks", "user tasks registered", { count });
      }
    })
    .catch((err) => {
      log.warn("user-tasks", "failed to register user tasks", {
        error: String(err),
      });
    });

  taskManager.start();

  maybeForceJournalRun();
  maybeForceChatIndexBackfill();
}

// Graceful shutdown: best-effort cleanup of the auth token file so
// other readers (Vite plugin, future bridges) don't latch onto a
// dead token. Crashes that skip this are harmless — see
// plans/feat-bearer-token-auth.md; the next startup overwrites and
// the stale file's token no longer matches the live in-memory one.
let isShuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log.info("server", "shutting down", { signal });
  await deleteTokenFile();
  process.exit(0);
}
process.on("SIGINT", () => {
  gracefulShutdown("SIGINT").catch(() => process.exit(1));
});
process.on("SIGTERM", () => {
  gracefulShutdown("SIGTERM").catch(() => process.exit(1));
});

(async () => {
  const portFree = await isPortFree(PORT);
  if (!portFree) {
    log.error(
      "server",
      `Port ${PORT} is already in use. Stop the other process and try again.`,
    );
    process.exit(1);
  }

  // Generate the bearer token before `app.listen` so the first
  // request cannot race an uninitialised `getCurrentToken()`. The
  // middleware defensively handles the null case anyway (401).
  // `env.authTokenOverride` (#316) pins the token across restarts
  // when set; otherwise a fresh random one is written.
  await generateAndWriteToken(undefined, env.authTokenOverride);
  log.info("auth", "bearer token written", {
    path: WORKSPACE_PATHS.sessionToken,
    source: env.authTokenOverride ? "env" : "random",
  });

  sandboxEnabled = await setupSandbox();
  logMcpStatus();

  // Bind to localhost-only. Using `0.0.0.0` would expose the dev
  // server to the entire LAN (anyone on the same Wi-Fi could reach
  // `http://<laptop-ip>:3001/api/*`), which combined with the
  // workspace file API is a credential-theft risk. Personal dev
  // tool — localhost is the right default.
  const httpServer = app.listen(PORT, "127.0.0.1", () => {
    startRuntimeServices(httpServer);
  });

  // When Docker sandbox is active, the MCP server subprocess runs
  // inside a container and reaches the host via
  // `host.docker.internal`, which resolves to the docker0 bridge
  // gateway (typically 172.17.0.1). The primary listener on
  // 127.0.0.1 rejects these connections, so we open a secondary
  // listener on the bridge IP. This is scoped to the Docker
  // virtual network — not the LAN — so the security posture stays
  // the same as localhost-only.
  if (sandboxEnabled) {
    const bridgeIp = await getDockerBridgeIp();
    if (bridgeIp) {
      app.listen(PORT, bridgeIp, () => {
        console.log(
          `[sandbox] Also listening on ${bridgeIp}:${PORT} for Docker MCP bridge`,
        );
      });
    }
  }
})();

function registerDebugTasks(taskManager: ITaskManager, pubsub: IPubSub) {
  let tick = 0;

  taskManager.registerTask({
    id: "debug.auto-chat",
    description:
      "Debug — toggles title color 10 times then starts a General-mode chat, then self-removes",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: ONE_SECOND_MS },
    run: async () => {
      tick++;
      const last = tick === 10;
      log.info("debug", `auto-chat countdown ${tick}/10`);
      pubsub.publish(PUBSUB_CHANNELS.debugBeat, { count: tick, last });

      if (!last) return;

      taskManager.removeTask("debug.auto-chat");
      const chatSessionId = crypto.randomUUID();
      log.info("debug", "starting auto-chat", { chatSessionId });
      const result = await startChat({
        message: "Tell me about this app, MulmoClaude.",
        roleId: DEFAULT_ROLE_ID,
        chatSessionId,
        origin: SESSION_ORIGINS.scheduler,
      });
      log.info("debug", "auto-chat result", { kind: result.kind });
    },
  });

  log.info("debug", "Debug mode active — registered debug tasks");
}
