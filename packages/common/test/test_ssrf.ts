// These cases are the boundary between "fetch a remote resource" and "let a
// model-authored / remote-user-supplied URL probe the host's own network".

/* eslint-disable sonarjs/no-hardcoded-ip -- literal addresses are the fixtures
   under test here; parameterising them would test nothing. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ipv4ToInt, isBlockedIpv4, isBlockedIpv6, isBlockedIp, isBlockedHostname, parseSafeUrlShape, stripIpv6Brackets } from "../src/ssrf.ts";

// ── ipv4ToInt ──────────────────────────────────────────────────────

test("ipv4ToInt: dotted decimal converts, endpoints included", () => {
  assert.equal(ipv4ToInt("0.0.0.0"), 0);
  assert.equal(ipv4ToInt("0.0.0.1"), 1);
  assert.equal(ipv4ToInt("255.255.255.255"), 0xffffffff);
});

test("ipv4ToInt: rejects malformed input", () => {
  assert.equal(ipv4ToInt(""), null);
  assert.equal(ipv4ToInt("1.2.3"), null);
  assert.equal(ipv4ToInt("1.2.3.4.5"), null);
  assert.equal(ipv4ToInt("1.2.3.256"), null);
  assert.equal(ipv4ToInt("1.2.3.-1"), null);
  assert.equal(ipv4ToInt("0x7f.0.0.1"), null);
  assert.equal(ipv4ToInt("1.2.3. 4"), null);
  assert.equal(ipv4ToInt("example.com"), null);
});

// ── isBlockedIpv4: every CIDR edge ─────────────────────────────────

test("isBlockedIpv4: both edges of every blocked range are blocked", () => {
  const edges: readonly (readonly [string, string])[] = [
    ["0.0.0.0", "0.255.255.255"], // 0.0.0.0/8
    ["10.0.0.0", "10.255.255.255"], // 10.0.0.0/8
    ["100.64.0.0", "100.127.255.255"], // 100.64.0.0/10
    ["127.0.0.0", "127.255.255.255"], // 127.0.0.0/8
    ["169.254.0.0", "169.254.255.255"], // 169.254.0.0/16
    ["172.16.0.0", "172.31.255.255"], // 172.16.0.0/12
    ["192.0.0.0", "192.0.0.255"], // 192.0.0.0/24
    ["192.168.0.0", "192.168.255.255"], // 192.168.0.0/16
    ["198.18.0.0", "198.19.255.255"], // 198.18.0.0/15
    ["224.0.0.0", "239.255.255.255"], // 224.0.0.0/4
    ["240.0.0.0", "255.255.255.255"], // 240.0.0.0/4
  ];
  edges.forEach(([first, last]) => {
    assert.equal(isBlockedIpv4(first), true, `${first} must be blocked`);
    assert.equal(isBlockedIpv4(last), true, `${last} must be blocked`);
  });
});

test("isBlockedIpv4: addresses one past each range edge are allowed", () => {
  const neighbours = [
    "1.0.0.0", // just past 0.0.0.0/8
    "9.255.255.255",
    "11.0.0.0", // around 10.0.0.0/8
    "100.63.255.255",
    "100.128.0.0", // around 100.64.0.0/10
    "126.255.255.255",
    "128.0.0.0", // around 127.0.0.0/8
    "169.253.255.255",
    "169.255.0.0", // around 169.254.0.0/16
    "172.15.255.255",
    "172.32.0.0", // around 172.16.0.0/12
    "191.255.255.255",
    "192.0.1.0", // around 192.0.0.0/24
    "192.167.255.255",
    "192.169.0.0", // around 192.168.0.0/16
    "198.17.255.255",
    "198.20.0.0", // around 198.18.0.0/15
    "223.255.255.255", // just before 224.0.0.0/4 (240/4 runs to the top)
  ];
  neighbours.forEach((address) => {
    assert.equal(isBlockedIpv4(address), false, `${address} must be allowed`);
  });
});

test("isBlockedIpv4: ordinary public addresses are allowed", () => {
  assert.equal(isBlockedIpv4("1.1.1.1"), false);
  assert.equal(isBlockedIpv4("8.8.8.8"), false);
  assert.equal(isBlockedIpv4("93.184.216.34"), false);
});

test("isBlockedIpv4: cloud metadata endpoint is blocked", () => {
  assert.equal(isBlockedIpv4("169.254.169.254"), true);
});

test("isBlockedIpv4: non-IPv4 input is not classified as blocked", () => {
  // "false" here means "not a blocked literal", not "safe" — urlGuard passes
  // hostnames through this on the way to DNS; httpClient's boundary rejects
  // non-IP input itself.
  assert.equal(isBlockedIpv4("example.com"), false);
  assert.equal(isBlockedIpv4(""), false);
  assert.equal(isBlockedIpv4("999.1.1.1"), false);
});

// ── isBlockedIpv6 ──────────────────────────────────────────────────

test("isBlockedIpv6: loopback and unspecified are blocked, brackets stripped", () => {
  assert.equal(isBlockedIpv6("::1"), true);
  assert.equal(isBlockedIpv6("::"), true);
  assert.equal(isBlockedIpv6("[::1]"), true);
});

test("isBlockedIpv6: fc00::/7 unique-local across its whole width", () => {
  assert.equal(isBlockedIpv6("fc00::1"), true);
  assert.equal(isBlockedIpv6("fd12:3456::1"), true);
  assert.equal(isBlockedIpv6("fdff:ffff::1"), true);
  assert.equal(isBlockedIpv6("fbff::1"), false); // just below fc00::/7
  assert.equal(isBlockedIpv6("fe00::1"), false); // just above fc00::/7
});

test("isBlockedIpv6: fe80::/10 link-local across its whole width", () => {
  assert.equal(isBlockedIpv6("fe80::1"), true);
  // pre-#2459 httpClient prefix-matched the string "fe80" and missed these
  assert.equal(isBlockedIpv6("fe9a::1"), true);
  assert.equal(isBlockedIpv6("febf::1"), true);
  assert.equal(isBlockedIpv6("fe7f::1"), false); // just below fe80::/10
  assert.equal(isBlockedIpv6("fec0::1"), false); // just above fe80::/10
});

test("isBlockedIpv6: IPv4-mapped forms re-enter the v4 rules", () => {
  assert.equal(isBlockedIpv6("::ffff:127.0.0.1"), true);
  assert.equal(isBlockedIpv6("::ffff:169.254.169.254"), true);
  assert.equal(isBlockedIpv6("::ffff:10.0.0.1"), true);
  assert.equal(isBlockedIpv6("::ffff:1.1.1.1"), false);
});

test("isBlockedIpv6: hex-spelled IPv4-mapped forms too (WHATWG URL serialization)", () => {
  // pre-#2459 urlGuard matched only the dotted spelling, so a URL like
  // http://[::ffff:127.0.0.1]/ — which the URL parser hands over as
  // ::ffff:7f00:1 — walked straight through the guard.
  assert.equal(isBlockedIpv6("::ffff:7f00:1"), true); // 127.0.0.1
  assert.equal(isBlockedIpv6("::ffff:a9fe:a9fe"), true); // 169.254.169.254
  assert.equal(isBlockedIpv6("::ffff:a00:1"), true); // 10.0.0.1
  assert.equal(isBlockedIpv6("::ffff:101:101"), false); // 1.1.1.1
});

test("isBlockedIpv6: public addresses and junk are not blocked", () => {
  assert.equal(isBlockedIpv6("2606:4700:4700::1111"), false);
  assert.equal(isBlockedIpv6("2001:db8::1"), false);
  assert.equal(isBlockedIpv6("zz::1"), false);
});

// ── isBlockedIp ────────────────────────────────────────────────────

test("isBlockedIp: dispatches on the presence of a colon", () => {
  assert.equal(isBlockedIp("127.0.0.1"), true);
  assert.equal(isBlockedIp("::1"), true);
  assert.equal(isBlockedIp("1.1.1.1"), false);
  assert.equal(isBlockedIp("2606:4700:4700::1111"), false);
});

test("isBlockedIp: hostnames pass through unblocked", () => {
  assert.equal(isBlockedIp("example.com"), false);
  assert.equal(isBlockedIp("localhost"), false); // names are isBlockedHostname's job
});

// ── isBlockedHostname ──────────────────────────────────────────────

test("isBlockedHostname: exact names, case-folded, trailing dot ignored", () => {
  assert.equal(isBlockedHostname("localhost"), true);
  assert.equal(isBlockedHostname("LOCALHOST"), true);
  assert.equal(isBlockedHostname("localhost."), true);
  assert.equal(isBlockedHostname("ip6-localhost"), true);
  assert.equal(isBlockedHostname("ip6-loopback"), true);
});

test("isBlockedHostname: internal-looking suffixes", () => {
  assert.equal(isBlockedHostname("foo.localhost"), true);
  assert.equal(isBlockedHostname("printer.local"), true);
  assert.equal(isBlockedHostname("db.internal"), true);
  assert.equal(isBlockedHostname("api.corp.INTERNAL"), true);
});

test("isBlockedHostname: ordinary public names are allowed", () => {
  assert.equal(isBlockedHostname("example.com"), false);
  assert.equal(isBlockedHostname("internal.example.com"), false); // suffix, not label match
  assert.equal(isBlockedHostname("localhost.example.com"), false);
  assert.equal(isBlockedHostname(""), false);
});

// ── stripIpv6Brackets ──────────────────────────────────────────────

test("stripIpv6Brackets: strips only enclosing brackets", () => {
  assert.equal(stripIpv6Brackets("[::1]"), "::1");
  assert.equal(stripIpv6Brackets("::1"), "::1");
  assert.equal(stripIpv6Brackets("example.com"), "example.com");
});

// ── parseSafeUrlShape ──────────────────────────────────────────────

test("parseSafeUrlShape: accepts ordinary http(s) URLs", () => {
  assert.notEqual(parseSafeUrlShape("https://example.com/a.png"), null);
  assert.notEqual(parseSafeUrlShape("http://example.com:8080/x?y=z"), null);
});

test("parseSafeUrlShape: rejects non-http(s) schemes", () => {
  assert.equal(parseSafeUrlShape("file:///etc/passwd"), null);
  assert.equal(parseSafeUrlShape("ftp://example.com/a.png"), null);
  assert.equal(parseSafeUrlShape("data:image/png;base64,AAAA"), null);
});

test("parseSafeUrlShape: rejects unparseable input", () => {
  assert.equal(parseSafeUrlShape("not a url"), null);
  assert.equal(parseSafeUrlShape(""), null);
});

test("parseSafeUrlShape: rejects blocked hostnames", () => {
  assert.equal(parseSafeUrlShape("http://localhost:3001/x"), null);
  assert.equal(parseSafeUrlShape("http://LOCALHOST/x"), null);
  assert.equal(parseSafeUrlShape("http://foo.localhost/x"), null);
  assert.equal(parseSafeUrlShape("http://printer.local/x"), null);
  assert.equal(parseSafeUrlShape("http://db.internal/x"), null);
  assert.equal(parseSafeUrlShape("http://localhost./x"), null);
});

test("parseSafeUrlShape: rejects literal internal addresses", () => {
  assert.equal(parseSafeUrlShape("http://127.0.0.1/x"), null);
  assert.equal(parseSafeUrlShape("http://169.254.169.254/latest/meta-data/"), null);
  assert.equal(parseSafeUrlShape("http://[::1]/x"), null);
  assert.equal(parseSafeUrlShape("http://[fe80::1]/x"), null);
  assert.equal(parseSafeUrlShape("http://[::ffff:127.0.0.1]/x"), null);
});

test("parseSafeUrlShape: rejects alternate IPv4 notations of blocked addresses", () => {
  // Safe only because WHATWG URL canonicalizes these to dotted-decimal before
  // isBlockedIpv4 runs — pin that invariant so a refactor away from `new URL`
  // (or an engine/polyfill quirk) can't silently reintroduce the classic
  // decimal/hex/octal/shorthand blocklist bypass.
  assert.equal(parseSafeUrlShape("http://2130706433/x"), null); // decimal
  assert.equal(parseSafeUrlShape("http://0x7f000001/x"), null); // hex
  assert.equal(parseSafeUrlShape("http://0177.0.0.1/x"), null); // octal
  assert.equal(parseSafeUrlShape("http://127.1/x"), null); // shorthand
});

test("parseSafeUrlShape: allows literal public addresses", () => {
  assert.notEqual(parseSafeUrlShape("https://1.1.1.1/a.png"), null);
  assert.notEqual(parseSafeUrlShape("https://[2606:4700:4700::1111]/a.png"), null);
});
