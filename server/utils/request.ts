// Express request helpers — shared query/param extraction.
//
// Centralizes patterns that were duplicated across route handlers
// (3+ different ways to read `req.query.session`).

// `query: object` so the helpers work with any Express Request
// generic — `Request<Params, ResBody, ReqBody, Query>`. A narrow
// `Query` generic like `{ path?: string }` isn't assignable to
// `Record<string, unknown>` (no index signature), so we widen to
// `object` and cast internally when reading a key.
interface HasQuery {
  query: object;
}

function readQueryKey(queryObj: object, key: string): unknown {
  return (queryObj as Record<string, unknown>)[key];
}

/**
 * Extract the session ID from `req.query.session`.
 * Returns the string value, or "" if missing/non-string.
 */
export function getSessionQuery(req: HasQuery): string {
  const raw = readQueryKey(req.query, "session");
  return typeof raw === "string" ? raw : "";
}

/**
 * Extract an optional string query parameter.
 * Returns the string value, or undefined if missing/non-string.
 */
export function getOptionalStringQuery(req: HasQuery, key: string): string | undefined {
  const raw = readQueryKey(req.query, key);
  return typeof raw === "string" ? raw : undefined;
}
