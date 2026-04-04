import { randomUUID } from "crypto";
import { access, appendFile, mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { Router, Request, Response } from "express";
import { getRole } from "../roles.js";
import { runAgent } from "../agent.js";
import { registerSession, removeSession, pushToSession } from "../sessions.js";
import { workspacePath } from "../workspace.js";

const router = Router();
const PORT = Number(process.env.PORT) || 3001;

// Maps app-level chatSessionId → Claude CLI internal session ID for multi-turn dialog
const claudeSessionMap = new Map<string, string>();

// Called by the MCP server to push a ToolResult into the active SSE stream
interface OkResponse {
  ok: boolean;
}

router.post(
  "/internal/tool-result",
  async (req: Request<object, unknown, unknown>, res: Response<OkResponse>) => {
    const session = String(req.query.session ?? "");
    const pushed = await pushToSession(session, {
      type: "tool_result",
      result: req.body,
    });
    res.json({ ok: pushed });
  },
);

// Called by the MCP server to trigger a role switch on the frontend
interface SwitchRoleBody {
  roleId: string;
}

router.post(
  "/internal/switch-role",
  async (
    req: Request<object, unknown, SwitchRoleBody>,
    res: Response<OkResponse>,
  ) => {
    const session = String(req.query.session ?? "");
    const { roleId } = req.body;
    const pushed = await pushToSession(session, {
      type: "switch_role",
      roleId,
    });
    res.json({ ok: pushed });
  },
);

interface AgentBody {
  message: string;
  roleId: string;
  chatSessionId: string;
  selectedImageData?: string;
}

interface ErrorResponse {
  error: string;
}

router.post(
  "/agent",
  async (
    req: Request<object, unknown, AgentBody>,
    res: Response<ErrorResponse>,
  ) => {
    const { message, roleId, chatSessionId, selectedImageData } = req.body;

    if (!message || !roleId || !chatSessionId) {
      res
        .status(400)
        .json({ error: "message, roleId, and chatSessionId are required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const send = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const sessionId = randomUUID();
    const chatDir = path.join(workspacePath, "chat");
    await mkdir(chatDir, { recursive: true });
    const resultsFilePath = path.join(chatDir, `${chatSessionId}.jsonl`);
    const metaFilePath = path.join(chatDir, `${chatSessionId}.json`);

    // Write metadata only on the first message of this session
    try {
      await access(metaFilePath);
    } catch {
      await writeFile(
        metaFilePath,
        JSON.stringify({ roleId, startedAt: new Date().toISOString() }),
      );
    }

    // Append user message for this turn
    await appendFile(
      resultsFilePath,
      JSON.stringify({ source: "user", type: "text", message }) + "\n",
    );

    registerSession(sessionId, send, resultsFilePath, selectedImageData);
    const role = getRole(roleId);
    const claudeSessionId =
      claudeSessionMap.get(chatSessionId) ??
      (await readClaudeSessionId(metaFilePath, resultsFilePath));

    try {
      for await (const event of runAgent(
        message,
        role,
        workspacePath,
        sessionId,
        PORT,
        claudeSessionId,
      )) {
        if (event.type === "claude_session_id") {
          claudeSessionMap.set(chatSessionId, event.id);
          await updateClaudeSessionId(metaFilePath, event.id);
          continue;
        }
        send(event);
        if (event.type === "text") {
          await appendFile(
            resultsFilePath,
            JSON.stringify({
              source: "assistant",
              type: "text",
              message: event.message,
            }) + "\n",
          );
        }
      }
      send({ type: "status", message: "Done" });
    } catch (err) {
      send({ type: "error", message: String(err) });
    } finally {
      removeSession(sessionId);
      res.end();
    }
  },
);

async function readClaudeSessionId(
  metaFilePath: string,
  jsonlFilePath: string,
): Promise<string | undefined> {
  // Try new-style .json metadata file first
  try {
    const meta = JSON.parse(await readFile(metaFilePath, "utf-8"));
    if (meta.claudeSessionId) return meta.claudeSessionId;
  } catch {
    // fall through to legacy scan
  }
  // Legacy: scan .jsonl for inline claude_session_id entries
  try {
    const lines = (await readFile(jsonlFilePath, "utf-8"))
      .split("\n")
      .filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === "claude_session_id" && entry.id) return entry.id;
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file doesn't exist yet
  }
  return undefined;
}

async function updateClaudeSessionId(
  metaFilePath: string,
  claudeSessionId: string,
): Promise<void> {
  try {
    const meta = JSON.parse(await readFile(metaFilePath, "utf-8"));
    await writeFile(metaFilePath, JSON.stringify({ ...meta, claudeSessionId }));
  } catch {
    // ignore if meta file is missing
  }
}

export default router;
