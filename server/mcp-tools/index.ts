import { Router, Request, Response } from "express";
import { readXPost, searchX } from "./x.js";

export interface McpTool {
  definition: {
    name: string;
    description: string;
    inputSchema: object;
  };
  requiredEnv?: string[];
  prompt?: string;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export const mcpTools: McpTool[] = [readXPost, searchX];

const toolMap = new Map(mcpTools.map((t) => [t.definition.name, t]));

export function isMcpToolEnabled(tool: McpTool): boolean {
  return (tool.requiredEnv ?? []).every((key) => !!process.env[key]);
}

// Express router ──────────────────────────────────────────────────────────────

export const mcpToolsRouter = Router();

interface McpToolParams {
  tool: string;
}

// GET / — returns { name, enabled, requiredEnv } for each tool (used by the role builder UI)
mcpToolsRouter.get("/", (_req: Request, res: Response) => {
  res.json(
    mcpTools.map((t) => ({
      name: t.definition.name,
      enabled: isMcpToolEnabled(t),
      requiredEnv: t.requiredEnv ?? [],
      prompt: t.prompt,
    })),
  );
});

// POST /:tool — dispatches to the right handler
mcpToolsRouter.post(
  "/:tool",
  async (
    req: Request<McpToolParams, unknown, Record<string, unknown>>,
    res: Response,
  ) => {
    const tool = toolMap.get(req.params.tool);
    if (!tool) {
      res.status(404).json({ error: `Unknown MCP tool: ${req.params.tool}` });
      return;
    }
    if (!isMcpToolEnabled(tool)) {
      res
        .status(503)
        .json({ error: `Tool ${req.params.tool} is not configured.` });
      return;
    }
    try {
      const result = await tool.handler(req.body);
      res.json({ result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  },
);
