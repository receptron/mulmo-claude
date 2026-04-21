// Composable: intercept clicks on <a> links inside rendered markdown
// bodies and route workspace-internal refs back into FilesView / the
// chat session loader. Extracted from FilesView.vue (#507 step 8).

import type { Ref } from "vue";
import { isExternalHref, resolveWorkspaceLink, extractSessionIdFromPath } from "../utils/path/relativeLink";

interface MarkdownLinkHandlers {
  /** Invoked when a link resolves to a workspace file path. */
  onNavigate: (path: string) => void;
  /** Invoked when a link resolves to a chat session jsonl. */
  onLoadSession: (sessionId: string) => void;
}

export function useMarkdownLinkHandler(selectedPath: Ref<string | null>, handlers: MarkdownLinkHandlers) {
  function handleMarkdownLinkClick(event: MouseEvent): void {
    if (event.button !== 0) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href) return;
    // External URLs and mailto/tel: let TextResponseView's existing
    // handler open them in a new tab.
    if (isExternalHref(href)) return;
    // Anchor-only (#section): let the browser handle in-page scroll.
    if (href.startsWith("#")) return;
    if (!selectedPath.value) return;
    const resolved = resolveWorkspaceLink(selectedPath.value, href);
    if (!resolved) return;
    event.preventDefault();
    event.stopPropagation();
    // Chat session link: hand off so the sidebar chat switches to that
    // session instead of opening the raw jsonl as a file.
    const sessionId = extractSessionIdFromPath(resolved);
    if (sessionId !== null) {
      handlers.onLoadSession(sessionId);
      return;
    }
    handlers.onNavigate(resolved);
  }

  return { handleMarkdownLinkClick };
}
