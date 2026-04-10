// Composable that owns the MCP tool state used by the sidebar:
// which tools are currently disabled, their per-tool prompts, and
// the derived `availableTools` / `toolDescriptions` computeds. The
// pure rules live in src/utils/mcpTools so they are unit-testable
// independently of fetch / Vue.

import { computed, ref, type ComputedRef } from "vue";
import type { Role } from "../config/roles";
import {
  availableToolsFor,
  toolDescriptionsFor,
  type ToolDefinitionMetadata,
} from "../utils/tools/mcp";

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

  const availableTools = computed(() =>
    availableToolsFor(
      opts.currentRole.value.availablePlugins,
      disabledMcpTools.value,
    ),
  );

  const toolDescriptions = computed(() =>
    toolDescriptionsFor(
      opts.currentRole.value.availablePlugins,
      opts.getDefinition,
      mcpToolDescriptions.value,
    ),
  );

  async function fetchMcpToolsStatus(): Promise<void> {
    try {
      const res = await fetch("/api/mcp-tools");
      if (!res.ok) return;
      const tools: { name: string; enabled: boolean; prompt?: string }[] =
        await res.json();
      disabledMcpTools.value = new Set(
        tools.filter((t) => !t.enabled).map((t) => t.name),
      );
      mcpToolDescriptions.value = Object.fromEntries(
        tools.filter((t) => t.prompt).map((t) => [t.name, t.prompt as string]),
      );
    } catch {
      // ignore — all tools remain visible if the fetch fails
    }
  }

  return {
    disabledMcpTools,
    mcpToolDescriptions,
    availableTools,
    toolDescriptions,
    fetchMcpToolsStatus,
  };
}
