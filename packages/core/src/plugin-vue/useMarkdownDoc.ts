// Reactive frontmatter view shared by every Vue component that displays markdown from
// disk — the host's wiki / properties panel and the markdown plugin's View. A plugin
// can't import the host and vice versa, so the shared composable lives in core.

import { computed, type ComputedRef, type Ref } from "vue";
import { buildMarkdownDocView, type MarkdownDocView } from "./markdownDoc.ts";

// Pass null/undefined to get the empty state — so callers can wire a load-state ref
// without a null-guard wrapper.
export function useMarkdownDoc(content: Ref<string | null | undefined>): ComputedRef<MarkdownDocView> {
  return computed(() => buildMarkdownDocView(content.value ?? ""));
}
