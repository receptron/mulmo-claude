// Request-body construction and dispatch for `POST /api/agent`.

import type { Role } from "../../config/roles";
import { API_ROUTES } from "../../config/apiRoutes";
import { apiFetchRaw } from "../api";
import { errorMessage } from "../errors";
import { isNonEmptyString } from "../types";

/** Single attachment entry sent by the Vue UI on `POST /api/agent`.
 *  Path-only — the Vue side never ships base64 bytes anymore. The
 *  server reads the file from disk, infers the MIME type from the
 *  extension, and produces a content block for Claude. Bridges
 *  (Telegram / LINE / etc.) still send `{ mimeType, data }` over the
 *  socket transport; both shapes share the same `Attachment` type
 *  in `@mulmobridge/protocol`. */
export interface ClientAttachment {
  /** Workspace-relative path that exists under one of the allowed
   *  roots (`artifacts/images/...` or `data/attachments/...`). */
  path: string;
}

export interface AgentRequestBodyParams {
  message: string;
  role: Role;
  chatSessionId: string;
  /** Workspace-relative paths the user has attached or selected for
   *  this turn, in declaration order. The first entry is also surfaced
   *  to the LLM as an `[Attached file: <path>]` marker on the user
   *  message so path-passing tools (e.g. `editImages`) can quote it
   *  back. Empty / undefined when no file is attached. */
  attachmentPaths?: string[];
}

export interface AgentRequestBody {
  message: string;
  roleId: string;
  chatSessionId: string;
  attachments: ClientAttachment[] | undefined;
  // IANA identifier (e.g. "Asia/Tokyo", "America/New_York"). The
  // server uses this to interpret bare time expressions in the user's
  // message without asking for clarification every turn. Undefined if
  // the browser can't resolve a timezone — the server then falls back
  // to its own local time and asks as before.
  userTimezone: string | undefined;
}

// `Intl.DateTimeFormat().resolvedOptions().timeZone` can, in theory,
// throw in some locked-down environments; wrap so a broken Intl
// doesn't take down the send path.
function resolveBrowserTimezone(): string | undefined {
  try {
    const zoneId = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isNonEmptyString(zoneId) ? zoneId : undefined;
  } catch {
    return undefined;
  }
}

function buildAttachments(paths: string[] | undefined): ClientAttachment[] | undefined {
  if (!paths || paths.length === 0) return undefined;
  const entries: ClientAttachment[] = [];
  for (const candidate of paths) {
    if (typeof candidate === "string" && candidate.length > 0) {
      entries.push({ path: candidate });
    }
  }
  return entries.length > 0 ? entries : undefined;
}

export function buildAgentRequestBody(params: AgentRequestBodyParams): AgentRequestBody {
  return {
    message: params.message,
    roleId: params.role.id,
    chatSessionId: params.chatSessionId,
    attachments: buildAttachments(params.attachmentPaths),
    userTimezone: resolveBrowserTimezone(),
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
      error: errorMessage(err, "Connection error."),
    };
  }
}
