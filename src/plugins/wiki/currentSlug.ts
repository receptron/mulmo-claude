import { isSafeWikiSlug } from "@mulmoclaude/core/wiki";

export interface WikiSlugInput {
  /** True when the active route is the standalone `/wiki` route. */
  onWikiRoute: boolean;
  /** True when the route section is `pages` (a specific page URL). */
  onPagesSection: boolean;
  /** `route.params.slug` — only a string on a page URL. */
  routeSlug: unknown;
  /** `selectedResult.data.pageName` — the embedded (tool-result) fallback. */
  resultPageName: string | null;
}

// Resolve which page the view is showing. The standalone `/wiki/pages/<slug>`
// URL is the source of truth on that route; otherwise fall back to the
// tool-result payload. `isSafeWikiSlug` guards against traversal tokens the
// server/agent payload can't be assumed to have filtered.
export const resolveWikiSlug = ({ onWikiRoute, onPagesSection, routeSlug, resultPageName }: WikiSlugInput): string | null => {
  const raw = onWikiRoute && onPagesSection && typeof routeSlug === "string" ? routeSlug : resultPageName;
  return isSafeWikiSlug(raw) ? raw : null;
};
