// The single SSRF deny-list for the monorepo: address classification and
// URL-shape checks shared by every guard that fetches model-authored /
// remote-user-supplied URLs (mastodon bridge urlGuard, core feeds httpClient).
// Before #2459 the CIDR table was hand-copied per guard and had drifted.
//
// Everything here is pure and isomorphic — no `node:` builtins. The parts that
// need the network (DNS resolution, per-redirect re-checks) stay in each
// consumer's thin wrapper.

/* eslint-disable sonarjs/no-hardcoded-ip -- the blocked ranges ARE this module's
   specification; writing them as literals is the point, not an oversight. */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);
const BLOCKED_HOSTNAME_SUFFIXES = [".localhost", ".local", ".internal"];

/** IPv4 ranges that must never be fetched, as [firstAddress, prefixLength].
 *  The union of the pre-#2459 per-guard tables — removing an entry weakens
 *  every guard in the repo at once, so treat edits as security changes. */
export const BLOCKED_IPV4_RANGES: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — includes the 169.254.169.254 metadata endpoint
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved / broadcast
];

/** Dotted-decimal IPv4 → unsigned 32-bit value; null for anything else
 *  (hex / octal octets, whitespace, wrong part count). */
export function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some((octet) => Number.isNaN(octet) || octet > 255)) return null;
  return octets.reduce((value, octet) => value * 256 + octet, 0);
}

function isBlockedIpv4Value(value: number): boolean {
  return BLOCKED_IPV4_RANGES.some(([base, prefix]) => {
    const baseValue = ipv4ToInt(base);
    if (baseValue === null) return false;
    // `>>> 0` keeps the mask unsigned; a /0 shift would be a no-op anyway.
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (value & mask) === (baseValue & mask);
  });
}

/** True when this parses as IPv4 AND falls inside a blocked range. Non-IPv4
 *  input is false — "not a blocked literal", not "safe"; a caller that must
 *  reject non-IP input entirely does so at its own boundary. */
export function isBlockedIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return false;
  return isBlockedIpv4Value(value);
}

/** `URL.hostname` keeps the brackets on an IPv6 literal (`[::1]`); strip them
 *  so the address checks see the bare address. */
export function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "");
}

/** The 32-bit value inside an IPv4-mapped IPv6 literal, or null when the
 *  address is not v4-mapped. The hex spelling matters: WHATWG URL serializes
 *  `[::ffff:127.0.0.1]` as `::ffff:7f00:1`, so matching only the dotted form
 *  would wave the mapped loopback through any URL-sourced check. */
function mappedIpv4Value(lower: string): number | null {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return ipv4ToInt(dotted[1]);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) return Number.parseInt(hex[1], 16) * 0x10000 + Number.parseInt(hex[2], 16);
  return null;
}

/** Blocks loopback/unspecified, fc00::/7 unique-local, fe80::/10 link-local,
 *  and IPv4-mapped forms of blocked v4 addresses. Mask-based on the leading
 *  group — prefix string matching would miss e.g. fe9a:: (inside fe80::/10). */
export function isBlockedIpv6(address: string): boolean {
  const lower = stripIpv6Brackets(address.toLowerCase());
  if (lower === "::1" || lower === "::") return true;
  // IPv4-mapped re-enters the v4 rules.
  const mapped = mappedIpv4Value(lower);
  if (mapped !== null) return isBlockedIpv4Value(mapped);
  const [head] = lower.split(":");
  if (head.length === 0) return false;
  const leading = Number.parseInt(head, 16);
  if (Number.isNaN(leading)) return false;
  if ((leading & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((leading & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/** True when this literal address must never be fetched. Non-IP input is
 *  false — see `isBlockedIpv4`. */
export function isBlockedIp(address: string): boolean {
  return address.includes(":") ? isBlockedIpv6(address) : isBlockedIpv4(address);
}

/** Names that are internal by convention (localhost, *.local, *.internal…),
 *  rejected without waiting for DNS to prove it. */
export function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  return BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Parse and apply every check that doesn't need the network: shape, scheme,
 *  obviously-internal hostname, and literal addresses. Returns null on reject.
 *  Callers must still vet what non-literal hostnames resolve to. */
export function parseSafeUrlShape(raw: string): URL | null {
  const url = parseUrl(raw);
  if (url === null) return null;
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  const hostname = stripIpv6Brackets(url.hostname);
  if (hostname.length === 0) return null;
  if (isBlockedHostname(hostname)) return null;
  if (isBlockedIp(hostname)) return null;
  return url;
}
