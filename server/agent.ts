import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Role } from "../src/config/roles.js";
import { loadAllRoles } from "./roles.js";

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "text"; message: string }
  | { type: "tool_result"; result: unknown }
  | { type: "switch_role"; roleId: string }
  | { type: "error"; message: string }
  | { type: "tool_call"; toolUseId: string; toolName: string; args: unknown }
  | { type: "tool_call_result"; toolUseId: string; content: string }
  | { type: "claude_session_id"; id: string };

interface ClaudeContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

interface ClaudeMessage {
  content?: ClaudeContentBlock[];
}

type ClaudeStreamEvent =
  | { type: "assistant"; message: ClaudeMessage }
  | { type: "user"; message: ClaudeMessage }
  | { type: "result"; result: string; session_id?: string };

// Plugin names that have a corresponding MCP tool definition in mcp-server.ts
const MCP_PLUGINS = new Set([
  "manageTodoList",
  "manageScheduler",
  "presentDocument",
  "presentSpreadsheet",
  "createMindMap",
  "generateImage",
  "switchRole",
  "putQuestions",
  "presentForm",
  "openCanvas",
  "generateHtml",
  "editHtml",
  "editImage",
  "present3D",
  "playOthello",
  "manageRoles",
  "presentMulmoScript",
  "showMusic",
]);

export async function* runAgent(
  message: string,
  role: Role,
  workspacePath: string,
  sessionId: string,
  port: number,
  claudeSessionId?: string,
): AsyncGenerator<AgentEvent> {
  const systemPrompt = [
    role.prompt,
    `Workspace directory: ${workspacePath}`,
    `Today's date: ${new Date().toISOString().split("T")[0]}`,
  ].join("\n\n");

  const activePlugins = role.availablePlugins.filter((p) => MCP_PLUGINS.has(p));

  // Write temp MCP config if there are plugins to expose
  const mcpConfigPath = join(tmpdir(), `mulmoclaude-mcp-${sessionId}.json`);
  let hasMcp = false;

  if (activePlugins.length > 0) {
    hasMcp = true;
    const mcpConfig = {
      mcpServers: {
        mulmoclaude: {
          command: join(process.cwd(), "node_modules/.bin/tsx"),
          args: [join(process.cwd(), "server/mcp-server.ts")],
          env: {
            SESSION_ID: sessionId,
            PORT: String(port),
            PLUGIN_NAMES: activePlugins.join(","),
            ROLE_IDS: loadAllRoles()
              .map((r) => r.id)
              .join(","),
          },
        },
      },
    };
    await writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
  }

  const mcpToolNames = activePlugins.map((p) => `mcp__mulmoclaude__${p}`);
  const allowedTools = [
    "Bash",
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "WebFetch",
    ...mcpToolNames,
  ];

  const args = [
    "--output-format",
    "stream-json",
    "--verbose",
    "--system-prompt",
    systemPrompt,
    "--allowedTools",
    allowedTools.join(","),
  ];

  if (claudeSessionId) {
    args.push("--resume", claudeSessionId);
  }

  args.push("-p", message);

  if (hasMcp) {
    args.push("--mcp-config", mcpConfigPath);
  }

  const proc = spawn("claude", args, {
    cwd: workspacePath,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderrOutput = "";
  proc.stderr.on("data", (chunk: Buffer) => {
    stderrOutput += chunk.toString();
  });

  let buffer = "";
  for await (const chunk of proc.stdout) {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let event: ClaudeStreamEvent;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "assistant") {
        yield { type: "status", message: "Thinking..." };
        const content = event.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_use" && block.id && block.name) {
              yield {
                type: "tool_call",
                toolUseId: block.id,
                toolName: block.name,
                args: block.input,
              };
            }
          }
        }
      } else if (event.type === "user") {
        const content = event.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result" && block.tool_use_id) {
              const raw = block.content;
              const contentStr =
                typeof raw === "string" ? raw : JSON.stringify(raw);
              yield {
                type: "tool_call_result",
                toolUseId: block.tool_use_id,
                content: contentStr,
              };
            }
          }
        }
      } else if (event.type === "result") {
        yield { type: "text", message: event.result };
        if (event.session_id) {
          yield { type: "claude_session_id", id: event.session_id };
        }
      }
    }
  }

  const exitCode = await new Promise<number>((resolve) =>
    proc.on("close", resolve),
  );

  if (hasMcp) unlink(mcpConfigPath).catch(() => {});

  if (exitCode !== 0) {
    yield {
      type: "error",
      message: stderrOutput || `claude exited with code ${exitCode}`,
    };
  }
}
