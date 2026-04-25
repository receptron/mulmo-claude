# plan: history filter via URL path param

Tracking: #677

## Goal

Make the `/history` filter pill (All / Unread / Human / Scheduler / Skill / Bridge) URL-driven via a path param so browser back / forward restore prior filter states and deep links like `/history/unread` work.

## Non-goals

- No new filters, no server-side filtering.
- Unread count, mark-as-read, session list fetching — untouched.
- No localStorage persistence (URL is the source of truth).

## Design

### Router

Replace the current `{ path: "/history" }` with:

```ts
{ path: `/history/:filter(${HISTORY_FILTER_ROUTE_PATTERN})?`, name: PAGE_ROUTES.history, component: Stub }
```

`HISTORY_FILTER_ROUTE_PATTERN` is a pipe-joined list of non-default filter keys (every key except `all`), built once from `HISTORY_FILTERS`. Omitting the segment or hitting an unmatched value (vue-router refuses to match) just lands on the bare `/history` → `all` default. The value still gets re-validated in-component against the constants list, so a typo in a hand-rolled link stays safe.

### Constants — `src/config/historyFilters.ts` (new)

```ts
import { SESSION_ORIGINS, type SessionOrigin } from "../types/session";

export const HISTORY_FILTERS = {
  all: "all",
  unread: "unread",
  human: SESSION_ORIGINS.human,
  scheduler: SESSION_ORIGINS.scheduler,
  skill: SESSION_ORIGINS.skill,
  bridge: SESSION_ORIGINS.bridge,
} as const;

export type HistoryFilter = (typeof HISTORY_FILTERS)[keyof typeof HISTORY_FILTERS];

// Ordered list used by the pill row renderer. `all` first.
export const HISTORY_FILTER_ORDER: readonly HistoryFilter[] = [
  HISTORY_FILTERS.all,
  HISTORY_FILTERS.unread,
  HISTORY_FILTERS.human,
  HISTORY_FILTERS.scheduler,
  HISTORY_FILTERS.skill,
  HISTORY_FILTERS.bridge,
] as const;

// Pipe-joined pattern for the vue-router path param (excludes `all`,
// which is represented by the bare `/history` URL).
export const HISTORY_FILTER_ROUTE_PATTERN = HISTORY_FILTER_ORDER
  .filter((value) => value !== HISTORY_FILTERS.all)
  .join("|");

export function isHistoryFilter(value: unknown): value is HistoryFilter {
  return typeof value === "string" && HISTORY_FILTER_ORDER.includes(value as HistoryFilter);
}
```

### SessionHistoryPanel.vue

Replace the local `const activeFilter = ref<FilterKey>("all")` with a `computed<HistoryFilter>({ get, set })` bound to `route.params.filter`:

```ts
const activeFilter = computed<HistoryFilter>({
  get: () => {
    const raw = route.params.filter;
    return typeof raw === "string" && isHistoryFilter(raw) ? raw : HISTORY_FILTERS.all;
  },
  set: (value) => {
    const params = value === HISTORY_FILTERS.all ? {} : { filter: value };
    router.push({ name: PAGE_ROUTES.history, params });
  },
});
```

`filteredSessions`, the pill renderer, and the per-filter count logic all keep reading `activeFilter.value` and stay unchanged. The local `FILTERS` array is replaced by `HISTORY_FILTER_ORDER` imported from the new config. The local `UNREAD_FILTER` constant is replaced by `HISTORY_FILTERS.unread`.

### `router.push` vs `router.replace`

User explicitly chose `push` — filter changes should populate browser history so back/forward restore prior filter states. Downside: clicking through all 6 filters stacks 6 history entries, which makes the back button traverse each before leaving `/history`. Acceptable cost for the feature.

### i18n

Filter labels already exist under `sessionHistoryPanel.filters.*` in all 8 locales (keyed by filter value). No translation work needed.

## Testing

### Unit

`test/config/test_historyFilters.ts` — new. Covers:

- `isHistoryFilter` happy / negative / edge cases (empty string, wrong type, unknown value).
- `HISTORY_FILTER_ORDER` includes every value in `HISTORY_FILTERS` exactly once.
- `HISTORY_FILTER_ROUTE_PATTERN` does not contain `all` and contains every non-default filter.
- `HISTORY_FILTERS` values match `SESSION_ORIGINS` for the four origin keys.

### E2E

Extend `e2e/tests/router-navigation.spec.ts` (or add a sibling `history-filter.spec.ts`):

- Land on `/history` → `All` pill is active, URL has no trailing segment.
- Click `Unread` → URL becomes `/history/unread`, Unread pill becomes active.
- Click `Human` → URL becomes `/history/human`.
- Browser back → URL and active pill return to `/history/unread`.
- Browser back again → URL and active pill return to `/history` with `All` active.
- Deep link: `page.goto("/history/scheduler")` → Scheduler pill is active immediately.
- Bogus deep link: `page.goto("/history/bogus")` → vue-router doesn't match, and the app's catch-all redirects to `/chat` (confirm this is desirable). If we want `/history/bogus` → `/history` (all) instead, add a fallback in the history-panel mount.

## Files to touch

- `src/config/historyFilters.ts` — new
- `src/router/index.ts` — widen `/history` route
- `src/components/SessionHistoryPanel.vue` — ref → computed, import from config, drop local constants
- `test/config/test_historyFilters.ts` — new
- `e2e/tests/router-navigation.spec.ts` (or new spec) — new cases

## Done when

- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` clean
- `yarn test` green on the new unit cases
- Manual smoke: click each filter pill, back button restores prior state, deep links work
- PR merged

## Open questions (to decide during review)

- **Catch-all behaviour for `/history/bogus`**: current router has `{ path: "/:pathMatch(.*)*", redirect: "/chat" }` as the catch-all. Plan above relies on the regex pattern in the param definition to restrict matches to known filter values, so `/history/bogus` falls through to the catch-all → `/chat`. Plan treats this as acceptable. If we want a softer fallback (redirect unknown filters to `/history`), add `{ path: "/history/:pathMatch(.*)", redirect: "/history" }` just before the catch-all. Will raise this in the PR for the reviewer.
