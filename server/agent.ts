import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Role } from "../src/config/roles.js";
import { loadAllRoles } from "./roles.js";
import { buildSystemPrompt } from "./agent/prompt.js";
import {
  getActivePlugins,
  buildMcpConfig,
  buildCliArgs,
} from "./agent/config.js";
import {
  parseStreamEvent,
  type AgentEvent,
  type RawStreamEvent,
} from "./agent/stream.js";

export async function* runAgent(
  message: string,
  role: Role,
  workspacePath: string,
  sessionId: string,
  port: number,
  claudeSessionId?: string,
  pluginPrompts?: Record<string, string>,
): AsyncGenerator<AgentEvent> {
  const systemPrompt = buildSystemPrompt({
    role,
    workspacePath,
    pluginPrompts,
  });

  const activePlugins = getActivePlugins(role);
  const mcpConfigPath = join(tmpdir(), `mulmoclaude-mcp-${sessionId}.json`);
  const hasMcp = activePlugins.length > 0;

  if (hasMcp) {
    const mcpConfig = buildMcpConfig({
      sessionId,
      port,
      activePlugins,
      roleIds: loadAllRoles().map((r) => r.id),
    });
    await writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
  }

  const args = buildCliArgs({
    systemPrompt,
    activePlugins,
    claudeSessionId,
    message,
    mcpConfigPath: hasMcp ? mcpConfigPath : undefined,
  });

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
      let event: RawStreamEvent;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      for (const agentEvent of parseStreamEvent(event)) {
        yield agentEvent;
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
