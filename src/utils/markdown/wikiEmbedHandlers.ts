// Built-in prefix handlers for the wiki-embed registry (#1221 PR-B).
//
// Two prefixes ship today — `amazon` and `isbn` — chosen because
// they tie directly to the `mc-library` preset skill (#1210),
// which already captures ASIN / ISBN as it summarises books and
// products. After this PR, the skill can write
// `[[amazon:B00ICN066A]]` instead of a raw URL and get a clickable
// link in the rendered wiki / chat.
//
// Future prefixes (youtube / x / map / github / …) plug into the
// same registry — see plans/done/feat-rich-embed-syntax-1221.md PR-C+.

import { escapeHtml } from "@mulmoclaude/core/wiki";
import { registerWikiEmbed } from "./wikiEmbeds";

// Map app locale → Amazon storefront TLD. Each TLD must be a real
// Amazon storefront; locales without a corresponding storefront
// fall back to `.com` (which itself redirects signed-in users to
// their account's home storefront, but for guests stays in US).
//
// `pt-BR` → `.com.br`, `zh` → `.cn`. `ko` has no Amazon Korea
// (yet), so .com is the closest. `en` is `.com` because most
// English-speaking users are also fine with US — UK / CA / AU
// users typically have Amazon redirect them via their own account.
const AMAZON_TLDS: Record<string, string> = {
  ja: "co.jp",
  en: "com",
  de: "de",
  fr: "fr",
  es: "es",
  "pt-br": "com.br",
  ko: "com",
  zh: "cn",
};

// Locale provider — defaults to "en" (→ amazon.com). The host wires
// a real provider in `setup.ts` that reads from the live `i18n`
// instance. Decoupled this way so the handler module stays
// node-test-friendly: importing `lib/vue-i18n.ts` from here would
// drag in `import.meta.env` which is Vite-only and crashes tsx.
let localeProvider: () => string = () => "en";

/** Host bootstrap hook — call once during app boot to wire the
 *  Amazon-storefront resolver to the live i18n locale. Tests don't
 *  call this; they get the "en" default which keeps existing
 *  amazon.com assertions stable. */
export function setEmbedLocaleProvider(provider: () => string): void {
  localeProvider = provider;
}

// `Object.hasOwn` needs the es2022 lib, which this project's frontend config
// does not enable; `hasOwnProperty.call` is the same own-property check the
// rest of the frontend uses (see src/plugins/metas.ts).
const tldFor = (key: string): string | undefined => (Object.prototype.hasOwnProperty.call(AMAZON_TLDS, key) ? AMAZON_TLDS[key] : undefined);

/** Amazon storefront TLD for an app locale. A locale of `constructor` /
 *  `toString` (or any unmapped tag) falls back to `.com` rather than reading
 *  an inherited Object.prototype member as the TLD and breaking the URL host.
 *  Pure + exported so the fallback is unit-testable. */
export function amazonTldForLocale(locale: string): string {
  const raw = locale.toLowerCase();
  // Try the full tag first (`pt-br`), then the language-only segment (`pt`).
  const fullMatch = tldFor(raw);
  if (fullMatch) return fullMatch;
  const [lang] = raw.split("-");
  return tldFor(lang) ?? "com";
}

function amazonTldForCurrentLocale(): string {
  return amazonTldForLocale(localeProvider());
}

/** Amazon ASIN format — letters + digits, 10 chars. The pattern
 *  guards against `[[amazon:javascript:alert(1)]]` style attacks
 *  by rejecting non-alphanumeric ids before composing the URL. */
const ASIN_PATTERN = /^[A-Z0-9]{10}$/i;

/** ISBN-10 / ISBN-13 — digits + optional `X` checksum on ISBN-10.
 *  Non-digit / dash chars (other than the trailing X) reject. */
const ISBN_PATTERN = /^\d{9}[\dX]$|^\d{13}$/i;

/** YouTube video id — fixed-length 11, alphanumeric + `_` / `-`.
 *  Same shape for regular videos, Shorts, and Live (YouTube
 *  auto-redirects `watch?v=<id>` to the right player). */
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** Strip ISBN dashes the user might paste verbatim
 *  (`978-0-06-231609-7` → `9780062316097`). */
function normaliseIsbn(raw: string): string {
  return raw.replace(/[-\s]/g, "");
}

/** Build an `<a>` opening tag with the safe / extern attribute
 *  set. Centralised so every handler renders the same shape. */
function externalLink(href: string, label: string, title?: string): string {
  const escapedHref = escapeHtml(href);
  const escapedLabel = escapeHtml(label);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a href="${escapedHref}" target="_blank" rel="noopener noreferrer" class="wiki-embed wiki-embed-external"${titleAttr}>${escapedLabel}</a>`;
}

/** Bracket-render a verbatim `[[prefix:id]]` for the rare invalid-
 *  id case so the user sees what they typed (and can fix it)
 *  rather than nothing. */
function verbatim(prefix: string, embedId: string): string {
  const escapedSource = escapeHtml(`[[${prefix}:${embedId}]]`);
  const escapedTitle = escapeHtml(`Invalid ${prefix} id`);
  return `<span class="wiki-embed wiki-embed-invalid" title="${escapedTitle}">${escapedSource}</span>`;
}

export function registerAmazonEmbed(): void {
  registerWikiEmbed({
    prefix: "amazon",
    render: (embedId: string): string => {
      if (!ASIN_PATTERN.test(embedId)) return verbatim("amazon", embedId);
      // Storefront TLD is locale-aware: a Japanese user's `[[amazon:...]]`
      // links to amazon.co.jp, German user lands on amazon.de, etc.
      // Falls back to .com (which itself redirects signed-in users
      // to their home storefront).
      //
      // Cover thumbnail via the `images-na.ssl-images-amazon.com`
      // CDN's `/images/P/<ASIN>.01.L.jpg` shape. Reliable for books
      // (the dominant `mc-library` use case); for non-book products
      // the CDN may serve a 1x1 placeholder gif rather than 404, so
      // the link itself still works even when no real cover exists.
      // Cover URL stays on the global `images-na` host regardless of
      // storefront — Amazon's product cover catalogue is unified.
      // `loading="lazy"` keeps a wiki page with many embeds from
      // racing through every cover image before the visible content
      // paints.
      const watchUrl = `https://www.amazon.${amazonTldForCurrentLocale()}/dp/${embedId}`;
      const coverUrl = `https://images-na.ssl-images-amazon.com/images/P/${embedId}.01.L.jpg`;
      const label = `Amazon product ${embedId}`;
      const escapedHref = escapeHtml(watchUrl);
      const escapedCover = escapeHtml(coverUrl);
      const escapedLabel = escapeHtml(label);
      return `<a href="${escapedHref}" target="_blank" rel="noopener noreferrer" class="wiki-embed wiki-embed-amazon" title="${escapedLabel}"><img src="${escapedCover}" alt="${escapedLabel}" loading="lazy" class="wiki-embed-thumbnail" /></a>`;
    },
  });
}

export function registerIsbnEmbed(): void {
  registerWikiEmbed({
    prefix: "isbn",
    render: (embedId: string): string => {
      const isbn = normaliseIsbn(embedId);
      if (!ISBN_PATTERN.test(isbn)) return verbatim("isbn", embedId);
      // OpenLibrary's `/isbn/<isbn>` URL resolves to the canonical
      // edition page and falls back to a search if the edition
      // isn't catalogued. No API key required.
      return externalLink(`https://openlibrary.org/isbn/${isbn}`, `📖 ISBN ${isbn}`, `OpenLibrary entry for ISBN ${isbn}`);
    },
  });
}

export function registerYoutubeEmbed(): void {
  registerWikiEmbed({
    prefix: "youtube",
    render: (embedId: string): string => {
      if (!YOUTUBE_ID_PATTERN.test(embedId)) return verbatim("youtube", embedId);
      // Inline iframe via `youtube-nocookie.com` — the privacy-
      // enhanced host avoids profile cookies until the user actually
      // clicks play. Wrapped in a 16:9 `<span>` so the surrounding
      // paragraph-level layout stays stable while the iframe loads.
      // The `ALLOWED_IFRAME_SRC` regex in `sanitize.ts` is what keeps
      // this iframe alive through DOMPurify; if you change the URL
      // shape here, mirror the change there.
      const embedUrl = `https://www.youtube-nocookie.com/embed/${embedId}`;
      const label = `YouTube video ${embedId}`;
      const escapedSrc = escapeHtml(embedUrl);
      const escapedLabel = escapeHtml(label);
      return `<span class="wiki-embed wiki-embed-youtube"><iframe src="${escapedSrc}" title="${escapedLabel}" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></span>`;
    },
  });
}

/** Convenience entry point — registers every built-in handler.
 *  Called once at app boot from `src/main.ts`. Idempotent. */
export function registerBuiltInWikiEmbeds(): void {
  registerAmazonEmbed();
  registerIsbnEmbed();
  registerYoutubeEmbed();
}
