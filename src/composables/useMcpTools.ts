// Composable that owns the MCP tool state used by the sidebar:
// which tools are currently disabled, their per-tool prompts, and
// the derived `availableTools` / `toolDescriptions` computeds. The
// pure rules live in src/utils/mcpTools so they are unit-testable
// independently of fetch / Vue.

import { computed, ref, type ComputedRef } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import type { Role } from "../config/roles";
import { availableToolsFor, toolDescriptionsFor, type ToolDefinitionMetadata } from "../utils/tools/mcp";
import { apiGet } from "../utils/api";

interface UseMcpToolsOptions {
  currentRole: ComputedRef<Role>;
  // Injection point for the in-app plugin registry lookup. Real
  // callers pass `(name) => getPlugin(name)?.toolDefinition ?? null`,
  // tests can stub it.
  getDefinition: (name: string) => ToolDefinitionMetadata | null;
}

export function useMcpTools(opts: UseMcpToolsOptions) {
  const disabledMcpTools = ref(new Set<string>());
  const mcpToolDescriptions = ref<Record<string, string>>({});
  // Surfaces the most recent GET /api/mcp-tools failure so consumers
  // (e.g. the Settings modal's MCP tab) can render a small warning.
  // We intentionally keep the "all tools visible" fallback below so
  // the UI stays usable; this ref lets the UI tell the user *why* the
  // list looks incomplete / unfiltered.
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
      // Keep the "all tools visible" fallback — not clearing
      // disabledMcpTools or descriptions means the UI remains usable.
      return;
    }
    if (!Array.isArray(result.data)) {
      mcpToolsError.value = "Unexpected response shape from /api/mcp-tools";
      return;
    }
    mcpToolsError.value = null;
    const tools = result.data;
    disabledMcpTools.value = new Set(tools.filter((t) => !t.enabled).map((t) => t.name));
    mcpToolDescriptions.value = Object.fromEntries(tools.filter(hasPrompt).map((t) => [t.name, t.prompt]));
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
