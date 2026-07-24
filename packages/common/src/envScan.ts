// The one env-scrape algorithm (#2487) behind the prefixed options bags:
// `readBridgeEnvOptions` (@mulmobridge/client) and the host's
// `resolveRelayBridgeOptions` are thin wrappers over `scanEnvOptions`.
//
// Semantics both wrappers rely on:
// - `prefixes` are ordered LOW → HIGH precedence: when two vars yield the
//   same key, the value from the later prefix wins.
// - The highest-precedence prefix that matches a name CLAIMS it. A claimed
//   name with an empty tail is dropped outright — never retried against a
//   lower-precedence prefix.
// - Empty-string values are dropped so a stray `FOO=""` doesn't shadow
//   another var's match.
// - Tails convert `UPPER_SNAKE` → `lowerCamel`; an all-underscore tail
//   camelises to `""` and is dropped.
// - `allowKeys` (lowerCamel form), when present, drops every other key.
//   This is how the relay wrapper keeps `RELAY_TOKEN` / `RELAY_URL`
//   infrastructure secrets out of a bag that is forwarded to the agent
//   and may be logged — treat the filter as a security boundary.

export interface ScanEnvOptionsConfig {
  /** Ordered LOW → HIGH precedence — on a key clash the later prefix wins. */
  prefixes: readonly string[];
  /** Closed set of emitted keys (lowerCamel). Absent = emit every key. */
  allowKeys?: ReadonlySet<string>;
}

/** Convert `UPPER_SNAKE_CASE` → `lowerCamelCase`. Adjacent underscores
 *  collapse to a single word break; empty / all-underscore input → `""`. */
export function snakeToLowerCamel(snake: string): string {
  const parts = snake
    .toLowerCase()
    .split("_")
    .filter((segment) => segment.length > 0);
  if (parts.length === 0) return "";
  const [head, ...rest] = parts;
  return head + rest.map((part) => part[0].toUpperCase() + part.slice(1)).join("");
}

interface PrefixClaim {
  precedence: number;
  tail: string;
}

function claimByHighestPrefix(name: string, prefixes: readonly string[]): PrefixClaim | null {
  const claimed = prefixes
    .map((prefix, precedence) => ({ prefix, precedence }))
    .reverse()
    .find(({ prefix }) => name.startsWith(prefix));
  if (claimed === undefined) return null;
  return { precedence: claimed.precedence, tail: name.slice(claimed.prefix.length) };
}

interface ScannedOption {
  precedence: number;
  key: string;
  value: string;
}

function scanEnvEntry(name: string, value: string | undefined, config: ScanEnvOptionsConfig): ScannedOption | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const claim = claimByHighestPrefix(name, config.prefixes);
  if (claim === null || claim.tail.length === 0) return null;
  const key = snakeToLowerCamel(claim.tail);
  if (key.length === 0) return null;
  if (config.allowKeys !== undefined && !config.allowKeys.has(key)) return null;
  return { precedence: claim.precedence, key, value };
}

/** Scrape prefixed env vars into a lowerCamel-keyed string bag. */
export function scanEnvOptions(env: Readonly<Record<string, string | undefined>>, config: ScanEnvOptionsConfig): Record<string, string> {
  return Object.entries(env)
    .flatMap(([name, value]) => {
      const scanned = scanEnvEntry(name, value, config);
      return scanned === null ? [] : [scanned];
    })
    .sort((left, right) => left.precedence - right.precedence)
    .reduce<Record<string, string>>((bag, { key, value }) => ({ ...bag, [key]: value }), {});
}
