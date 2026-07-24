# refactor(security): single-source the SSRF deny-list into @mulmoclaude/common/ssrf

Closes #2459.

## Problem

The CIDR deny-list table and address-classification logic for SSRF guarding is
hand-copied in 2 places (jscpd alert #405), with no "keep in sync" comment on
either side:

| File                                                | Content                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/bridges/mastodon/src/urlGuard.ts`         | `BLOCKED_V4_RANGES` + hostname blocklist + IPv4-mapped-IPv6 support |
| `packages/core/src/feeds/server/fetch/httpClient.ts` | same-shaped CIDR table, fewer entries                               |

**It has already drifted.** urlGuard blocks `192.0.0.0/24`, `198.18.0.0/15`,
`224.0.0.0/4`, `240.0.0.0/4` and rejects internal-by-convention hostnames
(`localhost`, `*.local`, `*.internal`, …); httpClient's table lacks all four
ranges and has no hostname blocklist. Two-way manual maintenance of security
code producing a real asymmetry is exactly the accident single-sourcing exists
to prevent.

## Why `@mulmoclaude/common`

- The classification is pure (no `node:` builtins needed) — common is the
  zero-dependency isomorphic leaf.
- Both consumers already depend on common, and it is the only shared tier they
  can both reach: the mastodon bridge cannot import `@mulmoclaude/core`.
- The `node:dns` resolution and redirect re-check cannot be isomorphic, so each
  package keeps that as a thin wrapper.

## Union decision (never weaken either side)

- **IPv4 table**: the union is urlGuard's 11-entry table (a strict superset of
  httpClient's 7). httpClient therefore now blocks 4 more ranges — intended
  tightening.
- **Hostname blocklist**: only urlGuard had one; adopting `parseSafeUrlShape`
  gives httpClient DNS-free rejection of `localhost` / `*.local` /
  `*.internal` names — further tightening, also intended.
- **IPv6**: both intended `::`/`::1`, `fc00::/7`, `fe80::/10`, IPv4-mapped.
  The shared impl uses urlGuard's mask-based leading-group check; httpClient's
  string-prefix version *under*-blocked `fe81::`–`febf::` (inside `fe80::/10`)
  and accidentally over-matched non-ULA literals like `fc0X::` / `00fd::`
  (IETF-reserved, never publicly routable). The mask version implements the
  ranges both files named in their comments.
- **IPv4-mapped hex spelling** (found by the new boundary tests): WHATWG URL
  serializes `[::ffff:127.0.0.1]` as `::ffff:7f00:1`, and BOTH pre-#2459 copies
  matched only the dotted spelling — so `http://[::ffff:127.0.0.1]/` walked
  through urlGuard's shape check unchallenged. The shared `mappedIpv4Value`
  parses both spellings; a regression test pins the URL-normalized form.
- **Malformed input**: the shared predicates classify literals only
  (non-IP → `false`), matching urlGuard, which feeds hostnames through them on
  the way to DNS. httpClient's stricter "non-IP DNS answer → block" default
  stays in its local `isBlockedResolvedIp` wrapper, so neither caller is
  weakened.

## Plan

1. Add `packages/common/src/ssrf.ts`, exported as `@mulmoclaude/common/ssrf`
   (exports-map entry with `types`/`import`/`require`/`default`, matching the
   existing subpaths): `BLOCKED_IPV4_RANGES` (union), `ipv4ToInt`,
   `isBlockedIpv4`, `isBlockedIpv6`, `isBlockedIp`, `isBlockedHostname`,
   `parseSafeUrlShape`, `stripIpv6Brackets`. No version bump (1.1.0 is already
   ahead of npm's 1.0.0 — pending publish).
2. `urlGuard.ts` shrinks to `resolvePublicUrl` (DNS wrapper) importing the
   shared predicates. `isBlockedAddress` / local `parseSafeUrlShape` exports go
   away (only `index.ts` imported from this module, and only
   `resolvePublicUrl`).
3. `httpClient.ts` drops its table + predicates; `assertFetchableUrl` runs
   `parseSafeUrlShape` and keeps its specific error messages, DNS lookup, and
   the manual redirect loop.
4. `docs/shared-utils.md`: add the Network-section row.

## Tests

- `packages/common/test/test_ssrf.ts` (common's `tsx --test test/test_*.ts`
  convention): both edges of all 11 CIDR ranges + one-past-the-edge neighbours,
  public IPs, IPv4-mapped-IPv6, `fc00::/7` / `fe80::/10` width (incl. the
  `fe9a::` case the old prefix match missed), hostname blocklist
  (case/trailing-dot/suffix vs. label), invalid inputs, URL-shape accept/reject.
- Mastodon `test_urlGuard.ts` keeps only the `resolvePublicUrl` wrapper cases;
  the moved pure cases live in common now.
- Core `test_httpClient.ts` pins the tightening: the 4 new ranges, hostname
  blocklist, IPv4-mapped-IPv6.
- Mutation check: temporarily delete `["198.18.0.0", 15]` from the table,
  confirm tests go red, restore.

## Publish-order constraint

`@mulmoclaude/common` must be published (with the `./ssrf` subpath) before the
next npm publish of `@mulmoclaude/core` or `@mulmobridge/mastodon`, or npm
installs of those will fail to resolve the new subpath. Workspace consumers are
unaffected (symlink + build order already put common in tier 1).
