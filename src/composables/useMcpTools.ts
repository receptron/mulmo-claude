import { computed, ref, type ComputedRef } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import type { Role } from "../config/roles";
import { availableToolsFor, toolDescriptionsFor, type ToolDefinitionMetadata } from "../utils/tools/mcp";
import { apiGet } from "../utils/api";

interface UseMcpToolsOptions {
  currentRole: ComputedRef<Role>;
  // Plugin-registry lookup, injectable so tests can stub it.
  getDefinition: (name: string) => ToolDefinitionMetadata | null;
}

export function useMcpTools(opts: UseMcpToolsOptions) {
  const disabledMcpTools = ref(new Set<string>());
  const mcpToolDescriptions = ref<Record<string, string>>({});
  // Surfaces /api/mcp-tools failures so the Settings MCP tab can explain *why* the list looks unfiltered.
  const mcpToolsError = ref<string | null>(null);

  const availableTools = computed(() => availableToolsFor(opts.currentRole.value.availablePlugins, disabledMcpTools.value));

  const toolDescriptions = computed(() => toolDescriptionsFor(opts.currentRole.value.availablePlugins, opts.getDefinition, mcpToolDescriptions.value));

  interface McpToolStatus {
    name: string;
    enabled: boolean;
    prompt?: string;
  }

  function hasPrompt(tool: McpToolStatus): tool is McpToolStatus & { prompt: string } {
    return typeof tool.prompt === "string" && tool.prompt.length > 0;
  }

  async function fetchMcpToolsStatus(): Promise<void> {
    const result = await apiGet<McpToolStatus[]>(API_ROUTES.mcpTools.list);
    if (!result.ok) {
      mcpToolsError.value = result.error;
      // Don't clear disabledMcpTools / descriptions — falling back to "all tools visible" keeps the UI usable.
      return;
    }
    if (!Array.isArray(result.data)) {
      mcpToolsError.value = "Unexpected response shape from /api/mcp-tools";
      return;
    }
    mcpToolsError.value = null;
    const tools = result.data;
    disabledMcpTools.value = new Set(tools.filter((tool) => !tool.enabled).map((tool) => tool.name));
    mcpToolDescriptions.value = Object.fromEntries(tools.filter(hasPrompt).map((tool) => [tool.name, tool.prompt]));
  }

  return {
    disabledMcpTools,
    mcpToolDescriptions,
    mcpToolsError,
    availableTools,
    toolDescriptions,
    fetchMcpToolsStatus,
  };
}
