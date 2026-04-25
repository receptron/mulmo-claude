// Shared MCP server-config types. Mirrors `server/system/config.ts`'s
// `McpServerEntry` shape so the front-end can carry it without
// importing the server module. Catalog (`mcpCatalog.ts`) and the
// MCP settings tab both consume these.

export interface HttpSpec {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface StdioSpec {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export type McpServerSpec = HttpSpec | StdioSpec;

export interface McpServerEntry {
  id: string;
  spec: McpServerSpec;
}
