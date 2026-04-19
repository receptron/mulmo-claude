// Helpers for the most common error-response pattern in route
// handlers:
//
//   return res.status(400).json({ error: "..." });
//
// Before consolidation this appeared in ~100 places, each handler
// hand-rolling the `{ error: string }` body and picking a status
// code. The helpers below keep the call site to one line while
// centralising the response shape so cross-cutting concerns
// (e.g. adding a `requestId` or `timestamp` later) only need to
// change here.
//
// All helpers return the `Response` object so callers can write
// either of:
//
//   return badRequest(res, "filePath is required");
//
//   badRequest(res, "filePath is required");
//   return;
//
// Non-`{ error: string }` shapes (e.g. `{ success: false, message }`
// returned by a handful of legacy routes, or multi-field error
// bodies) stay as explicit `res.status(N).json(...)` calls — the
// helpers intentionally cover only the dominant pattern.

import type { Response } from "express";

/** Send a `{ error: string }` body with the given HTTP status. */
export function sendError(
  res: Response,
  status: number,
  error: string,
): Response {
  return res.status(status).json({ error });
}

/** 400 Bad Request — malformed input, missing required field, etc. */
export function badRequest(res: Response, error: string): Response {
  return sendError(res, 400, error);
}

/** 401 Unauthorized — missing or invalid credentials. */
export function unauthorized(res: Response, error: string): Response {
  return sendError(res, 401, error);
}

/** 403 Forbidden — auth present but not authorised for the resource. */
export function forbidden(res: Response, error: string): Response {
  return sendError(res, 403, error);
}

/** 404 Not Found — resource doesn't exist. */
export function notFound(res: Response, error: string): Response {
  return sendError(res, 404, error);
}

/** 409 Conflict — duplicate, concurrent modification, already running, etc. */
export function conflict(res: Response, error: string): Response {
  return sendError(res, 409, error);
}

/** 500 Internal Server Error — unexpected failure on the server side. */
export function serverError(res: Response, error: string): Response {
  return sendError(res, 500, error);
}
