import { Router, Request, Response } from "express";
import { readXPost, searchX } from "./x.js";
import { errorMessage } from "../../utils/errors.js";
import { notFound, sendError, serverError } from "../../utils/httpError.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";

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

const toolMap = new Map(mcpTools.map((tool) => [tool.definition.name, tool]));

export function isMcpToolEnabled(tool: McpTool): boolean {
  return (tool.requiredEnv ?? []).every((key) => !!process.env[key]);
}

// Express router ──────────────────────────────────────────────────────────────

export const mcpToolsRouter = Router();

interface McpToolParams {
  tool: string;
}

// GET /api/mcp-tools — returns { name, enabled, requiredEnv } for each tool (used by the role builder UI)
mcpToolsRouter.get(API_ROUTES.mcpTools.list, (_req: Request, res: Response) => {
  res.json(
    mcpTools.map((tool) => ({
      name: tool.definition.name,
      enabled: isMcpToolEnabled(tool),
      requiredEnv: tool.requiredEnv ?? [],
      prompt: tool.prompt,
    })),
  );
});

// POST /api/mcp-tools/:tool — dispatches to the right handler
mcpToolsRouter.post(API_ROUTES.mcpTools.invoke, async (req: Request<McpToolParams, unknown, Record<string, unknown>>, res: Response) => {
  const tool = toolMap.get(req.params.tool);
  if (!tool) {
    notFound(res, `Unknown MCP tool: ${req.params.tool}`);
    return;
  }
  if (!isMcpToolEnabled(tool)) {
    sendError(res, 503, `Tool ${req.params.tool} is not configured.`);
    return;
  }
  try {
    const result = await tool.handler(req.body);
    res.json({ result });
  } catch (err) {
    serverError(res, errorMessage(err));
  }
});
