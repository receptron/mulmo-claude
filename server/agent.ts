import { spawn } from "child_process";
import { mkdir, writeFile, unlink } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { isDockerAvailable } from "./docker.js";
import { refreshCredentials } from "./credentials.js";
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
  systemPrompt?: string,
): AsyncGenerator<AgentEvent> {
  const activePlugins = getActivePlugins(role);
  const hasMcp = activePlugins.length > 0;
  const useDocker = await isDockerAvailable();

  // On macOS sandbox, always refresh credentials from Keychain before each
  // agent run so that expired OAuth tokens are replaced transparently.
  if (useDocker && process.platform === "darwin") {
    await refreshCredentials();
  }

  const containerWorkspacePath = "/home/node/mulmoclaude";
  const fullSystemPrompt = buildSystemPrompt({
    role,
    workspacePath: useDocker ? containerWorkspacePath : workspacePath,
    pluginPrompts,
    systemPrompt,
  });

  // Compute MCP config paths — host path for writing/cleanup,
  // arg path for what gets passed to the claude CLI (container path if docker).
  let mcpConfigHostPath: string;
  let mcpConfigArgPath: string;
  if (useDocker) {
    const mcpConfigDir = join(workspacePath, ".mulmoclaude");
    await mkdir(mcpConfigDir, { recursive: true });
    mcpConfigHostPath = join(mcpConfigDir, `mcp-${sessionId}.json`);
    mcpConfigArgPath = `/home/node/mulmoclaude/.mulmoclaude/mcp-${sessionId}.json`;
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
    systemPrompt: fullSystemPrompt,
    activePlugins,
    claudeSessionId,
    message,
    mcpConfigPath: hasMcp ? mcpConfigArgPath : undefined,
  });

  const toDockerPath = (p: string) => p.replace(/\\/g, "/");
  const extraHosts: string[] =
    process.platform === "linux"
      ? ["--add-host", "host.docker.internal:host-gateway"]
      : [];

  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  const projectRoot = process.cwd();
  const proc = useDocker
    ? spawn(
        "docker",
        [
          "run",
          "--rm",
          "--cap-drop",
          "ALL",
          "--user",
          `${uid}:${gid}`,
          "-e",
          "HOME=/home/node",
          "-v",
          `${toDockerPath(projectRoot)}/node_modules:/app/node_modules:ro`,
          "-v",
          `${toDockerPath(projectRoot)}/server:/app/server:ro`,
          "-v",
          `${toDockerPath(projectRoot)}/src:/app/src:ro`,
          "-v",
          `${toDockerPath(workspacePath)}:/home/node/mulmoclaude`,
          "-v",
          `${toDockerPath(homedir())}/.claude:/home/node/.claude`,
          "-v",
          `${toDockerPath(homedir())}/.claude.json:/home/node/.claude.json`,
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

  try {
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

    if (exitCode !== 0) {
      yield {
        type: "error",
        message: stderrOutput || `claude exited with code ${exitCode}`,
      };
    }
  } finally {
    if (!proc.killed) proc.kill();
    if (hasMcp) unlink(mcpConfigHostPath).catch(() => {});
  }
}
