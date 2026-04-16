import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import agentRoutes from "./routes/agent.js";
import todosRoutes from "./routes/todos.js";
import schedulerRoutes from "./routes/scheduler.js";
import sessionsRoutes from "./routes/sessions.js";
import chatIndexRoutes from "./routes/chat-index.js";
import sourcesRoutes from "./routes/sources.js";
import pluginsRoutes from "./routes/plugins.js";
import imageRoutes from "./routes/image.js";
import presentHtmlRoutes from "./routes/presentHtml.js";
import chartRoutes from "./routes/chart.js";
import rolesRoutes from "./routes/roles.js";
import { DEFAULT_ROLE_ID } from "../src/config/roles.js";
import mulmoScriptRoutes from "./routes/mulmo-script.js";
import wikiRoutes from "./routes/wiki.js";
import pdfRoutes from "./routes/pdf.js";
import filesRoutes from "./routes/files.js";
import configRoutes from "./routes/config.js";
import skillsRoutes from "./routes/skills.js";
import { createChatService } from "./chat-service/index.js";
import { onSessionEvent } from "./session-store/index.js";
import { getRole, loadAllRoles } from "./roles.js";
import { WORKSPACE_PATHS } from "./workspace-paths.js";
import { serverError } from "./utils/httpError.js";
import {
  mcpToolsRouter,
  mcpTools,
  isMcpToolEnabled,
} from "./mcp-tools/index.js";
import { initWorkspace } from "./workspace.js";
import { env, isGeminiAvailable } from "./env.js";
import fs from "fs";
import os from "os";
import { isDockerAvailable, ensureSandboxImage } from "./docker.js";
import { maybeRunJournal } from "./journal/index.js";
import { backfillAllSessions } from "./chat-index/index.js";
import { createPubSub } from "./pub-sub/index.js";
import { PUBSUB_CHANNELS } from "../src/config/pubsubChannels.js";
import { createTaskManager } from "./task-manager/index.js";
import type { ITaskManager } from "./task-manager/index.js";
import type { IPubSub } from "./pub-sub/index.js";
import { initSessionStore } from "./session-store/index.js";
import { requireSameOrigin } from "./csrfGuard.js";
import { bearerAuth } from "./auth/bearerAuth.js";
import {
  deleteTokenFile,
  generateAndWriteToken,
  getCurrentToken,
} from "./auth/token.js";
import { log } from "./logger/index.js";
import { startChat } from "./routes/agent.js";
import { API_ROUTES } from "../src/config/apiRoutes.js";

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
app.use("/api", bearerAuth);

app.get(API_ROUTES.health, (_req: Request, res: Response) => {
  res.json({
    status: "OK",
    geminiAvailable: isGeminiAvailable(),
    sandboxEnabled,
  });
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
app.use(
  createChatService({
    startChat,
    onSessionEvent,
    loadAllRoles,
    getRole,
    defaultRoleId: DEFAULT_ROLE_ID,
    transportsDir: WORKSPACE_PATHS.transports,
    logger: log,
  }),
);
app.use(mcpToolsRouter);

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
    const { refreshCredentials } = await import("./credentials.js");
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

  // --- Session Store ---
  initSessionStore(pubsub);

  // --- Task Manager ---
  const taskManager = createTaskManager({
    tickMs: debugMode ? 1_000 : 60_000,
  });

  if (debugMode) {
    registerDebugTasks(taskManager, pubsub);
  }

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
  await generateAndWriteToken();
  log.info("auth", "bearer token written", {
    path: WORKSPACE_PATHS.sessionToken,
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
})();

function registerDebugTasks(taskManager: ITaskManager, pubsub: IPubSub) {
  let tick = 0;

  taskManager.registerTask({
    id: "debug.auto-chat",
    description:
      "Debug — toggles title color 10 times then starts a General-mode chat, then self-removes",
    schedule: { type: "interval", intervalMs: 1_000 },
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
      });
      log.info("debug", "auto-chat result", { kind: result.kind });
    },
  });

  log.info("debug", "Debug mode active — registered debug tasks");
}
