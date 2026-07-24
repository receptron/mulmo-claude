// Marp custom-theme helpers (#1649). Shared by the frontend (MarpView)
// and the server (PDF route + workspace I/O).
//
// Also exposes `MARP_HTML_ALLOWLIST` — the inline-HTML tag/attribute
// whitelist passed to `new Marp({ html: ... })` in both surfaces, so
// preview and PDF agree on which raw-HTML tags survive Marp's
// markdown-it pass. Default Marp config (`html: false`) escapes
// every `<div>` / `<span>` / `<img>` etc.; we open the door to a
// small, attribute-scoped subset that covers slide-layout needs
// without admitting `<script>` / `<iframe>` / form elements.
//
// Marp identifies themes by a `/* @theme <name> */` comment at the
// top of the CSS source. The workspace convention is **filename =
// theme name**: `config/marp-themes/corporate.css` registers a theme
// named `corporate` and is referenced from a deck's frontmatter
// `theme: corporate`. `ensureThemeDirective` injects the directive
// if the file omits it, so users don't have to remember the
// boilerplate.
//
// `sanitizeMarpThemeCss` rejects any CSS that pulls external
// resources at render time. The Marp themeSet itself happily accepts
// `@import url(http://...)` and `url(http://attacker/track.png)`,
// but our preview iframe's CSP already denies non-same-origin
// network traffic — so a theme that needed those would render
// broken anyway, and accepting it would create an SSRF / tracking
// vector in the server-side PDF path which runs in a headless
// browser without the iframe's CSP. Block at load time; surface a
// diagnostic on the bell so authors notice.

const LAYOUT_ATTRS = ["id", "class", "style"];

/** Inline-HTML allowlist for `new Marp({ html: ... })`. Each entry
 *  permits a tag with the listed attributes; everything else stays
 *  escaped. Kept conservative on purpose — adding event-handler
 *  attrs (`onclick`, `onerror`, …) or interactive tags (`script`,
 *  `iframe`, `form`, `input`, …) would defeat the point of having
 *  an allowlist at all.
 *
 *  Plain (non-readonly) arrays because Marp's HTMLAllowList type
 *  is mutable `string[]` — we can't hand it `readonly string[]`. */
export const MARP_HTML_ALLOWLIST: Record<string, string[]> = {
  div: [...LAYOUT_ATTRS],
  span: [...LAYOUT_ATTRS],
  img: ["src", "alt", "width", "height", ...LAYOUT_ATTRS],
  br: [],
  sub: [...LAYOUT_ATTRS],
  sup: [...LAYOUT_ATTRS],
  small: [...LAYOUT_ATTRS],
};

const THEME_DIRECTIVE_RE = /\/\*\s*@theme\s+([A-Za-z0-9_-]+)\s*\*\//;

/** Strip the `.css` extension and validate the slug.
 *  Returns null for names that wouldn't survive Marp's own
 *  `[A-Za-z0-9_-]` validator. */
export function marpThemeNameFromFilename(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".css")) return null;
  const base = filename.slice(0, -4);
  if (!/^[A-Za-z0-9_-]+$/.test(base)) return null;
  return base;
}

/** Re-stamp the `@theme <name>` Marp directive on the CSS so the
 *  registered name matches the filename (the convention the rest of
 *  the system relies on). If the CSS already declares a different
 *  name, the filename wins — we don't want a `themes/foo.css` that
 *  registers as "bar", because the frontmatter lookup would silently
 *  miss. */
export function ensureThemeDirective(css: string, themeName: string): string {
  const stripped = css.replace(THEME_DIRECTIVE_RE, "").trimStart();
  return `/* @theme ${themeName} */\n${stripped}`;
}

export interface SanitizeResult {
  ok: boolean;
  reason?: string;
}

// External URL fingerprint: `url(...)` or bare-string `@import "..."`
// pointing at `http(s)://` OR a protocol-relative `//host/...`.
//
// The protocol-relative form (`//attacker.example/x.css`) was a real
// bypass in the first cut — the preview iframe's CSP still blocked
// it, but the PDF route runs in puppeteer without that CSP, so
// `@import url(//attacker/...)` would happily fetch (CodeRabbit +
// Codex review on #1653).
// Strip every run of whitespace before matching so adversarial
// padding (`url  (   "  http...`) can't pad the gap to evade
// detection. Marp doesn't care about whitespace inside `url()` /
// `@import` either, so a theme that hides intent under 1 000 spaces
// renders the same as one without — we'd lose nothing by ignoring
// the spaces. The patterns below run against the stripped string,
// so they contain no `\s` quantifiers and can't backtrack on any
// input (linear time, ReDoS-safe). Codex flagged the previous
// bounded-`\s{0,8}` form as bypassable with 9+ spaces on PR #1653.
const STRIPPED_URL_EXTERNAL_RE = /url\(["']?(?:https?:|\/\/)/i;
const STRIPPED_IMPORT_EXTERNAL_RE = /@import["'](?:https?:|\/\/)/i;
const WHITESPACE_RE = /\s+/g;

/** Reject CSS that would pull external resources at render time.
 *  Allows `data:` URIs (inline fonts) and same-origin / relative refs. */
export function sanitizeMarpThemeCss(css: string): SanitizeResult {
  const compact = css.replace(WHITESPACE_RE, "");
  if (STRIPPED_URL_EXTERNAL_RE.test(compact) || STRIPPED_IMPORT_EXTERNAL_RE.test(compact)) {
    return { ok: false, reason: "external url() / @import is not allowed" };
  }
  return { ok: true };
}
