// Request-body construction for `POST /api/agent`.
//
// Extracted from `src/App.vue#sendMessage` as part of the
// cognitive-complexity refactor tracked in #175. The inline
// `Object.fromEntries(...filter(entry is [string, string]))`
// pluginPrompts pipeline accounted for a chunk of sendMessage's
// CC score and was hard to exercise without standing up the
// whole Vue component. Pure helpers here, tested in isolation.

import type { Role } from "../../config/roles";

export interface AgentRequestBodyParams {
  message: string;
  role: Role;
  chatSessionId: string;
  systemPrompt: string;
  selectedImageData?: string;
  /**
   * Looks up a plugin by name. Returns an object with an optional
   * `systemPrompt` string. Kept as a narrow interface so callers
   * don't need to drag the whole plugin registry type in.
   */
  getPluginSystemPrompt: (name: string) => string | undefined;
}

export interface AgentRequestBody {
  message: string;
  roleId: string;
  chatSessionId: string;
  selectedImageData: string | undefined;
  systemPrompt: string;
  pluginPrompts: Record<string, string>;
}

// Build the `pluginPrompts` map from a role's `availablePlugins`
// list. For each plugin with a defined `systemPrompt` string we
// emit `[name, prompt]`; plugins without a prompt are skipped
// entirely (not emitted with `undefined`, not emitted with empty
// string). Pure.
export function buildPluginPromptsMap(
  availablePlugins: readonly string[],
  getPluginSystemPrompt: (name: string) => string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of availablePlugins) {
    const prompt = getPluginSystemPrompt(name);
    if (typeof prompt === "string" && prompt.length > 0) {
      out[name] = prompt;
    }
  }
  return out;
}

// Assemble the full request body. Pure — the caller passes in
// everything it needs (no reactive refs read inside here). Mostly
// a named-field adapter but it also handles the pluginPrompts
// construction and the `selectedImageData` pass-through.
export function buildAgentRequestBody(
  params: AgentRequestBodyParams,
): AgentRequestBody {
  return {
    message: params.message,
    roleId: params.role.id,
    chatSessionId: params.chatSessionId,
    selectedImageData: params.selectedImageData,
    systemPrompt: params.systemPrompt,
    pluginPrompts: buildPluginPromptsMap(
      params.role.availablePlugins,
      params.getPluginSystemPrompt,
    ),
  };
}
