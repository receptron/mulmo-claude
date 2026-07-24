// Wiki-syntax embed registry + marked extension (#1221 PR-B).
//
// Recognises `[[<prefix>:<id>]]` inside markdown bodies and
// substitutes a prefix-specific `<a>` (or richer HTML in the
// future). The user-facing motivation is `mc-library` and similar
// preset skills writing `[[amazon:B00ICN066A]]` instead of raw
// Amazon URLs — the file stays small and renders as a clickable
// link.
//
// Design — marked extension over a regex post-processor:
//   - `[[...]]` inside fenced / inline code blocks is left alone
//     because the marked tokenizer never reaches `code` content;
//     a regex on the rendered HTML would have to skip
//     `<pre><code>` blocks itself.
//   - Future prefixes (youtube / x / map / github / …) plug in via
//     a tiny `WikiEmbedHandler` registration — no marked-API
//     repetition.
//
// `marked.use(wikiEmbedExtension)` is called once at app boot
// (`src/main.ts`); every consumer of `marked()` / `marked.parse()`
// inherits the substitution automatically.

import type { MarkedExtension, Tokens } from "marked";
import { escapeHtml } from "@mulmoclaude/core/wiki";

/** A handler renders one prefix's substitution HTML. Pure: no I/O,
 *  no fetches. The result is dropped straight into the rendered
 *  document, so it MUST be HTML-safe (escape user-controlled
 *  segments). The shared `escapeHtml` from `@mulmoclaude/core/wiki`
 *  covers the common case. */
export interface WikiEmbedHandler {
  /** Lower-case prefix without the trailing colon (`"amazon"`,
   *  `"isbn"`, …). The tokenizer matches case-insensitively but
   *  registrations are normalised to lowercase. */
  prefix: string;
  /** Render the substituted HTML for `[[prefix:id]]`. The id is
   *  trimmed but not URL-encoded — the handler decides how to
   *  escape it for its target. */
  render: (embedId: string) => string;
}

const handlers = new Map<string, WikiEmbedHandler>();

/** Register a prefix handler. Idempotent: re-registering the same
 *  prefix overwrites the previous handler — useful for tests, no
 *  warning needed. */
export function registerWikiEmbed(handler: WikiEmbedHandler): void {
  handlers.set(handler.prefix.toLowerCase(), handler);
}

/** Test seam — drops every registered handler. Production code
 *  registers once at module load and never resets. */
export function _resetWikiEmbeds(): void {
  handlers.clear();
}

/** Read-only snapshot for tests / dev panels. Production code
 *  doesn't need to enumerate handlers. */
export function listWikiEmbedPrefixes(): string[] {
  return [...handlers.keys()].sort();
}

/** Pattern that matches one wiki-embed token. The id portion is
 *  intentionally permissive (anything that isn't `]`) so handlers
 *  can carry slashes (`github:owner/repo/issues/N`) or commas
 *  (`map:35.6,139.7`). The leading char must NOT be `]` or
 *  whitespace so `[[]]` and `[[ : x]]` don't accidentally match.
 *
 *  Anchored to `^` because marked's tokenizer always sees `src`
 *  starting at the position the inline lexer is scanning. */
const TOKEN_PATTERN = /^\[\[([a-z][a-z0-9-]*):([^\]\s][^\]]*)\]\]/i;

interface WikiEmbedToken extends Tokens.Generic {
  type: "wikiEmbed";
  raw: string;
  /** Already lowercased. */
  prefix: string;
  /** Trimmed but otherwise-verbatim id from the source. */
  id: string;
}

/** marked extension that owns the `[[prefix:id]]` token. Renders
 *  via the handler registry; falls back to the verbatim raw text
 *  when no handler is registered (so an unknown prefix doesn't
 *  vanish — the user sees the literal markup and can register a
 *  handler or fix the typo). */
export const wikiEmbedExtension: MarkedExtension = {
  extensions: [
    {
      name: "wikiEmbed",
      level: "inline",
      start(src: string): number | undefined {
        const idx = src.indexOf("[[");
        return idx === -1 ? undefined : idx;
      },
      tokenizer(src: string): WikiEmbedToken | undefined {
        const match = TOKEN_PATTERN.exec(src);
        if (!match) return undefined;
        const prefix = match[1].toLowerCase();
        const embedId = match[2].trim();
        if (embedId.length === 0) return undefined;
        if (!handlers.has(prefix)) return undefined;
        return {
          type: "wikiEmbed",
          raw: match[0],
          prefix,
          id: embedId,
        };
      },
      renderer(token): string {
        const node = token as WikiEmbedToken;
        const handler = handlers.get(node.prefix);
        // Guarded by the tokenizer (only handlers we know about
        // produce a token), but defensive — a handler unregistered
        // mid-render shouldn't crash the parser.
        if (!handler) return escapeHtml(node.raw);
        return handler.render(node.id);
      },
    },
  ],
};
