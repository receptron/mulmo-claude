// Single source of truth for environment-variable reads.
//
// Before this module existed, `process.env.X` calls were sprinkled
// across 8 files with each call site doing its own type coercion
// (`Number(process.env.PORT) || 3001`, `process.env.X === "1"`, …).
// Renaming an env var, changing a default, or auditing what we read
// from the environment all required grepping the codebase.
//
// All env-var reads should now go through `env.*`. The exception is
// `server/logger/config.ts` which has its own self-contained env
// reader (`resolveConfig(env)`) — that subsystem stays independent
// because it's loaded at extremely early bootstrap and accepts an
// arbitrary `env`-shaped object for testability.
//
// `docs/developer.md` lists every env var and what it does; this
// module is the runtime side of that table.

// ── Type coercion helpers ───────────────────────────────────────────

function asInt(value: string | undefined, fallback: number, opts: { min?: number; max?: number } = {}): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  if (opts.min !== undefined && parsed < opts.min) return fallback;
  if (opts.max !== undefined && parsed > opts.max) return fallback;
  return parsed;
}

function asFlag(value: string | undefined): boolean {
  // Established convention in this project: env flags are "1"
  // (truthy) vs anything else (falsy). Avoids the trap of
  // `process.env.FOO === "false"` evaluating truthy as a string.
  return value === "1";
}

function asCsv(value: string | undefined): readonly string[] {
  return Object.freeze(
    (value ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

// ── Snapshot ────────────────────────────────────────────────────────

/**
 * Frozen snapshot of every env var the app reads, with type coercion
 * and defaults baked in. Read at module load time so tests can
 * import a stable view without re-reading process.env on every
 * access.
 */
export const env = Object.freeze({
  // HTTP server
  port: asInt(process.env.PORT, 3001, { min: 0, max: 65_535 }),
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",

  // Sandbox / Docker
  disableSandbox: asFlag(process.env.DISABLE_SANDBOX),
  // Host-credential opt-ins for the Docker sandbox (#259). Both off
  // by default. See docs/sandbox-credentials.md for the contract.
  sandboxSshAgentForward: asFlag(process.env.SANDBOX_SSH_AGENT_FORWARD),
  sandboxSshAllowedHosts: process.env.SANDBOX_SSH_ALLOWED_HOSTS || "github.com",
  sandboxMountConfigs: asCsv(process.env.SANDBOX_MOUNT_CONFIGS),

  // API credentials (undefined when not configured)
  geminiApiKey: process.env.GEMINI_API_KEY,
  xBearerToken: process.env.X_BEARER_TOKEN,

  // Bearer auth token (#272, #316): if set, the server uses this
  // verbatim instead of generating a fresh random token at startup.
  // Matches the env var already honoured by `bridges/_lib/token.ts`
  // and the Vite dev plugin, so pinning on both sides survives a
  // server restart. Undefined / empty → random-per-startup path.
  authTokenOverride: process.env.MULMOCLAUDE_AUTH_TOKEN,

  // Sessions index API
  sessionsListWindowDays: asInt(process.env.SESSIONS_LIST_WINDOW_DAYS, 90, {
    min: 0,
  }),

  // Debug-only force-run flags. Off by default; `=1` triggers an
  // immediate run on startup instead of waiting for the scheduled
  // interval.
  journalForceRunOnStartup: asFlag(process.env.JOURNAL_FORCE_RUN_ON_STARTUP),
  chatIndexForceRunOnStartup: asFlag(process.env.CHAT_INDEX_FORCE_RUN_ON_STARTUP),

  // macOS Reminder notification sink (#789). Darwin-only; iCloud
  // Reminders sync mirrors the entry to the user's iPhone, which
  // delivers the system notification. **On by default** on macOS —
  // first run will prompt the user for Reminders.app access, which
  // is the right place to consent. Set
  // `DISABLE_MACOS_REMINDER_NOTIFICATIONS=1` to opt out (e.g. for
  // a shared dev box where the iPhone owner shouldn't get pinged).
  // Mirrors the `DISABLE_SANDBOX` convention.
  disableMacosReminderNotifications: asFlag(process.env.DISABLE_MACOS_REMINDER_NOTIFICATIONS),

  // MulmoBridge Relay (#520). Optional — when both are set the server
  // connects to the Relay via WebSocket and forwards bridge messages.
  relayUrl: process.env.RELAY_URL,
  relayToken: process.env.RELAY_TOKEN,

  // MCP subprocess: set by the parent server when spawning
  // mcp-server.ts. The MCP process reads them via this same module —
  // OS-level env vars are shared across both processes.
  mcpSessionId: process.env.SESSION_ID ?? "",
  mcpHost: process.env.MCP_HOST ?? "localhost",
  mcpPluginNames: asCsv(process.env.PLUGIN_NAMES),
  mcpRoleIds: asCsv(process.env.ROLE_IDS),
});

// ── Derived helpers ─────────────────────────────────────────────────

/** True iff a Gemini API key is configured. Drives the "image
 *  generation available" hint in the UI. */
export function isGeminiAvailable(): boolean {
  return env.geminiApiKey !== undefined && env.geminiApiKey !== "";
}
