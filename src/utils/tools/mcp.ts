// Pure helpers for the MCP-tool sidebar state. The composable in
// src/composables/useMcpTools wires these up to a Vue ref + a fetch
// against /api/mcp-tools; here we keep just the rules so they can
// be unit-tested without Vue or fetch.

export interface ToolDefinitionMetadata {
  description?: string;
}

// Filter a role's plugin list down to the tools that are still
// enabled — i.e. not in the disabled set.
export function availableToolsFor(rolePlugins: string[], disabled: Set<string>): string[] {
  return rolePlugins.filter((name) => !disabled.has(name));
}

// Build a name → description map for the tools the current role can
// see. Prefers the bundled tool definition's `description`, falling
// back to the MCP tool's prompt when the bundled one is missing.
// `getDefinition` is injected so tests can stub the local plugin
// lookup without importing src/tools.
export function toolDescriptionsFor(
  rolePlugins: string[],
  getDefinition: (name: string) => ToolDefinitionMetadata | null,
  mcpDescriptions: Record<string, string>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const name of rolePlugins) {
    const def = getDefinition(name);
    const desc = def?.description ?? mcpDescriptions[name];
    if (desc) map[name] = desc;
  }
  return map;
}
