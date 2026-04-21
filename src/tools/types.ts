import type { ToolPlugin as BaseToolPlugin, InputHandler, ToolContextApp, ToolDefinition } from "gui-chat-protocol/vue";
import type { Component } from "vue";

/**
 * Extended app context with file system access for workspace-aware plugins
 */
export interface MulmoClaudeToolContextApp extends ToolContextApp {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  workspacePath: () => string;
}

/**
 * MulmoClaude ToolPlugin — no app-specific server response type needed
 */
export type ToolPlugin<T = unknown, J = unknown, A extends object = object> = BaseToolPlugin<T, J, A, InputHandler, Record<string, unknown>>;

/**
 * View-only plugin entry for the frontend registry.
 * Only the properties actually used on the client side are required.
 * This avoids contravariance issues with execute's args type parameter.
 */
export interface PluginEntry {
  toolDefinition: ToolDefinition;
  viewComponent?: Component;
  previewComponent?: Component;
}
