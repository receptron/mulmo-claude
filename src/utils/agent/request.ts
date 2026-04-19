// Request-body construction for `POST /api/agent`.

import type { Role } from "../../config/roles";

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

export function buildAgentRequestBody(
  params: AgentRequestBodyParams,
): AgentRequestBody {
  return {
    message: params.message,
    roleId: params.role.id,
    chatSessionId: params.chatSessionId,
    selectedImageData: params.selectedImageData,
  };
}
