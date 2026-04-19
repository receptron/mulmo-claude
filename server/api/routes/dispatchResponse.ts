// Shared HTTP response plumbing for dispatcher-style POST routes
// (currently todos and scheduler). Both routes follow the same
// pattern: load items, run a pure dispatch function that returns a
// discriminated `{ kind: "error" | "success" }` result, persist on
// success when applicable, and translate to JSON. This module owns
// the translation step so each route handler stays a few lines.

import type { Response } from "express";
import { errorMessage } from "../../utils/errors.js";
import { sendError, serverError } from "../../utils/httpError.js";

export type DispatchResult<T> =
  | { kind: "error"; status: number; error: string }
  | {
      kind: "success";
      items: T[];
      message: string;
      jsonData: Record<string, unknown>;
    };

export interface DispatchSuccessResponse<T> {
  data: { items: T[] };
  message: string;
  jsonData: Record<string, unknown>;
  instructions: string;
  updating: boolean;
}

export interface DispatchErrorResponse {
  error: string;
}

export interface RespondOptions<T> {
  // Whether to call the persist callback before responding. Different
  // routes have different read-only action rules (e.g. todos has a
  // READ_ONLY_ACTIONS set, scheduler exempts only "show"), so the
  // caller decides per-request.
  shouldPersist: boolean;
  // Per-route instructions string baked into the response.
  instructions: string;
  // Persistence callback. Called with the post-dispatch items only
  // when shouldPersist is true.
  persist: (items: T[]) => void;
}

// Translate a DispatchResult into the JSON response shape used by
// dispatcher-style routes. Side-effects: calls `options.persist` on
// success when `options.shouldPersist` is true; writes the response.
//
// Persistence failures are caught and translated into a structured
// 500 JSON error so the route's response contract stays consistent —
// otherwise an fs.writeFileSync throw would bubble out and trigger
// Express's default HTML error page instead of the JSON shape that
// clients expect.
export function respondWithDispatchResult<T>(
  res: Response<DispatchSuccessResponse<T> | DispatchErrorResponse>,
  result: DispatchResult<T>,
  options: RespondOptions<T>,
): void {
  if (result.kind === "error") {
    sendError(res, result.status, result.error);
    return;
  }
  if (options.shouldPersist) {
    try {
      options.persist(result.items);
    } catch (err) {
      serverError(res, `Failed to persist changes: ${errorMessage(err)}`);
      return;
    }
  }
  res.json({
    data: { items: result.items },
    message: result.message,
    jsonData: result.jsonData,
    instructions: options.instructions,
    updating: true,
  });
}
