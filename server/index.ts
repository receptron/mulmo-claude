import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
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
app.use(cors());
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
    server.listen(port, "0.0.0.0");
  });
}

(async () => {
  const portFree = await isPortFree(PORT);
  if (!portFree) {
    console.error(
      `[error] Port ${PORT} is already in use. Stop the other process and try again.`,
    );
    process.exit(1);
  }

  if (process.env.DISABLE_SANDBOX === "1") {
    console.log(
      "[sandbox] DISABLE_SANDBOX=1 — running unrestricted (debug mode)",
    );
  } else {
    try {
      sandboxEnabled = await isDockerAvailable();
      if (sandboxEnabled) {
        const credentialsPath = path.join(
          os.homedir(),
          ".claude",
          ".credentials.json",
        );
        if (!fs.existsSync(credentialsPath)) {
          if (process.platform === "darwin") {
            const { refreshCredentials } = await import("./credentials.js");
            const ok = await refreshCredentials();
            if (!ok) {
              console.error(
                "[sandbox] Failed to export credentials from macOS Keychain.",
              );
              console.error("[sandbox] Run `npm run sandbox:login` manually.");
              process.exit(1);
            }
          } else {
            console.error(
              "[sandbox] Missing credentials file: ~/.claude/.credentials.json",
            );
            console.error(
              "[sandbox] Run `claude auth login` to authenticate Claude Code.",
            );
            process.exit(1);
          }
        }
        console.log(
          "[sandbox] Docker available — building sandbox image if needed",
        );
        await ensureSandboxImage();
        console.log("[sandbox] Sandbox ready");
      } else {
        console.log(
          "[sandbox] Docker not found — claude will run unrestricted",
        );
      }
    } catch (err) {
      console.error(
        "[sandbox] Failed to set up sandbox, running unrestricted:",
        err,
      );
      sandboxEnabled = false;
    }
  }

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

  const httpServer = app.listen(PORT, "0.0.0.0", () => {
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

    // Debug switch: set JOURNAL_FORCE_RUN_ON_STARTUP=1 to run a full
    // journal pass immediately without waiting for a session end or
    // the hourly interval. Fire-and-forget — journal errors never
    // propagate out of maybeRunJournal.
    if (process.env.JOURNAL_FORCE_RUN_ON_STARTUP === "1") {
      console.log("[journal] JOURNAL_FORCE_RUN_ON_STARTUP=1 — running now");
      maybeRunJournal({ force: true }).catch((err) => {
        console.warn("[journal] forced startup run failed:", err);
      });
    }

    // Companion switch for the chat indexer: force-rebuild every
    // session's title summary on startup. Useful the first time
    // the feature is rolled out over an existing workspace, or
    // when debugging the indexer itself.
    if (process.env.CHAT_INDEX_FORCE_RUN_ON_STARTUP === "1") {
      console.log(
        "[chat-index] CHAT_INDEX_FORCE_RUN_ON_STARTUP=1 — running now",
      );
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
