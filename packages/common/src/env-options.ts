// The one env-var → options-bag scanner (#2487), shared by the bridges'
// `readBridgeEnvOptions` (`<TRANSPORT>_BRIDGE_*` / `BRIDGE_*`) and the relay
// path's `resolveRelayBridgeOptions` (`RELAY_<PLATFORM>_*` / `RELAY_*`).
// Both schemes are "two prefixes, specific beats shared, UPPER_SNAKE tail
// becomes a lowerCamel key"; only the prefix strings and the relay side's
// key allowlist differ, and both are parameters here.
//
// Pure and dependency-free, so any tier — Node bridges, the host, the
// Cloudflare Worker relay — can call it.

/** Convert `UPPER_SNAKE_CASE` to `lowerCamelCase`. Adjacent underscores
 *  collapse to a single word break; a tail with no word characters yields
 *  `""` (callers drop those). Leading digits are kept as-is. */
export function snakeToLowerCamel(snake: string): string {
  const parts = snake
    .toLowerCase()
    .split("_")
    .filter((segment) => segment.length > 0);
  if (parts.length === 0) return "";
  const [head, ...rest] = parts;
  return head + rest.map((part) => part[0].toUpperCase() + part.slice(1)).join("");
}

export interface EnvOptionScan {
  /** Env-name prefixes in **descending** precedence. The first prefix a name
   *  starts with claims it, so list the specific form before the shared one
   *  (`SLACK_BRIDGE_` before `BRIDGE_`). */
  prefixes: readonly string[];
  /** When set, only these lowerCamel keys are emitted. Use it whenever the
   *  prefix namespace also holds secrets (`RELAY_TOKEN`); omit it when the
   *  prefix itself already excludes them (`_BRIDGE_`). */
  allowKeys?: ReadonlySet<string>;
}

interface PrefixMatch {
  tail: string;
  /** Index into `prefixes` — lower means higher precedence. */
  rank: number;
}

/** Strip the highest-precedence matching prefix. A name whose tail is empty
 *  after stripping is rejected outright rather than retried against the
 *  lower-precedence prefixes. */
function matchPrefix(name: string, prefixes: readonly string[]): PrefixMatch | null {
  const rank = prefixes.findIndex((prefix) => name.startsWith(prefix));
  if (rank === -1) return null;
  const tail = name.slice(prefixes[rank].length);
  return tail.length > 0 ? { tail, rank } : null;
}

/**
 * Scrape `env` into a lowerCamel-keyed string bag.
 *
 * Empty-string and non-string values are skipped so a stray `FOO=""` can't
 * shadow a lower-precedence match. Values are never coerced — callers parse
 * numbers / booleans themselves. Returns `{}` when nothing matches.
 *
 * Example:
 *   scanEnvOptions({ SLACK_BRIDGE_DEFAULT_ROLE: "slack", BRIDGE_DEFAULT_ROLE: "general" },
 *                  { prefixes: ["SLACK_BRIDGE_", "BRIDGE_"] })
 *   → { defaultRole: "slack" }
 */
export function scanEnvOptions(env: Readonly<Record<string, string | undefined>>, { prefixes, allowKeys }: EnvOptionScan): Record<string, string> {
  const buckets: Record<string, string>[] = prefixes.map(() => ({}));

  Object.entries(env).forEach(([name, value]) => {
    if (typeof value !== "string" || value.length === 0) return;
    const match = matchPrefix(name, prefixes);
    if (match === null) return;
    const key = snakeToLowerCamel(match.tail);
    if (key.length === 0) return;
    if (allowKeys !== undefined && !allowKeys.has(key)) return;
    buckets[match.rank][key] = value;
  });

  // Merge lowest precedence first so earlier prefixes overwrite later ones.
  const merged: Record<string, string> = {};
  return buckets.reduceRight((acc, bucket) => Object.assign(acc, bucket), merged);
}
