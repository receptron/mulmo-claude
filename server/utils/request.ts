// Express request helpers — shared query/param extraction.
//
// Centralizes patterns that were duplicated across route handlers
// (3+ different ways to read `req.query.session`).

// Use a minimal interface so the helpers work with any Express
// Request generic (Request<object, ...>, Request<Params, ...>, etc.)
// without type incompatibility.
interface HasQuery {
  query: Record<string, unknown>;
}

/**
 * Extract the session ID from `req.query.session`.
 * Returns the string value, or "" if missing/non-string.
 */
export function getSessionQuery(req: HasQuery): string {
  const raw = req.query.session;
  return typeof raw === "string" ? raw : "";
}

/**
 * Extract an optional string query parameter.
 * Returns the string value, or undefined if missing/non-string.
 */
export function getOptionalStringQuery(req: HasQuery, key: string): string | undefined {
  const raw = req.query[key];
  return typeof raw === "string" ? raw : undefined;
}
