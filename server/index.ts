import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import path from "path";
import { fileURLToPath } from "url";
import agentRoutes, { startChat } from "./api/routes/agent.js";
import todosRoutes from "./api/routes/todos.js";
import schedulerRoutes from "./api/routes/scheduler.js";
import sessionsRoutes, { loadAllSessions } from "./api/routes/sessions.js";
import chatIndexRoutes from "./api/routes/chat-index.js";
import sourcesRoutes from "./api/routes/sources.js";
import newsRoutes from "./api/routes/news.js";
import pluginsRoutes from "./api/routes/plugins.js";
import imageRoutes from "./api/routes/image.js";
import presentHtmlRoutes from "./api/routes/presentHtml.js";
import chartRoutes from "./api/routes/chart.js";
import rolesRoutes from "./api/routes/roles.js";
import { DEFAULT_ROLE_ID } from "../src/config/roles.js";
import mulmoScriptRoutes from "./api/routes/mulmo-script.js";
import wikiRoutes from "./api/routes/wiki.js";
import wikiHistoryRoutes from "./api/routes/wiki/history.js";
import { provisionWikiHistoryHook } from "./workspace/wiki-history/provision.js";
import pdfRoutes from "./api/routes/pdf.js";
import filesRoutes from "./api/routes/files.js";
import configRoutes from "./api/routes/config.js";
import skillsRoutes from "./api/routes/skills.js";
import { createNotificationsRouter } from "./api/routes/notifications.js";
import { createJournalRouter } from "./api/routes/journal.js";
import { type NotificationDeps, initNotifications } from "./events/notifications.js";
import { createChatService } from "@mulmobridge/chat-service";
import { readSessionJsonl } from "./utils/files/session-io.js";
import { onSessionEvent, initSessionStore } from "./events/session-store/index.js";
import { getRole, loadAllRoles } from "./workspace/roles.js";
import { discoverSkills } from "./workspace/skills/index.js";
import { WORKSPACE_PATHS } from "./workspace/paths.js";
import { serverError } from "./utils/httpError.js";
import { makeUuid } from "./utils/id.js";
import { mcpToolsRouter, mcpTools, isMcpToolEnabled } from "./agent/mcp-tools/index.js";
import { initWorkspace, workspacePath } from "./workspace/workspace.js";
import { env, isGeminiAvailable } from "./system/env.js";
import { buildSandboxStatus } from "./api/sandboxStatus.js";
import { existsSync, readFileSync } from "fs";
import { realpath as fsRealpath } from "fs/promises";
import { resolveWithinRoot } from "./utils/files/safe.js";
import { cpus, homedir, loadavg } from "os";
import { isDockerAvailable, ensureSandboxImage } from "./system/docker.js";
import { maybeRunJournal } from "./workspace/journal/index.js";
import { backfillAllSessions } from "./workspace/chat-index/index.js";
import { createPubSub } from "./events/pub-sub/index.js";
import { PUBSUB_CHANNELS } from "../src/config/pubsubChannels.js";
import { createTaskManager } from "./events/task-manager/index.js";
import type { ITaskManager } from "./events/task-manager/index.js";
import { initScheduler, type SystemTaskDef } from "./events/scheduler-adapter.js";
import schedulerTasksRoutes from "./api/routes/schedulerTasks.js";
import { loadSchedulerOverrides, UTC_HH_MM_RE } from "./utils/files/scheduler-overrides-io.js";
import type { IPubSub } from "./events/pub-sub/index.js";
import { connectRelay } from "./events/relay-client.js";
import { requireSameOrigin } from "./api/csrfGuard.js";
import { bearerAuth } from "./api/auth/bearerAuth.js";
import { deleteTokenFile, generateAndWriteToken, getCurrentToken } from "./api/auth/token.js";
import { log } from "./system/logger/index.js";
import { logBackgroundError } from "./utils/logBackgroundError.js";
import { registerScheduledSkills } from "./workspace/skills/scheduler.js";
import { registerUserTasks } from "./workspace/skills/user-tasks.js";
import { API_ROUTES } from "../src/config/apiRoutes.js";
import { EVENT_TYPES } from "../src/types/events.js";
import { SESSION_ORIGINS } from "../src/types/session.js";
import { ONE_SECOND_MS, ONE_MINUTE_MS, ONE_HOUR_MS } from "./utils/time.js";
import { isPortFree, findAvailablePort, MAX_PORT_PROBES } from "./utils/port.mjs";
import { SCHEDULE_TYPES, MISSED_RUN_POLICIES } from "@receptron/task-scheduler";

const HTML_TOKEN_PLACEHOLDER = "__MULMOCLAUDE_AUTH_TOKEN__";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const debugMode = process.argv.includes("--debug");

initWorkspace();

let sandboxEnabled = false;

const app = express();

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
// plans/done/feat-bearer-token-auth.md.
//
// /api/files/* is exempt because <img src="/api/files/raw?path=...">
// tags in rendered markdown can't attach Authorization headers.
// The CSRF origin check + loopback-only binding still apply.
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/files/")) {
    next();
    return;
  }
  bearerAuth(req, res, next);
});

// Static mount for the canonical image storage path. Every image
// generated by `saveImage()` (Gemini, canvas, image edit) lives under
// `artifacts/images/YYYY/MM/<id>.png` (#764, see
// server/utils/files/image-store.ts), so an `<img>` referring to that
// shape resolves directly without going through /api/files/raw.
//
// Bearer auth is intentionally skipped (same reason as /api/files/*:
// browser <img> tags can't carry an Authorization header). The
// requireSameOrigin guard above still applies; the listener also
// stays loopback-only.
//
// Three-layer guard:
//  1. Extension allowlist — reject anything that isn't an image
//     extension (saveImage currently writes `.png` only; the list
//     stays slightly wider so future formats don't reopen the review).
//  2. realpath-based traversal check via `resolveWithinRoot` — same
//     guard `/api/files/raw` uses. Catches symlinks pointing outside
//     the images dir, which `express.static` would otherwise follow.
//  3. `dotfiles: deny` + `fallthrough: false` on `express.static`
//     itself, plus its built-in `..` normalize for path traversal.
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg)$/i;
let imagesDirReal: string | null = null;
async function getImagesDirReal(): Promise<string | null> {
  if (imagesDirReal) return imagesDirReal;
  try {
    imagesDirReal = await fsRealpath(WORKSPACE_PATHS.images);
    return imagesDirReal;
  } catch {
    // Dir not yet materialised (fresh workspace, no image saved).
    return null;
  }
}
app.use(
  "/artifacts/images",
  async (req, res, next) => {
    if (!IMAGE_EXT_RE.test(req.path)) {
      res.status(404).end();
      return;
    }
    const root = await getImagesDirReal();
    if (!root) {
      res.status(404).end();
      return;
    }
    let relPath: string;
    try {
      // decodeURIComponent throws URIError on malformed escapes
      // (`%ZZ`, stray `%`). Fail closed so a junk URL returns 404
      // instead of bubbling a 500 out of the express error chain.
      relPath = decodeURIComponent(req.path.replace(/^\//, ""));
    } catch {
      res.status(404).end();
      return;
    }
    if (!resolveWithinRoot(root, relPath)) {
      res.status(404).end();
      return;
    }
    next();
  },
  express.static(WORKSPACE_PATHS.images, { dotfiles: "deny", fallthrough: false }),
);

app.get(API_ROUTES.health, (_req: Request, res: Response) => {
  // `os.loadavg()[0]` is the kernel 1-minute load average. On Linux /
  // macOS it's the primary "is this machine busy" signal; on Windows
  // the array is `[0, 0, 0]` (platform has no equivalent), in which
  // case `load1` stays 0 and the favicon's overloaded rule silently
  // never fires there. `cores` lets the client normalise so a 16-core
  // box at load 8 reads the same intensity as an 8-core box at load 4.
  const [load1] = loadavg();
  const cores = cpus().length;
  res.json({
    status: "OK",
    geminiAvailable: isGeminiAvailable(),
    sandboxEnabled,
    cpu: { load1, cores },
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
app.use(newsRoutes);
app.use(pluginsRoutes);
app.use(imageRoutes);
app.use(presentHtmlRoutes);
app.use(chartRoutes);
app.use(rolesRoutes);
app.use(mulmoScriptRoutes);
app.use(wikiRoutes);
// Mounted under /api/wiki so the inner router's relative paths
// (`/pages/:slug/history`, `/internal/snapshot`) line up with the
// API_ROUTES.wiki.* constants.
app.use("/api/wiki", wikiHistoryRoutes);
app.use(pdfRoutes);
app.use(filesRoutes);
app.use(configRoutes);
app.use(skillsRoutes);
async function listSessionsForBridge(opts: { limit: number; offset: number }) {
  const rows = await loadAllSessions();
  const sorted = rows.sort((leftSession, rightSession) => rightSession.changeMs - leftSession.changeMs);
  const total = sorted.length;
  const sessions = sorted.slice(opts.offset, opts.offset + opts.limit).map((row) => ({
    id: row.summary.id,
    roleId: row.summary.roleId,
    preview: row.summary.preview,
    updatedAt: row.summary.updatedAt,
  }));
  return { sessions, total };
}
async function getSessionHistoryForBridge(sessionId: string, opts: { limit: number; offset: number }) {
  const content = await readSessionJsonl(sessionId);
  if (!content) return { messages: [], total: 0 };
  const allMessages: { source: string; text: string }[] = [];
  const lines = content.split("\n").filter(Boolean);
  // Collect all text events newest-first
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type === EVENT_TYPES.text && typeof entry.message === "string") {
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
// Allowlist used by the bridge command handler: a slash command
// from a bridge (e.g. `/release-app` from Telegram) is forwarded to
// the agent only if it names a discoverable skill under
// ~/.claude/skills/ or <workspace>/.claude/skills/. The same list
// drives the "Skills:" section in the bridge `/help` reply, so the
// command handler calls this once per turn (membership check + help
// rendering share the result). fs is hit on every help/unknown
// bridge slash, which is fine because bridge slashes are infrequent
// and the workspace skill directory is small. Stays fresh against
// skill add/remove without any cache invalidation.
async function listRegisteredSkills(): Promise<{ name: string; description: string }[]> {
  const skills = await discoverSkills({ workspaceRoot: workspacePath });
  return skills.map((skill) => ({ name: skill.name, description: skill.description }));
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
  listRegisteredSkills,
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
app.use(createJournalRouter());
app.use(mcpToolsRouter);
app.use(schedulerTasksRoutes);

if (env.isProduction) {
  // `{ index: false }` so express.static doesn't intercept `GET /`
  // with the built index.html. We need our own handler that reads
  // the file and substitutes the bearer token placeholder on each
  // request — see the wildcard fallback below.
  app.use(express.static(path.join(__dirname, "../client"), { index: false }));
  const indexHtmlPath = path.join(__dirname, "../client/index.html");
  app.get("/{*splat}", (_req: Request, res: Response) => {
    let html: string;
    try {
      html = readFileSync(indexHtmlPath, "utf-8");
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

// True iff the user set `PORT` explicitly; empty string counts as "not
// set". We use this to decide between "walk forward when busy" (friendly
// dev behaviour) and "fail loudly" (respect the user's choice).
const portExplicit = typeof process.env.PORT === "string" && process.env.PORT.trim() !== "";

// Resolve the port we'll actually bind to. Default PORT (3001) + busy
// walks forward so a stale `yarn dev` or a parallel test run doesn't
// crash the launch. Explicit PORT + busy exits — matches the launcher's
// `--port` semantics so `PORT=3099 yarn dev` behaves the same as
// `npx mulmoclaude --port 3099`.
async function resolvePort(): Promise<number> {
  const requested = env.port;
  if (await isPortFree(requested)) return requested;
  if (portExplicit) {
    log.error("server", `Port ${requested} is already in use. Stop the other process or pick a different PORT.`);
    process.exit(1);
  }
  const fallback = await findAvailablePort(requested + 1);
  if (fallback === null) {
    log.error("server", `Port ${requested} is in use and no free port found in ${requested}..${requested + MAX_PORT_PROBES - 1}.`);
    process.exit(1);
  }
  log.info("server", `Port ${requested} busy → using ${fallback} instead`);
  return fallback;
}

async function ensureCredentialsAvailable(): Promise<void> {
  const credentialsPath = path.join(homedir(), ".claude", ".credentials.json");
  if (existsSync(credentialsPath)) return;

  if (process.platform === "darwin") {
    const { refreshCredentials } = await import("./system/credentials.js");
    const refreshSucceeded = await refreshCredentials();
    if (refreshSucceeded) return;
    log.error("sandbox", "Failed to export credentials from macOS Keychain. Run `npm run sandbox:login` manually.");
    process.exit(1);
  }
  log.error("sandbox", "Missing credentials file at ~/.claude/.credentials.json. Run `claude auth login` to authenticate Claude Code.");
  process.exit(1);
}

async function setupSandbox(): Promise<boolean> {
  if (env.disableSandbox) {
    log.info("sandbox", "DISABLE_SANDBOX=1 — running unrestricted (debug mode)");
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
  const disabledMcpTools = mcpTools.filter((toolDef) => !isMcpToolEnabled(toolDef));
  if (enabledMcpTools.length > 0) {
    log.info("mcp", "Available", {
      tools: enabledMcpTools.map((toolDef) => toolDef.definition.name).join(", "),
    });
  }
  if (disabledMcpTools.length > 0) {
    const names = disabledMcpTools.map((toolDef) => `${toolDef.definition.name} (${(toolDef.requiredEnv ?? []).join(", ")})`).join(", ");
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
  maybeRunJournal({ force: true }).catch(logBackgroundError("journal", "forced startup run failed"));
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
    .catch(logBackgroundError("chat-index", "forced startup backfill failed"));
}

function startRuntimeServices(httpServer: ReturnType<typeof app.listen>, port: number): void {
  log.info("server", "listening", { port });

  // --- Pub/Sub ---
  const pubsub = createPubSub(httpServer);
  // Back-fill the notifications router with the live publisher (see
  // module-scope placeholder above).
  notificationDeps.publish = (channel, payload) => pubsub.publish(channel, payload);

  // --- Notification system (#144) ---
  initNotifications({
    publish: (channel, payload) => pubsub.publish(channel, payload),
    pushToBridge: chatService.pushToBridge,
  });

  // --- Chat socket transport (Phase A of #268) ---
  chatService.attachSocket(httpServer);

  // --- Relay WebSocket client ---
  if (env.relayUrl && env.relayToken) {
    connectRelay({
      relayUrl: env.relayUrl,
      relayToken: env.relayToken,
      relay: chatService.relay,
      logger: log,
    });
  }

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
    const override = overrides[task.id];
    if (!override) continue;
    if (task.schedule.type === SCHEDULE_TYPES.interval && typeof override.intervalMs === "number" && override.intervalMs > 0) {
      log.info("scheduler", "applying override", {
        id: task.id,
        intervalMs: override.intervalMs,
      });
      task.schedule = {
        type: SCHEDULE_TYPES.interval,
        intervalMs: override.intervalMs,
      };
    }
    if (task.schedule.type === SCHEDULE_TYPES.daily && typeof override.time === "string" && UTC_HH_MM_RE.test(override.time)) {
      log.info("scheduler", "applying override", {
        id: task.id,
        time: override.time,
      });
      task.schedule = { type: SCHEDULE_TYPES.daily, time: override.time };
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
    .catch(logBackgroundError("skills", "failed to register scheduled skills"));

  // Register user-created scheduled tasks from tasks.json.
  registerUserTasks({ taskManager, startChat })
    .then((count) => {
      if (count > 0) {
        log.info("user-tasks", "user tasks registered", { count });
      }
    })
    .catch(logBackgroundError("user-tasks", "failed to register user tasks"));

  taskManager.start();

  maybeForceJournalRun();
  maybeForceChatIndexBackfill();
}

// Graceful shutdown: best-effort cleanup of the auth token file so
// other readers (Vite plugin, future bridges) don't latch onto a
// dead token. Crashes that skip this are harmless — see
// plans/done/feat-bearer-token-auth.md; the next startup overwrites and
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
  const port = await resolvePort();

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

  // Provision the LLM-write hook in the workspace's
  // `.claude/settings.json` (#763 PR 2). Idempotent — safe on every
  // startup. Done BEFORE the agent ever spawns a claude CLI subprocess
  // so the hook is in place from the first turn.
  await provisionWikiHistoryHook().catch((err) => {
    log.warn("wiki-history", "hook provisioning failed; LLM wiki edits will not be snapshotted this session", {
      error: String(err),
    });
  });

  // Bind to localhost-only. Using `0.0.0.0` would expose the dev
  // server to the entire LAN (anyone on the same Wi-Fi could reach
  // `http://<laptop-ip>:3001/api/*`), which combined with the
  // workspace file API is a credential-theft risk. Personal dev
  // tool — localhost is the right default.
  const httpServer = app.listen(port, "127.0.0.1", async () => {
    // Publish the actually-bound port so the hook script can
    // address us — the requested PORT may have walked forward
    // off a busy default. Use writeFile (not writeFileAtomic)
    // because the file is tiny + ephemeral and the .tmp dance
    // serves no purpose for a single-process write at boot.
    try {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(WORKSPACE_PATHS.serverPort, `${port}\n`, { mode: 0o600 });
    } catch (err) {
      log.warn("server", "failed to write .server-port; LLM wiki-write hook will be unable to reach the server", {
        error: String(err),
      });
    }
    startRuntimeServices(httpServer, port);
  });
})();

function registerDebugTasks(taskManager: ITaskManager, pubsub: IPubSub) {
  let tick = 0;

  taskManager.registerTask({
    id: "debug.auto-chat",
    description: "Debug — toggles title color 10 times then starts a General-mode chat, then self-removes",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: ONE_SECOND_MS },
    run: async () => {
      tick++;
      const last = tick === 10;
      log.info("debug", `auto-chat countdown ${tick}/10`);
      pubsub.publish(PUBSUB_CHANNELS.debugBeat, { count: tick, last });

      if (!last) return;

      taskManager.removeTask("debug.auto-chat");
      const chatSessionId = makeUuid();
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
