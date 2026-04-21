// CSRF defense: reject cross-origin state-changing requests.
//
// Complements the CORS / localhost-bind hardening in #148. With
// those in place, the browser refuses to expose response bodies
// to cross-origin callers, but the **request itself** still
// reaches the server. That's enough for a fire-and-forget side
// effect (e.g. `POST /api/chat-index/rebuild` spawning claude CLI
// in the background) to be triggered from an attacker page.
//
// This middleware checks the Origin header on every non-safe
// method and rejects anything that didn't come from localhost.
// Requests with NO Origin header are allowed — that's how
// non-browser callers (MCP tools, curl, CLI scripts) look, and
// they're trustable only because the server binds to 127.0.0.1
// (#148) so remote traffic can't reach us at all.
//
// Full design + threat model: plans/done/fix-server-csrf-origin-check.md

import type { Request, Response, NextFunction } from "express";
import { log } from "../system/logger/index.js";
import { forbidden } from "../utils/httpError.js";

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

const LOCALHOST_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  // IPv6 loopback. Note `new URL("http://[::1]:5173").hostname`
  // returns the literal string `[::1]` **with brackets** (the
  // Node URL parser preserves them). So that's what we match.
  // The un-bracketed `::1` is kept alongside as belt-and-
  // suspenders in case a different parser implementation (older
  // Node, a shim) ever strips them.
  "[::1]",
  "::1",
]);

// Extra allowed origins from the ALLOWED_ORIGINS environment
// variable (comma-separated full origins, e.g.
// "https://mulmoclaude.exe.xyz:5173,https://other.example").
// Parsed once at module load time.
const EXTRA_ALLOWED_ORIGINS: ReadonlySet<string> = new Set(
  (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// Extra allowed hostnames from the ALLOWED_HOSTS environment
// variable (comma-separated hostnames, e.g.
// "mulmoclaude.exe.xyz"). Any origin whose hostname matches
// is accepted regardless of port — useful for exe.dev proxies
// where the same host serves multiple ports (3000-9999).
const EXTRA_ALLOWED_HOSTS: ReadonlySet<string> = new Set(
  (process.env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// Decide whether an Origin header value points at the same
// machine. Accepts scheme + hostname + optional port; rejects
// `null`, empty, malformed, subdomain-lookalikes, non-loopback
// IPs, and non-HTTP schemes. Exported for test.
export function isLocalhostOrigin(origin: string): boolean {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return LOCALHOST_HOSTNAMES.has(url.hostname);
}

// Check whether the origin is explicitly listed in
// ALLOWED_ORIGINS (full-origin match) or its hostname appears
// in ALLOWED_HOSTS (any-port match). Exported for test.
export function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  // Full-origin match
  if (EXTRA_ALLOWED_ORIGINS.size > 0) {
    const normalized = origin.endsWith("/") ? origin.slice(0, -1) : origin;
    if (EXTRA_ALLOWED_ORIGINS.has(normalized)) return true;
  }
  // Hostname-only match (any port)
  if (EXTRA_ALLOWED_HOSTS.size > 0) {
    try {
      const url = new URL(origin);
      if (EXTRA_ALLOWED_HOSTS.has(url.hostname)) return true;
    } catch {
      // malformed origin — fall through
    }
  }
  return false;
}

// Express middleware. Safe-method requests (GET / HEAD / OPTIONS)
// pass through unchecked — they have no side effects per RFC 9110,
// and OPTIONS is required for CORS preflights anyway (even though
// we no longer advertise CORS, browsers still issue the preflight
// before some requests). Non-safe requests need an Origin header
// that resolves to localhost OR no Origin header at all.
export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (typeof origin !== "string") {
    // Missing Origin: non-browser caller (curl, MCP, Node HTTP
    // libraries). Trusted because the server binds to 127.0.0.1.
    next();
    return;
  }
  if (isLocalhostOrigin(origin) || isAllowedOrigin(origin)) {
    next();
    return;
  }
  // Security-relevant event: an upstream caller just hit us from
  // off-localhost with a state-changing method. Log it at warn so
  // operators see it in both the console and the rotating file
  // log even if the attack is otherwise silent on the wire.
  log.warn("csrf", "rejected cross-origin request", {
    origin,
    method: req.method,
    path: req.path,
  });
  forbidden(res, "Forbidden: cross-origin request rejected");
}
