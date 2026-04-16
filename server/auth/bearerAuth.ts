// Bearer token middleware (#272). Reject any `/api/*` request whose
// `Authorization: Bearer <token>` header doesn't match the current
// server token.
//
// This is the local-process isolation layer. `csrfGuard.ts` handles
// cross-origin browser attacks (layered on top, both must pass). This
// middleware handles the case a sibling process on the same machine
// (malicious program, another user, confused script) tries to hit
// `/api/*`: without the startup-regenerated token, every request is
// 401'd.
//
// Design choices:
// - **No exemptions**. Health, plugin list, everything. If a future
//   use case legitimately needs an unauth endpoint, add it explicitly.
// - **No token in logs**. Reject messages are generic ("unauthorized")
//   so a leaked log line doesn't reveal whether "no header" vs
//   "wrong token" — matches common auth-hardening guidance.
// - **Token comparison is `===`**. These are 64-char hex strings of
//   identical length, so early-exit timing on length is moot. A
//   length-mismatched header is already caught at the shape check,
//   leaving only equal-length compares for real candidates.

import type { Request, Response, NextFunction } from "express";
import { getCurrentToken } from "./token.js";
import { unauthorized } from "../utils/httpError.js";

const BEARER_PREFIX = "Bearer ";

export function bearerAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = getCurrentToken();
  if (expected === null) {
    // Server hasn't finished bootstrap. This can only happen if a
    // request beats `generateAndWriteToken()` to completion — the
    // server fixes that by generating before `app.listen`, but we
    // still defend the middleware against out-of-order init.
    unauthorized(res, "unauthorized");
    return;
  }
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) {
    unauthorized(res, "unauthorized");
    return;
  }
  const provided = header.slice(BEARER_PREFIX.length);
  if (provided !== expected) {
    unauthorized(res, "unauthorized");
    return;
  }
  next();
}
