// In-process registry of runtime-loaded plugins (#1043 C-2).
//
// `loadRuntimePlugins()` produces a list of `RuntimePlugin`s; this
// module owns the singleton view of "what's registered right now" and
// wires the collision policy:
//
//   1. Static plugins (`PLUGIN_DEFS` from `plugin-names.ts`) win every
//      collision — built-ins cannot be shadowed.
//   2. Among runtime plugins, first-loaded wins on duplicate tool name.
//
// Both processes (parent server, spawned MCP child) hold their own
// in-memory copy. They read the same ledger / cache so the contents
// match without IPC.

import type { ToolDefinition } from "gui-chat-protocol";
import type { RuntimePlugin } from "./runtime-loader.js";
import { log } from "../system/logger/index.js";

const LOG_PREFIX = "plugins/registry";

let registry: RuntimePlugin[] = [];
let toolNameIndex = new Map<string, RuntimePlugin>();

export interface RegisterResult {
  /** Plugins that landed in the registry. */
  registered: RuntimePlugin[];
  /** Plugins skipped because their tool name collides with a static
   *  built-in or an earlier-loaded runtime plugin. */
  collisions: { plugin: RuntimePlugin; reason: "static" | "runtime"; existingTool: string }[];
}

/** Replace the registry with the given runtime plugins, applying the
 *  collision policy described at the top of the file. Static names
 *  are passed in by the caller (parent server / MCP child) because
 *  the static set differs slightly between contexts (mcp tools vs.
 *  plugin-names PLUGIN_DEFS). */
export function registerRuntimePlugins(staticToolNames: ReadonlySet<string>, plugins: readonly RuntimePlugin[]): RegisterResult {
  const registered: RuntimePlugin[] = [];
  const collisions: RegisterResult["collisions"] = [];
  const seen = new Map<string, RuntimePlugin>();
  for (const plugin of plugins) {
    const toolName = plugin.definition.name;
    if (staticToolNames.has(toolName)) {
      collisions.push({ plugin, reason: "static", existingTool: toolName });
      log.warn(LOG_PREFIX, "skipping runtime plugin — name collides with static tool", {
        plugin: plugin.name,
        tool: toolName,
      });
      continue;
    }
    if (seen.has(toolName)) {
      collisions.push({ plugin, reason: "runtime", existingTool: toolName });
      const existing = seen.get(toolName);
      log.warn(LOG_PREFIX, "skipping runtime plugin — name collides with already-loaded runtime plugin", {
        plugin: plugin.name,
        tool: toolName,
        existingPlugin: existing?.name,
      });
      continue;
    }
    seen.set(toolName, plugin);
    registered.push(plugin);
  }
  registry = registered;
  toolNameIndex = seen;
  return { registered, collisions };
}

export function getRuntimePlugins(): readonly RuntimePlugin[] {
  return registry;
}

export function getRuntimePluginByToolName(toolName: string): RuntimePlugin | null {
  return toolNameIndex.get(toolName) ?? null;
}

export function getRuntimeToolDefinitions(): readonly ToolDefinition[] {
  return registry.map((entry) => entry.definition);
}

/** Test-only reset. */
export function _resetRuntimeRegistryForTest(): void {
  registry = [];
  toolNameIndex = new Map();
}
