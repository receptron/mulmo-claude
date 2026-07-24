// One-time marked configuration for the SPA. Call `setupMarked()`
// from `src/main.ts` before the Vue app mounts so every component
// that imports `{ marked }` afterwards inherits the configured
// global instance.
//
// Today this installs the wiki-embed extension, the built-in
// `amazon` / `isbn` handlers (#1221 PR-B), and highlight.js syntax
// highlighting for fenced code blocks (#1868). Future global marked
// extensions belong here too — keep all the side-effects in one
// greppable spot.

import { unref } from "vue";
import { marked } from "marked";
// highlight.js theme: token classes are language-agnostic, so this one
// stylesheet colours every language `markedHighlightExtension` emits.
import "highlight.js/styles/github.css";
import i18n from "../../lib/vue-i18n";
import { wikiEmbedExtension } from "./wikiEmbeds";
import { registerBuiltInWikiEmbeds, setEmbedLocaleProvider } from "./wikiEmbedHandlers";
import { workspaceLinkifyExtension } from "./workspaceLinkify";
import { markedHighlightExtension } from "./highlight";
import { mermaidExtension } from "@mulmoclaude/markdown-utils/markdown/mermaidExtension";

let installed = false;

export function setupMarked(): void {
  // Idempotent: tests reach for `setupMarked()` before each
  // assertion suite without paying for re-installation.
  if (installed) return;
  // Wire the live i18n locale into the Amazon-storefront resolver
  // BEFORE registering handlers; the handlers themselves only call
  // the provider at render time, but doing it here keeps boot order
  // discoverable.
  setEmbedLocaleProvider(() => String(unref(i18n.global.locale)));
  registerBuiltInWikiEmbeds();
  marked.use(wikiEmbedExtension);
  // Fallback for the LLM-output residue where a generated file gets
  // emitted as an inline-code span instead of a Markdown link. See
  // `workspaceLinkify.ts` for the detection contract (#1300).
  marked.use(workspaceLinkifyExtension);
  marked.use(markedHighlightExtension);
  // Mermaid is a `code` renderer override, so it must land AFTER
  // highlight — later `.use()` calls wrap earlier ones, and returning
  // `false` from our override falls through to the highlight renderer
  // underneath. That gives us: `mermaid` fence → placeholder; any
  // other fence → highlight.js styling.
  marked.use(mermaidExtension);
  installed = true;
}
