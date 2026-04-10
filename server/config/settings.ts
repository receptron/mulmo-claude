// Server tunables. Values here are things a deployment might want
// to override without touching route/handler logic. Per-route
// algorithm constants (e.g. stream buffer sizes, retry backoff
// factors) stay close to their use site.

// Default TCP port used when PORT env var is absent. Both the HTTP
// listener in server/index.ts and the internal URL construction in
// routes/agent.ts read this.
export const DEFAULT_SERVER_PORT = 3001;

// Characters kept from a user prompt when echoing it back as the
// title of a generated HTML result. Keeps the title row readable
// even when the prompt is a long paragraph.
export const HTML_TITLE_TRUNCATE_LENGTH = 50;

// Bounds on the X (Twitter) search MCP tool's max_results argument.
// The underlying API rejects values outside this range.
export const X_SEARCH_MIN_RESULTS = 10;
export const X_SEARCH_MAX_RESULTS = 100;
