// Single markdown → sanitised-HTML path for `v-html` bindings. Wraps
// `marked` then `sanitizeMarkdownHtml` so call sites can't drift on
// which sanitiser (or which marked options) they apply before injecting
// HTML. Mermaid post-processing stays with the caller
// (useMermaidRenderer) — this is the pure string → string step only.

import { marked, type MarkedOptions } from "marked";
import { sanitizeMarkdownHtml } from "./sanitize";

/**
 * Render markdown to DOMPurify-sanitised HTML. Empty / nullish input
 * yields an empty string (so a `v-if="rendered"` viewer can show its
 * empty state). `marked` is typed `string | Promise<string>`; only the
 * synchronous (string) result is sanitised — a Promise (async marked)
 * yields "" rather than being stringified into the DOM.
 */
export function renderMarkdownToSafeHtml(source: string | null | undefined, options?: MarkedOptions): string {
  if (!source) return "";
  const html = marked(source, options);
  return typeof html === "string" ? sanitizeMarkdownHtml(html) : "";
}
