# Plan: reject cross-origin state-changing requests with an Origin guard

Third of three pre-existing security follow-ups to the merged #134. This one builds on the same-origin posture established by #148 (CORS + localhost bind + sensitive-file denylist).

## Why this is needed on top of #148

#148 drops `cors()` entirely, so a cross-origin `fetch` from `http://evil.example` can't *read the response* — the browser refuses to expose it to the calling script. That defends against the data-exfil attack (reading `.env`, reading chat history, reading workspace files).

But CORS doesn't block the **request itself** from being sent. A few classes of request still slip through:

1. **Simple-CORS POST requests** — `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain` don't trigger preflight. A `<form action="http://localhost:3001/api/chat-index/rebuild" method="post">` on an attacker page submits the request on user click (or auto-submit via JS). The response is invisible but the *side effect* happens.

2. **Simple-CORS GET requests with side effects** — `<img src="http://localhost:3001/api/whatever">` fires a GET. Our GETs are all read-only today, but a future endpoint that accidentally has side effects would be exploitable.

3. **Fetches from sandboxed iframes / `file://` pages** — origin is `null`, same-origin policy still blocks response reading, but the request goes through.

Concrete CSRF target today: `POST /api/chat-index/rebuild` (spawns `claude` CLI for every session, real resource cost). Trigger it from an attacker form submission → user's machine spends minutes summarizing, paying claude budget, with no visible indicator.

#148 and this PR together are defense in depth:

- **#148 (CORS + bind)**: blocks response reading → no data exfil
- **This PR (Origin check)**: blocks side-effectful cross-origin hits → no CSRF

## Design — Origin-header middleware

A single Express middleware applied globally before any route:

```ts
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireSameOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  // Missing Origin: allowed. Server-to-server callers (MCP
  // tools, curl, CLI scripts) don't set Origin. This is only
  // safe because #148 binds the server to 127.0.0.1 — remote
  // traffic can't reach us at all, so a missing Origin
  // necessarily comes from a local process.
  if (!origin) return next();
  if (isLocalhostOrigin(origin)) return next();
  res.status(403).json({ error: "Forbidden: cross-origin request rejected" });
}
```

`isLocalhostOrigin(origin)` returns `true` when:

- `origin` parses as a URL (else `false`)
- Hostname is exactly one of `localhost`, `127.0.0.1`, `::1`

Any other value — including `null`, `http://localhost.evil.com` (subdomain attack), `http://example.com`, malformed strings — is rejected.

### Why "missing Origin = allowed"

The Origin header is set by browsers on every request except same-origin GET/HEAD/OPTIONS in some older engines. Non-browser clients (curl, MCP tools, Node HTTP libraries by default) don't set it. We have two choices:

1. **Require Origin on every non-safe request.** Breaks every server-to-server caller and every curl-based script.
2. **Allow missing Origin, reject foreign Origin.** Works for every caller that matters and is only safe because we're bound to localhost.

#148's localhost bind makes option 2 safe: remote traffic can't reach the server, so a missing Origin necessarily means the request came from a process on the same machine. That process is the user's own (malware at that level is game-over anyway).

If #148 lands first (as expected), this reasoning holds. If somehow this PR lands first, there's a theoretical window where a LAN attacker could issue a CSRF POST with no Origin header. Documenting the dependency in the PR description.

### Safe methods

`GET`, `HEAD`, `OPTIONS` pass through unchecked. RFC 9110 calls these "safe" methods (no side effects). `OPTIONS` also covers CORS preflights, which browsers issue with `Origin` but we don't want to reject.

If a future GET endpoint is introduced that has side effects, either:
- Convert it to POST (correct), or
- Document the gap and add a targeted origin check on that specific route.

The middleware itself intentionally doesn't try to detect "GET with side effects" — that's semantic and would need per-route annotations.

### Where to hook it in

Right after `express.json()` in `server/index.ts`, before any `app.use("/api", ...)` call. Applies globally to every route.

### Structure

- New file `server/api/csrfGuard.ts` — exports `requireSameOrigin` and its helper `isLocalhostOrigin` for test.
- `server/index.ts` imports and wires it in.
- New test file `test/server/test_csrfGuard.ts` exercises the middleware with fake Req/Res objects.

## Tests

Table-driven on `isLocalhostOrigin` + behavioural tests on `requireSameOrigin`:

**`isLocalhostOrigin`:**
- `http://localhost` → true
- `http://localhost:5173` → true
- `http://localhost:3001` → true
- `https://localhost` → true (scheme-agnostic)
- `http://127.0.0.1` → true
- `http://127.0.0.1:8080` → true
- `http://[::1]:5173` → true (IPv6 loopback)
- `http://example.com` → false
- `http://localhost.evil.com` → false (subdomain attack)
- `http://evillocalhost` → false (no dot, not localhost)
- `http://attacker.com/path?x=localhost` → false
- `null` → false
- `""` → false
- `not a url` → false
- `javascript:alert(1)` → false (hostname is empty)
- `file:///tmp/evil.html` → false

**`requireSameOrigin`:**
- GET with no Origin → `next()` called
- GET with foreign Origin → `next()` called (GET is safe)
- HEAD with foreign Origin → `next()` called
- OPTIONS with foreign Origin → `next()` called (preflight)
- POST with no Origin → `next()` called (local process)
- POST with `http://localhost:5173` → `next()`
- POST with `http://127.0.0.1:3001` → `next()`
- POST with `http://example.com` → 403 + JSON error, `next()` NOT called
- POST with malformed Origin → 403, `next()` NOT called
- POST with `null` string Origin → 403, `next()` NOT called
- PUT / PATCH / DELETE with foreign Origin → 403

### Test harness

The middleware signature takes `Request`, `Response`, `NextFunction`. We don't need full Express — fake objects with just `headers`, `method`, `status`, `json`, `_statusCode` tracking, and a `next` spy are enough. Standard pattern for Express middleware unit tests, no supertest required.

## Tradeoffs

- **Non-browser API clients without Origin headers work freely.** This is intentional (see "missing Origin = allowed"). If that's too permissive for a future deployment (e.g. exposing the server beyond localhost), the fix is to require Origin there, not to complicate this middleware.
- **`null` string Origin is rejected.** Sandboxed iframes, `file://` pages, and some Chrome extensions send `Origin: null`. They can't POST to the server. That's the right call: there's no trusted context that sends `null`.
- **IPv6 loopback matching** is included (`[::1]`) in case the user's browser resolves `localhost` to IPv6.
- **No CSRF token fallback** — Origin-based CSRF defense is simpler and works for our use case. Token-based defense (double-submit cookie, synchronizer token) adds complexity and requires session state we don't have.

## Out of scope

- Request rate limiting / per-client throttling.
- Auth / user sessions.
- Removing the `cors` npm package from `package.json`.
- Scanning all routes to reclassify GETs that shouldn't be — out of scope for a security guard, belongs in a code-review pass.

## Commit structure

Single commit on branch `fix/server-csrf-origin-check`. Plan + middleware + tests + wiring together.
