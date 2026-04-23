// Env-var scraper for the bridge options bag.
//
// Bridges don't want to hand-maintain a forward-list of env vars
// that should travel to the host app. Instead we scrape a single
// dedicated prefix pattern at `createBridgeClient()` time:
//
//   <TRANSPORT>_BRIDGE_<KEY>  — transport-specific, wins on clash
//   BRIDGE_<KEY>              — shared default across every bridge
//
// Both forms strip the prefix and convert the `UPPER_SNAKE` tail to
// `lowerCamel`. Empty string values are dropped so a stray
// `FOO=""` doesn't shadow `BAR`'s match.
//
// The `_BRIDGE_` segment is deliberate: it lets the bridge keep its
// own secrets (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, …) naturally
// outside the scrape — they have no `_BRIDGE_` segment so they're
// never picked up, no reserved-list needed.

// Convert UPPER_SNAKE_CASE → lowerCamelCase. Leading digits and
// adjacent underscores degrade gracefully (adjacent underscores
// collapse to a single word break; leading digits are allowed but
// kept as-is after the first segment is lowercased).
function snakeToLowerCamel(snake: string): string {
  const parts = snake
    .toLowerCase()
    .split("_")
    .filter((segment) => segment.length > 0);
  if (parts.length === 0) return "";
  const [head, ...rest] = parts;
  return head + rest.map((part) => (part ? part[0].toUpperCase() + part.slice(1) : "")).join("");
}

// Strip the prefix, return null if the name doesn't match.
function matchBridgePrefix(name: string, transportPrefix: string): string | null {
  if (name.startsWith(transportPrefix)) {
    const tail = name.slice(transportPrefix.length);
    return tail.length > 0 ? tail : null;
  }
  if (name.startsWith("BRIDGE_")) {
    const tail = name.slice("BRIDGE_".length);
    return tail.length > 0 ? tail : null;
  }
  return null;
}

/**
 * Read `<TRANSPORT>_BRIDGE_*` and `BRIDGE_*` env vars into a
 * lowerCamelCase-keyed bag ready to hand to `createBridgeClient`.
 *
 * Precedence when the same key resolves from both forms:
 * transport-specific wins over shared.
 *
 * Example:
 *   SLACK_BRIDGE_DEFAULT_ROLE=slack
 *   BRIDGE_DEFAULT_ROLE=general
 *   → `{ defaultRole: "slack" }`
 */
export function readBridgeEnvOptions(transportId: string, env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const transportPrefix = `${transportId.toUpperCase()}_BRIDGE_`;
  const shared: Record<string, string> = {};
  const specific: Record<string, string> = {};

  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string" || value.length === 0) continue;
    const tail = matchBridgePrefix(name, transportPrefix);
    if (tail === null) continue;
    const key = snakeToLowerCamel(tail);
    if (!key) continue;
    if (name.startsWith(transportPrefix)) {
      specific[key] = value;
    } else {
      shared[key] = value;
    }
  }

  // Transport-specific overrides shared on conflict — spread order
  // (shared first, then specific) gives exactly that behaviour.
  return { ...shared, ...specific };
}
