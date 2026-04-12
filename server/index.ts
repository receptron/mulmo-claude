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
import pluginsRoutes from "./routes/plugins.js";
import imageRoutes from "./routes/image.js";
import presentHtmlRoutes from "./routes/presentHtml.js";
import rolesRoutes from "./routes/roles.js";
import mulmoScriptRoutes from "./routes/mulmo-script.js";
import wikiRoutes from "./routes/wiki.js";
import pdfRoutes from "./routes/pdf.js";
import filesRoutes from "./routes/files.js";
import {
  mcpToolsRouter,
  mcpTools,
  isMcpToolEnabled,
} from "./mcp-tools/index.js";
import { initWorkspace } from "./workspace.js";
import fs from "fs";
import os from "os";
import { isDockerAvailable, ensureSandboxImage } from "./docker.js";
import { maybeRunJournal } from "./journal/index.js";
import { backfillAllSessions } from "./chat-index/index.js";
import { createPubSub } from "./pub-sub/index.js";
import { createTaskManager } from "./task-manager/index.js";
import type { ITaskManager } from "./task-manager/index.js";
import type { IPubSub } from "./pub-sub/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const debugMode = process.argv.includes("--debug");

initWorkspace();

let sandboxEnabled = false;

const app = express();
const PORT = Number(process.env.PORT) || 3001;

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
// plans/fix-server-lockdown-cors-localhost.md for the threat
// model.
app.use(express.json({ limit: "50mb" }));

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "OK",
    geminiAvailable: !!process.env.GEMINI_API_KEY,
    sandboxEnabled,
  });
});

app.use("/api", agentRoutes);
app.use("/api", todosRoutes);
app.use("/api", schedulerRoutes);
app.use("/api", sessionsRoutes);
app.use("/api", chatIndexRoutes);
app.use("/api", pluginsRoutes);
app.use("/api", imageRoutes);
app.use("/api", presentHtmlRoutes);
app.use("/api", rolesRoutes);
app.use("/api", mulmoScriptRoutes);
app.use("/api", wikiRoutes);
app.use("/api", pdfRoutes);
app.use("/api", filesRoutes);
app.use("/api/mcp-tools", mcpToolsRouter);

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client")));
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "../client/index.html"));
  });
}

app.use((err: Error, _req: Request, res: Response, __next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
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
    console.error(
      "[sandbox] Failed to export credentials from macOS Keychain.",
    );
    console.error("[sandbox] Run `npm run sandbox:login` manually.");
    process.exit(1);
  }
  console.error(
    "[sandbox] Missing credentials file: ~/.claude/.credentials.json",
  );
  console.error(
    "[sandbox] Run `claude auth login` to authenticate Claude Code.",
  );
  process.exit(1);
}

async function setupSandbox(): Promise<boolean> {
  if (process.env.DISABLE_SANDBOX === "1") {
    console.log(
      "[sandbox] DISABLE_SANDBOX=1 — running unrestricted (debug mode)",
    );
    return false;
  }
  try {
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      console.log("[sandbox] Docker not found — claude will run unrestricted");
      return false;
    }
    await ensureCredentialsAvailable();
    console.log(
      "[sandbox] Docker available — building sandbox image if needed",
    );
    await ensureSandboxImage();
    console.log("[sandbox] Sandbox ready");
    return true;
  } catch (err) {
    console.error(
      "[sandbox] Failed to set up sandbox, running unrestricted:",
      err,
    );
    return false;
  }
}

function logMcpStatus(): void {
  const enabledMcpTools = mcpTools.filter(isMcpToolEnabled);
  const disabledMcpTools = mcpTools.filter((t) => !isMcpToolEnabled(t));
  if (enabledMcpTools.length > 0) {
    console.log(
      `[mcp] Available: ${enabledMcpTools.map((t) => t.definition.name).join(", ")}`,
    );
  }
  if (disabledMcpTools.length > 0) {
    const names = disabledMcpTools
      .map(
        (t) =>
          t.definition.name + " (" + (t.requiredEnv ?? []).join(", ") + ")",
      )
      .join(", ");
    console.log(`[mcp] Unavailable (missing env): ${names}`);
  }
}

function maybeForceJournalRun(): void {
  // Debug switch: set JOURNAL_FORCE_RUN_ON_STARTUP=1 to run a full
  // journal pass immediately without waiting for a session end or
  // the hourly interval. Fire-and-forget — journal errors never
  // propagate out of maybeRunJournal.
  if (process.env.JOURNAL_FORCE_RUN_ON_STARTUP !== "1") return;
  console.log("[journal] JOURNAL_FORCE_RUN_ON_STARTUP=1 — running now");
  maybeRunJournal({ force: true }).catch((err) => {
    console.warn("[journal] forced startup run failed:", err);
  });
}

function maybeForceChatIndexBackfill(): void {
  // Companion switch for the chat indexer: force-rebuild every
  // session's title summary on startup. Useful the first time the
  // feature is rolled out over an existing workspace, or when
  // debugging the indexer itself.
  if (process.env.CHAT_INDEX_FORCE_RUN_ON_STARTUP !== "1") return;
  console.log("[chat-index] CHAT_INDEX_FORCE_RUN_ON_STARTUP=1 — running now");
  backfillAllSessions()
    .then((result) => {
      console.log(
        `[chat-index] startup backfill complete: ${result.indexed}/${result.total} indexed, ${result.skipped} skipped`,
      );
    })
    .catch((err) => {
      console.warn("[chat-index] forced startup backfill failed:", err);
    });
}

function startRuntimeServices(httpServer: ReturnType<typeof app.listen>): void {
  console.log(`Server running on port ${PORT}`);

  // --- Pub/Sub ---
  const pubsub = createPubSub(httpServer);

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

(async () => {
  const portFree = await isPortFree(PORT);
  if (!portFree) {
    console.error(
      `[error] Port ${PORT} is already in use. Stop the other process and try again.`,
    );
    process.exit(1);
  }

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
  let count = 0;

  taskManager.registerTask({
    id: "debug.counter",
    description:
      "Debug counter — logs and publishes debug.beat, self-removes after 10 runs",
    schedule: { type: "interval", intervalMs: 1_000 },
    run: async () => {
      count++;
      const last = count === 10;
      console.log(`[task-manager] debug.counter: ${count}`);
      pubsub.publish("debug.beat", { count, last });
      if (last) {
        taskManager.removeTask("debug.counter");
        registerDebugCounter2(taskManager, pubsub);
      }
    },
  });

  console.log("[debug] Debug mode active — registered debug tasks");
}

function registerDebugCounter2(taskManager: ITaskManager, pubsub: IPubSub) {
  let count = 0;

  taskManager.registerTask({
    id: "debug.counter2",
    description: "Debug counter 2 — fires debug.beat every 2 seconds, 10 times",
    schedule: { type: "interval", intervalMs: 2_000 },
    run: async () => {
      count++;
      const last = count === 10;
      console.log(`[task-manager] debug.counter2: ${count}`);
      pubsub.publish("debug.beat", { count, last });
      if (last) {
        taskManager.removeTask("debug.counter2");
      }
    },
  });
}
