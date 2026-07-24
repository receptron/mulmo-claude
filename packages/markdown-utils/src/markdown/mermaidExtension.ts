// Marked `code` renderer override that intercepts fenced code blocks
// whose language tag is `mermaid` and rewrites them into a
// `<pre class="mermaid" data-mermaid-pending="1">` placeholder. The
// diagram render itself is deferred to `mermaidRender.ts`, which
// scans the placeholders in the DOM after Vue's v-html injects the
// html. Two-step split keeps this file pure (no runtime deps beyond
// `marked`) so tests can assert the html shape without booting a
// browser.
//
// Why a renderer override and not a block tokenizer:
//   - marked already handles every fence variation CommonMark / GFM
//     permits (backticks vs tildes, LF vs CRLF, top-level vs indented
//     inside a list item, up to 3 spaces of leading whitespace on the
//     fence). Re-implementing that surface in a bespoke regex means
//     silently falling back to plaintext on the edge cases the regex
//     misses. Overriding the `code` renderer catches everything marked
//     already tokenised as a code block, so no CommonMark variant is
//     left behind.
//
// Registration order (see setup.ts): register AFTER
// `markedHighlightExtension` so this renderer wraps highlight's — a
// non-mermaid fence returns `false` from here and falls through to
// highlight's code renderer unchanged, while a `mermaid` fence
// short-circuits into the placeholder and never reaches highlight.

import type { MarkedExtension, Tokens } from "marked";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export const mermaidExtension: MarkedExtension = {
  renderer: {
    code(token: Tokens.Code): string | false {
      // marked v18 hands the whole token in — read `lang` from there.
      // `lang` may carry trailing whitespace (`\`\`\`mermaid  `), so
      // trim before comparing. Empty `lang` (indented 4-space blocks
      // or plain triple-backtick with no tag) can never match here.
      const lang = (token.lang ?? "").trim();
      if (lang !== "mermaid") return false;
      // markedHighlight's `walkTokens` fires on EVERY code token —
      // regardless of language — and rewrites `token.text` to an
      // HTML-escaped, highlight.js-processed string (mermaid falls
      // to `plaintext`, so no <span> tags land, but every `"` is
      // now `&quot;`). It also stamps `token.escaped = true`. If we
      // re-escape here, `&` in `&quot;` becomes `&amp;`, the browser
      // decodes `&amp;quot;` back to `&quot;` on parse, and mermaid
      // sees literal `&quot;` in its input — parse error. Honour
      // the `escaped` flag: pass through when already escaped, escape
      // ourselves when not (host code paths that don't wire highlight,
      // and the plugin, still need our own escape).
      const html = token.escaped === true ? token.text : escapeHtml(token.text);
      return `<pre class="mermaid" data-mermaid-pending="1">${html}</pre>\n`;
    },
  },
};
