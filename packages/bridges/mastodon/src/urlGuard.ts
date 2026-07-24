// Guard for attachment URLs that arrive from remote Mastodon users.
//
// `handleNotification` fetches image URLs straight out of an incoming
// notification, and with `MASTODON_ALLOWED_ACCTS` unset every account on the
// fediverse can reach that path — so an unchecked fetch is a server-side
// request forgery primitive against whatever the bridge host can see
// (loopback services, RFC1918 neighbours, the cloud metadata endpoint).
//
// The pure address classification (deny-list, hostname blocklist, URL shape)
// lives in `@mulmoclaude/common/ssrf` (#2459); this wrapper adds only the
// `node:dns` resolution step.
//
// Residual risk worth knowing: the DNS answer we validate is not the one the
// subsequent fetch necessarily uses, so a rebinding attacker with a very short
// TTL can still slip through. Pinning the resolved address into the connection
// would need a custom agent; this raises the bar without that surgery.

import { lookup } from "node:dns/promises";
import { isBlockedIp, parseSafeUrlShape, stripIpv6Brackets } from "@mulmoclaude/common/ssrf";

/** Full check: shape rules, then every address the hostname resolves to.
 *  Returns the URL when it's safe to fetch, or null when it must be refused. */
export async function resolvePublicUrl(raw: string): Promise<URL | null> {
  const url = parseSafeUrlShape(raw);
  if (url === null) return null;
  const hostname = stripIpv6Brackets(url.hostname);
  // A literal address was already vetted above and has nothing to resolve.
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) return url;
  try {
    const addresses = await lookup(hostname, { all: true });
    if (addresses.length === 0) return null;
    return addresses.every((entry) => !isBlockedIp(entry.address)) ? url : null;
  } catch {
    return null;
  }
}
