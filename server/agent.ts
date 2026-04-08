import { spawn } from "child_process";
import { mkdir, writeFile, unlink } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { isDockerAvailable } from "./docker.js";
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
  const hasMcp = activePlugins.length > 0;
  const useDocker = await isDockerAvailable();

  // Compute MCP config paths — host path for writing/cleanup,
  // arg path for what gets passed to the claude CLI (container path if docker).
  let mcpConfigHostPath: string;
  let mcpConfigArgPath: string;
  if (useDocker) {
    const mcpConfigDir = join(workspacePath, ".mulmoclaude");
    await mkdir(mcpConfigDir, { recursive: true });
    mcpConfigHostPath = join(mcpConfigDir, `mcp-${sessionId}.json`);
    mcpConfigArgPath = `/workspace/.mulmoclaude/mcp-${sessionId}.json`;
  } else {
    mcpConfigHostPath = join(tmpdir(), `mulmoclaude-mcp-${sessionId}.json`);
    mcpConfigArgPath = mcpConfigHostPath;
  }

  if (hasMcp) {
    const mcpConfig = buildMcpConfig({
      sessionId,
      port,
      activePlugins,
      roleIds: loadAllRoles().map((r) => r.id),
      useDocker,
    });
    await writeFile(mcpConfigHostPath, JSON.stringify(mcpConfig, null, 2));
  }

  const args = buildCliArgs({
    systemPrompt,
    activePlugins,
    claudeSessionId,
    message,
    mcpConfigPath: hasMcp ? mcpConfigArgPath : undefined,
  });

  const projectRoot = process.cwd();
  const toDockerPath = (p: string) => p.replace(/\\/g, "/");
  const extraHosts: string[] =
    process.platform === "linux"
      ? ["--add-host", "host.docker.internal:host-gateway"]
      : [];

  const proc = useDocker
    ? spawn(
        "docker",
        [
          "run",
          "--rm",
          "-v",
          `${toDockerPath(projectRoot)}/node_modules:/app/node_modules:ro`,
          "-v",
          `${toDockerPath(projectRoot)}/server:/app/server:ro`,
          "-v",
          `${toDockerPath(projectRoot)}/src:/app/src:ro`,
          "-v",
          `${toDockerPath(workspacePath)}:/workspace`,
          "-v",
          `${toDockerPath(homedir())}/.claude:/root/.claude`,
          ...extraHosts,
          "mulmoclaude-sandbox",
          "claude",
          ...args,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      )
    : spawn("claude", args, {
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

  if (hasMcp) unlink(mcpConfigHostPath).catch(() => {});

  if (exitCode !== 0) {
    yield {
      type: "error",
      message: stderrOutput || `claude exited with code ${exitCode}`,
    };
  }
}
