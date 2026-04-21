// Seed a synthetic tool result when switching to a role that has a
// "default view". Extracted from App.vue so the component stays lean.

import { v4 as uuidv4 } from "uuid";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ActiveSession } from "../../types/session";
import { BUILTIN_ROLE_IDS } from "../../config/roles";
import { apiGet } from "../api";
import { API_ROUTES } from "../../config/apiRoutes";
import { pushResult, pushErrorMessage } from "./sessionHelpers";

export async function maybeSeedRoleDefault(session: ActiveSession): Promise<void> {
  if (session.roleId !== BUILTIN_ROLE_IDS.sourceManager) return;
  // Pre-fetch guard: skip the network call entirely if the session
  // already has content (user typed fast, or a previous seed ran).
  if (session.toolResults.length > 0) return;
  const response = await apiGet<{ sources?: unknown[] }>(API_ROUTES.sources.list);
  if (!response.ok) {
    if (session.toolResults.length === 0) {
      const detail = response.status === 0 ? response.error : `HTTP ${response.status}`;
      pushErrorMessage(session, `Could not preload sources (${detail}). Ask Claude to list them, or check the server log.`);
    }
    return;
  }
  const result: ToolResultComplete = {
    uuid: uuidv4(),
    toolName: "manageSource",
    message: "Loaded source registry.",
    title: "Information sources",
    data: { sources: response.data.sources ?? [] },
  };
  if (session.toolResults.length > 0) return;
  pushResult(session, result);
  session.selectedResultUuid = result.uuid;
}
