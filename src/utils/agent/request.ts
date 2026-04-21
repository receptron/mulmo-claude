// Request-body construction and dispatch for `POST /api/agent`.

import type { Role } from "../../config/roles";
import { API_ROUTES } from "../../config/apiRoutes";
import { apiFetchRaw } from "../api";

export interface AgentRequestBodyParams {
  message: string;
  role: Role;
  chatSessionId: string;
  selectedImageData?: string;
}

export interface AgentRequestBody {
  message: string;
  roleId: string;
  chatSessionId: string;
  selectedImageData: string | undefined;
}

export function buildAgentRequestBody(params: AgentRequestBodyParams): AgentRequestBody {
  return {
    message: params.message,
    roleId: params.role.id,
    chatSessionId: params.chatSessionId,
    selectedImageData: params.selectedImageData,
  };
}

/** POST the agent request body and return the response.
 *  On network or HTTP error, returns a descriptive error string
 *  instead. The caller decides how to surface it. */
export async function postAgentRun(body: AgentRequestBody): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await apiFetchRaw(API_ROUTES.agent.run, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Server error ${response.status}: ${errBody.slice(0, 200)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    console.error("[agent] fetch error:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Connection error.",
    };
  }
}
