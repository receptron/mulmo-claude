# Plan: defuse SVG XSS on `/api/files/raw` with a CSP sandbox header

Follow-up to #146 (which fixed two PR #134 review findings but intentionally left this one out as a pre-existing concern).

## Problem

`/api/files/raw` serves any workspace file with its declared Content-Type. For `.svg` that's `image/svg+xml`, which means a SVG file with an inline `<script>` element executes in the localhost:3001 origin when loaded as a top-level document or inside an `<iframe>`.

The `FilesView.vue` component currently loads images via `<img :src="rawUrl(...)">`, and `<img>` does **not** execute scripts in loaded SVGs — so the main preview surface is safe. But two attack vectors remain:

1. **Direct navigation**: `http://localhost:3001/api/files/raw?path=evil.svg` in the URL bar runs scripts. Any link to a raw workspace URL is a footgun.
2. **Future `<iframe>` use**: PDFs already use `<iframe :src="rawUrl(...)">` (line 173 in `FilesView.vue`). An `.svg` rendered via iframe would execute its scripts in the localhost origin, with access to session storage / cookies / fetch. PDFs themselves can carry JavaScript too.

Threat model: a malicious `.svg` / `.html` / `.pdf` lands in the workspace (via an automated tool result, a wiki import, a downloaded file, etc.), and the user either clicks a direct link to it or previews it in the file explorer. The script gains localhost:3001 origin privileges — which means it can call every `/api/*` endpoint, read every workspace file, exfiltrate credentials from `.env`.

## Fix

Add two response headers on every `/api/files/raw` response:

- `Content-Security-Policy: sandbox` — the `sandbox` directive creates an opaque origin for the response. Scripts can't access the parent page, can't read same-origin data, can't submit forms, can't run at all by default. SVG rendering still works visually; PDF rendering still works because the PDF reader doesn't rely on same-origin access to the parent.
- `X-Content-Type-Options: nosniff` — stop browsers from second-guessing our declared Content-Type and running HTML sniffed out of a `.txt` download.

CSP `sandbox` alone (no allow-flags) is the strictest setting and the right default for untrusted content previews. If a future feature needs JS inside the preview (e.g. an interactive HTML preview), the opt-in is to add `allow-scripts` etc. on a per-route basis.

### Why not stronger / weaker options?

- **`Content-Disposition: attachment`** would force download instead of inline preview — breaks the file explorer's raison d'être.
- **Denylist `.svg` entirely** — same problem, breaks legitimate SVG preview.
- **Strip `<script>` from SVG server-side** — whack-a-mole (event handlers, `xlink:href="data:..."`, foreign objects). CSP sandbox defeats all of them at once.
- **Serve SVG as `text/plain`** — defeats rendering.
- **Rewrite to `image/png`** — requires a rasterizer dependency. Overkill.

`sandbox` is the industry-standard fix for exactly this scenario (static file servers hosting untrusted content).

## Tradeoffs

- **PDF iframe loses same-origin access to its parent Vue app.** We don't postMessage anything or otherwise rely on cross-frame communication, so nothing breaks. The PDF still renders, scrolls, zooms.
- **Future "edit file inline" feature** (if anyone writes one using `contenteditable` in an iframe) would need to remove sandbox for that specific route. Not a concern today.
- **SVG in `<img>`** is unaffected because browsers don't apply response CSP to image loads in `<img>` — the image renders as a bitmap and scripts are inert regardless. This fix is strict defense-in-depth for the iframe / direct-navigation cases.

## Code change

Single file: `server/routes/files.ts`, inside the `/files/raw` handler.

```ts
res.setHeader("Accept-Ranges", "bytes");
res.setHeader("Content-Type", mime);
// Defuse XSS in SVG / HTML / PDF-with-JS previews. The `sandbox`
// directive with no flags creates an opaque origin for the
// response, blocking scripts, forms, and same-origin access
// even if the file content tries to run them.
res.setHeader("Content-Security-Policy", "sandbox");
// Prevent the browser from re-sniffing Content-Type on files it
// thinks look like HTML.
res.setHeader("X-Content-Type-Options", "nosniff");
```

Factor the two security headers into a tiny helper + export it so a unit test can pin the exact strings.

## Tests

- `test/routes/test_filesRoute.ts` — add a describe block for the new `RAW_SECURITY_HEADERS` constant / helper, asserting it contains both headers with the expected values. This doesn't exercise Express (the route-level tests would need supertest, which isn't in the repo), but it pin-tests the shape so a future edit can't accidentally drop the headers.
- Manual: open an SVG / PDF / mp3 in the file explorer and confirm everything still works; check DevTools Network tab for the new response headers.

## Commit structure

Single commit on branch `fix/files-raw-csp-sandbox`, plan + code + test together.

## Out of scope

- CORS lockdown, listen-binding, `.env` blocklist → separate follow-up
- CSRF origin check → separate follow-up after CORS lockdown lands
