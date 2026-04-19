# Plan: lock the Express server to localhost + restrict CORS + deny sensitive files

Second of three pre-existing security follow-ups to the merged #134 (see also #147 for the SVG CSP sandbox and the upcoming CSRF origin-check PR).

## Problem — drive-by credential theft

Three defects compound into a single concrete attack: a malicious web page the user visits while the dev server is running can read `~/mulmoclaude/.env`.

### Defect A — server binds to `0.0.0.0`

`server/index.ts` calls `app.listen(PORT, "0.0.0.0", ...)` and `net.createServer().listen(port, "0.0.0.0")` for the port probe. `0.0.0.0` means "every interface on this machine" — the dev server is exposed to the entire LAN. Anyone on the same Wi-Fi can reach `http://<laptop-ip>:3001/api/files/content?path=.env`. No browser required.

### Defect B — `cors()` is wide open

`app.use(cors())` with no arguments enables the permissive default: `Access-Control-Allow-Origin: *`, all methods, all headers. A page at `http://evil.example` can `fetch("http://localhost:3001/api/files/content?path=.env")` and read the response. Vite's dev proxy means no legitimate caller needs cross-origin headers — all real traffic is same-origin (or server-to-server, which doesn't use CORS at all).

### Defect C — `.env` is in the TEXT_EXTENSIONS whitelist

`server/api/routes/files.ts:31` includes `.env` in `TEXT_EXTENSIONS`, so `/files/content?path=.env` returns its contents as JSON text. Other sensitive files (`*.pem`, `*.key`, SSH private keys) aren't in the whitelist but are still reachable via `/files/raw` as "binary" — the binary is octet-stream, which a fetch client can still read byte-for-byte.

## Fix — defense in depth, one PR

### 1. Bind to `127.0.0.1` only

Two sites in `server/index.ts`:

```ts
// isPortFree — the probe listener that checks if the port is taken
server.listen(port, "127.0.0.1");

// main app.listen
const httpServer = app.listen(PORT, "127.0.0.1", () => { ... });
```

Consequence: the server is no longer reachable from other machines on the LAN. Dev workflow is unaffected — Vite's proxy runs on the same machine. If anyone actually needs LAN access (unlikely for a personal dev tool), they can set `PORT=` and bind explicitly via an opt-in env var — out of scope for this fix.

### 2. Drop `cors()` entirely

The Vite dev proxy in `vite.config.ts` forwards `/api/*` from `localhost:5173` to `localhost:3001` server-side, so the browser only ever sees one origin (`:5173` in dev, `:3001` in prod via Express's static server). No legitimate request needs CORS headers. Removing `app.use(cors())` means:

- Browser requests to `:3001` from a foreign origin (`evil.example`) → response has no `Access-Control-Allow-Origin` → browser blocks the response from the calling script.
- Same-origin requests (via Vite proxy or direct from Express-served client) work unchanged because same-origin requests don't need CORS headers.
- Server-to-server calls (MCP tools, curl, CLI) are unaffected — CORS is a browser mechanism, not HTTP-level enforcement.

Also drop the `import cors from "cors"` line. The `cors` npm package stays in the dep tree for now (could be removed separately), but nothing imports it.

### 3. Add a sensitive-path denylist to `server/api/routes/files.ts`

New helper `isSensitivePath(relPath)` that returns `true` for:

- `.env` and `.env.*` (e.g. `.env.local`, `.env.production`)
- `*.pem`, `*.key`, `*.crt` — TLS / SSH keys
- `id_rsa`, `id_ed25519`, `id_ecdsa`, `id_dsa` — and their `.pub` variants are fine (public keys)
- `credentials.json` — the Claude Code credentials file that `server/system/credentials.ts` writes
- `.npmrc` — often holds npm tokens
- `.htpasswd` — Apache auth file

Applied in three places:

1. **`resolveSafe`** returns `null` for sensitive paths → all three endpoints (`/files/content`, `/files/raw`, any future consumer) get a 400 "Path outside workspace" response. The error is intentionally vague so we don't confirm existence.
2. **`buildTree`** skips sensitive entries so they don't appear in `/files/tree` at all. The file explorer won't show them.
3. **Remove `.env` from `TEXT_EXTENSIONS`** — defense in depth in case `isSensitivePath` misses a variant; the resulting fallback is "binary" with a preview-not-supported message.

### Test coverage

`test/routes/test_filesRoute.ts` gains a describe block for `isSensitivePath`:

- `.env` → blocked
- `.env.local`, `.env.production`, `.env.staging` → blocked
- `.environment` (not actually sensitive) → NOT blocked (shouldn't false-positive on lookalikes)
- `subdir/.env` → blocked (matches on the basename, not the full path)
- `notes.txt` → not blocked
- `id_rsa`, `id_rsa.pub` — private blocked, public NOT blocked
- `cert.pem`, `server.key` → blocked
- `README.md` → not blocked
- case-insensitive on Windows-friendly filesystems (`.ENV`, `ID_RSA`) — blocked

`isSensitivePath` is exported so the test can exercise it directly.

## Tradeoffs

- **LAN access**: if someone was relying on `0.0.0.0` to access the dev server from their phone / another laptop, this PR breaks that. It's an unusual dev workflow and out of scope here — can be re-added behind an explicit opt-in env var if anyone asks.
- **CORS removal**: any tooling that directly hits the API from a cross-origin web page (not via Vite proxy) will break. Grepping the repo: nothing currently does this. The closed PR #106 (Telegram bot) was server-side and wouldn't have been affected.
- **Sensitive path false positives**: if a user legitimately wants to preview a `.env` file in the file explorer, they can't. They can still `cat` it from a terminal. The safety margin wins.

## Out of scope

- **CSRF origin check** on state-changing routes — separate PR building on this one's same-origin posture
- **Removing `cors` from package.json** — leave it installed in case it's needed later for a deliberate cross-origin integration
- **Additional sensitive patterns** like `aws/credentials`, `.ssh/` (whole dir), `.gnupg/` — can add incrementally if real need arises

## Commit structure

Single commit on branch `fix/server-lockdown-cors-localhost`. Plan + code + tests together, because the three defects form one layered defense and splitting them would leave the tree in an intermediate state.
