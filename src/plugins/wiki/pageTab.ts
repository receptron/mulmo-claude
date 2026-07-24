// Per-page Content / History switcher state (#763 PR 3 / #944).
// Shared by View.vue (owns the reactive `pageTab` ref) and
// WikiPageTabs.vue (renders the switcher), so the two agree on the
// tab identifiers without either side hardcoding the strings.
export const PAGE_TAB = {
  content: "content",
  history: "history",
} as const;

export type PageTab = (typeof PAGE_TAB)[keyof typeof PAGE_TAB];
