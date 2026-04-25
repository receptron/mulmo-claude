// Env-var scraper for the relay path's bridge options bag (#739).
//
// Mirrors `readBridgeEnvOptions` in `@mulmobridge/client` (PR #729),
// but for the relay world: one MulmoClaude server process consumes
// many platforms (LINE / WhatsApp / Messenger / Google Chat / Teams
// / …) so the prefix is `RELAY_<PLATFORM>_*` instead of
// `<TRANSPORT>_BRIDGE_*`. The two helpers parallel each other; we
// keep them separate to avoid premature consolidation — each side's
// prefix logic is small and stable.
//
// Env scheme:
//
//   RELAY_<KEY>             — blanket fallback for every platform
//   RELAY_<PLATFORM>_<KEY>  — per-platform override (wins on clash)
//
// Both forms strip the prefix and convert the `UPPER_SNAKE` tail to
// `lowerCamel`. Empty-string values are dropped so a stray
// `FOO=""` doesn't shadow `BAR`'s match. Platform names with dashes
// (`google-chat`) are normalised to underscores in the env prefix:
// `google-chat` → `RELAY_GOOGLE_CHAT_*`. Dashes break shells; `_`
// is the portable convention.
//
// **Allowlist guard**: bridges keep secrets out of the scrape via
// the `_BRIDGE_` marker (`SLACK_BOT_TOKEN` has no `_BRIDGE_`, so
// it's never scraped). The relay scheme has no such marker — every
// `RELAY_*` would otherwise be a candidate, and we have real
// infrastructure secrets in that namespace (`RELAY_TOKEN`,
// `RELAY_URL`). To prevent leakage into `bridgeOptions` (which is
// forwarded to the agent and may be logged), the helper only emits
// keys in `RECOGNISED_KEYS`. Adding a new option (e.g. a future
// `RELAY_LINE_SOURCEWATCH`) is a deliberate one-line edit here —
// friction is the point.
//
// Resolution at startup:
//
//   RELAY_DEFAULT_ROLE=general
//   RELAY_LINE_DEFAULT_ROLE=line-support
//
//   resolveRelayBridgeOptions("line", env)       → { defaultRole: "line-support" }
//   resolveRelayBridgeOptions("whatsapp", env)   → { defaultRole: "general" }
//   resolveRelayBridgeOptions("google-chat", env) // reads RELAY_GOOGLE_CHAT_*

const BLANKET_PREFIX = "RELAY_";

// Closed set of bridge-option keys the relay path may forward.
// Stored in lowerCamel form (the bag's wire shape). Adding a new
// recognized option means appending one entry here.
const RECOGNISED_KEYS: ReadonlySet<string> = new Set(["defaultRole"]);

// Convert UPPER_SNAKE_CASE → lowerCamelCase. Empty input → empty
// string. Adjacent underscores collapse to single word breaks.
function snakeToLowerCamel(snake: string): string {
  const parts = snake
    .toLowerCase()
    .split("_")
    .filter((segment) => segment.length > 0);
  if (parts.length === 0) return "";
  const [head, ...rest] = parts;
  return head + rest.map((part) => part[0].toUpperCase() + part.slice(1)).join("");
}

// Build the per-platform prefix for a given platform name. Same
// normalisation as bridges' `<TRANSPORT>_BRIDGE_` — uppercase plus
// dashes-to-underscores. A blank platform yields `null` (caller
// then only resolves the blanket form).
function platformPrefix(platform: string): string | null {
  const normalised = platform.toUpperCase().replace(/-/g, "_");
  if (normalised.length === 0) return null;
  return `RELAY_${normalised}_`;
}

interface PrefixMatch {
  tail: string;
  scope: "platform" | "blanket";
}

// Strip whichever matching prefix applies. The per-platform prefix
// is checked first so its longer form wins precedence when a name
// could match both shapes (e.g. `RELAY_LINE_DEFAULT_ROLE` matches
// `RELAY_LINE_` but also `RELAY_` — the platform branch claims it).
function matchPrefix(name: string, perPlatformPrefix: string | null): PrefixMatch | null {
  if (perPlatformPrefix !== null && name.startsWith(perPlatformPrefix)) {
    const tail = name.slice(perPlatformPrefix.length);
    return tail.length > 0 ? { tail, scope: "platform" } : null;
  }
  if (name.startsWith(BLANKET_PREFIX)) {
    const tail = name.slice(BLANKET_PREFIX.length);
    return tail.length > 0 ? { tail, scope: "blanket" } : null;
  }
  return null;
}

/**
 * Read `RELAY_*` and `RELAY_<PLATFORM>_*` env vars into a
 * lowerCamel-keyed bag suitable for `relay({ ..., bridgeOptions })`.
 *
 * Per-platform overrides shared on conflict. Empty-string values are
 * skipped. Keys not in `RECOGNISED_KEYS` are dropped — protects
 * `RELAY_TOKEN` / `RELAY_URL` (infrastructure secrets) from leaking
 * into chat sessions. Returns an empty object when no relevant vars
 * are set — always safe to forward to `relay()`.
 */
export function resolveRelayBridgeOptions(platform: string, env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const perPlatformPrefix = platformPrefix(platform);
  const shared: Record<string, string> = {};
  const specific: Record<string, string> = {};

  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string" || value.length === 0) continue;
    const match = matchPrefix(name, perPlatformPrefix);
    if (match === null) continue;
    const key = snakeToLowerCamel(match.tail);
    if (!key) continue;
    if (!RECOGNISED_KEYS.has(key)) continue;
    if (match.scope === "platform") {
      specific[key] = value;
    } else {
      shared[key] = value;
    }
  }

  // Spread order — shared first, specific second — gives the
  // "per-platform overrides blanket" precedence in one line.
  return { ...shared, ...specific };
}
