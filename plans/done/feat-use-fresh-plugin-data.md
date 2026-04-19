# Feature: `useFreshPluginData` composable

## Goal

Consolidate the "fetch fresh data from disk when a plugin view mounts"
pattern — currently duplicated across 8 files after PR #115 — into a
single composable, and take the opportunity to fix several bugs and
gaps that the duplication has been masking.

## Why composable-first instead of bug-fix-first

After reading all 8 files (todo/{View,Preview}, scheduler/{View,Preview},
wiki/{View,Preview}, manageRoles/{View,Preview}), the pattern is
80% identical and the remaining differences fall cleanly onto three
callbacks:

1. **`endpoint()`** — returns the URL to fetch. Static for most plugins;
   wiki/View computes a slug-aware URL.
2. **`extract(json)`** — pulls the data out of the response envelope.
   Three shapes across the plugins:
   - `json.data.items` (todo / scheduler)
   - `json.data` as a whole `WikiData` object (wiki)
   - bare array (manageRoles — `/api/roles` returns `CustomRole[]`)
3. **`apply(data)`** — writes into local refs. Most call sites write one
   ref; wiki writes 3–4; **wiki/Preview has a latent "index overwrite"
   bug that becomes trivial to fix inside this callback**.

Hoisting common behaviour (AbortController, abort-on-unmount, fetch +
parse + guard) into one ~50-line composable lets us fix multiple
open issues in one pass:

- **CodeRabbit V1 #6** — wiki/Preview index overwrite (apply guard)
- **CodeRabbit V1 #2/#4/#7 補完** — manageRoles/View is missing the
  prop-sync watch entirely (not in the V1 review because the file
  wasn't in the diff at the time)
- **CodeRabbit V2 onUnmounted cleanup** — composable calls
  `onUnmounted(abort)` once, every call site inherits it
- **CodeRabbit V2 watch key** — move every call site to
  `watch(() => props.selectedResult.uuid, () => { items = ...; refresh() })`
- **A (code duplication)** — 8 boilerplate sites → 8 composable usages
- **C (AbortController coverage)** — wiki/Preview and manageRoles
  currently don't have AbortController; composable gives it to
  everyone for free

## Non-goals

- **Not** touching the view-level business logic fixes:
  - `scheduler/View.vue`'s `applyChanges` silent failure (CodeRabbit V2)
  - `yamlError` surfacing on failed saves (CodeRabbit V2 + my D)
  - `scheduler/View.vue`'s `remove` result checking (CodeRabbit V2)
  These live in their own follow-up PR ("PR B") — they're orthogonal
  to fetching and consolidating them with the composable would blow
  up the diff.
- **Not** touching `server/api/routes/wiki.ts` (DRY refactor, separate PR).
- **Not** migrating tests away from existing component tests.
- **Not** introducing a useSWR-style cache or anything more ambitious
  than "fetch on mount + on prop uuid change".
- **Not** rewriting the existing YAML parsing / item selection logic.

## Design

### File layout

```
src/composables/useFreshPluginData.ts        # NEW: composable (~60 lines)
test/composables/test_useFreshPluginData.ts  # NEW: unit tests for the pure core

src/plugins/todo/View.vue           # migrate
src/plugins/todo/Preview.vue        # migrate
src/plugins/scheduler/View.vue      # migrate
src/plugins/scheduler/Preview.vue   # migrate
src/plugins/wiki/View.vue           # migrate (slug-aware endpoint)
src/plugins/wiki/Preview.vue        # migrate + bug fix (index guard)
src/plugins/manageRoles/View.vue    # migrate + add missing watch
src/plugins/manageRoles/Preview.vue # migrate
```

### Composable shape

```ts
// src/composables/useFreshPluginData.ts
import { onMounted, onUnmounted } from "vue";

export interface UseFreshPluginDataOptions<T> {
  // Called each time the composable refreshes. Must return the URL
  // to fetch. A function (not a string) so callers can derive the
  // URL from local refs — wiki/View uses this to switch between
  // `/api/wiki` and `/api/wiki?slug=...` based on the current action.
  endpoint: () => string;

  // Given the parsed JSON response, return the data to pass to
  // `apply`. Return `null` to skip the apply step (e.g. the response
  // is malformed). Keeps the composable envelope-agnostic — each
  // plugin picks its own `json.data.items` / `json.data` / bare
  // shape.
  extract: (json: unknown) => T | null;

  // Write the extracted data into the caller's local refs.
  // Callers can include guards here (e.g. wiki/Preview only applies
  // an index payload when it's currently showing the index view).
  apply: (data: T) => void;
}

export interface UseFreshPluginDataHandle {
  // Abort the in-flight request (if any) and fire a new one. Returns
  // `true` on successful apply, `false` on abort / non-OK / malformed
  // / apply-skipped.
  refresh: () => Promise<boolean>;
  // Abort any in-flight request without firing a new one. Called
  // automatically on component unmount.
  abort: () => void;
}

export function useFreshPluginData<T>(
  opts: UseFreshPluginDataOptions<T>,
): UseFreshPluginDataHandle;
```

### Implementation outline

```ts
export function useFreshPluginData<T>(
  opts: UseFreshPluginDataOptions<T>,
): UseFreshPluginDataHandle {
  let controller: AbortController | null = null;

  async function refresh(): Promise<boolean> {
    controller?.abort();
    const c = new AbortController();
    controller = c;
    try {
      const res = await fetch(opts.endpoint(), { signal: c.signal });
      if (c.signal.aborted) return false;
      if (!res.ok) return false;
      const json: unknown = await res.json();
      if (c.signal.aborted) return false;
      const extracted = opts.extract(json);
      if (extracted === null) return false;
      opts.apply(extracted);
      return true;
    } catch (err) {
      // AbortError is the expected quiet path when the component
      // unmounts mid-fetch or a newer refresh superseded us.
      if (err instanceof DOMException && err.name === "AbortError") {
        return false;
      }
      return false;
    }
  }

  function abort(): void {
    controller?.abort();
    controller = null;
  }

  onMounted(() => {
    void refresh();
  });
  onUnmounted(abort);

  return { refresh, abort };
}
```

### Usage patterns (3 flavors)

**Flavor 1 — array items (todo, scheduler)**:

```ts
const items = ref<TodoItem[]>(props.selectedResult.data?.items ?? []);

const { refresh } = useFreshPluginData<TodoItem[]>({
  endpoint: () => "/api/todos",
  extract: (json) => {
    const v = (json as { data?: { items?: TodoItem[] } }).data?.items;
    return Array.isArray(v) ? v : null;
  },
  apply: (data) => {
    items.value = data;
  },
});

// Switch key to selectedResult.uuid (CodeRabbit V2): the old watch
// on `data?.items` didn't fire when both old and new items were
// undefined, which could happen when toggling between two empty
// results.
watch(
  () => props.selectedResult.uuid,
  () => {
    items.value = props.selectedResult.data?.items ?? [];
    void refresh();
  },
);
```

**Flavor 2 — multi-ref WikiData (wiki/View)**:

```ts
useFreshPluginData<WikiData>({
  endpoint: () => {
    const slug =
      action.value === "page" ? props.selectedResult.data?.pageName : undefined;
    return slug ? `/api/wiki?slug=${encodeURIComponent(slug)}` : "/api/wiki";
  },
  extract: (json) => (json as { data?: WikiData }).data ?? null,
  apply: (data) => {
    action.value = data.action ?? "index";
    title.value = data.title ?? "Wiki";
    content.value = data.content ?? "";
    pageEntries.value = data.pageEntries ?? [];
  },
});
```

**Flavor 2b — multi-ref WikiData with bug fix (wiki/Preview)**:

```ts
useFreshPluginData<WikiData>({
  endpoint: () => "/api/wiki",
  extract: (json) => (json as { data?: WikiData }).data ?? null,
  apply: (data) => {
    // Bug fix (CodeRabbit V1 #6): only apply the index payload when
    // this preview is actually showing the index view. The Preview
    // is reused for page / log / lint_report previews too; applying
    // the fetched /api/wiki (always index) clobbers those other
    // states with a wrong payload.
    if (action.value !== "index") return;
    title.value = data.title ?? "Wiki";
    pageEntries.value = data.pageEntries ?? [];
  },
});
```

**Flavor 3 — bare array (manageRoles)**:

```ts
useFreshPluginData<CustomRole[]>({
  endpoint: () => "/api/roles",
  extract: (json) => (Array.isArray(json) ? (json as CustomRole[]) : null),
  apply: (data) => {
    customRoles.value = data;
  },
});
```

## Commit structure

To make the PR reviewable:

1. **Commit 1**: `docs: plan for useFreshPluginData composable`
2. **Commit 2**: `feat(composables): add useFreshPluginData` —
   standalone new file + unit tests. Nothing else touched.
3. **Commit 3**: `refactor(plugins): migrate 8 views to useFreshPluginData` —
   all 8 files updated in one commit with the three flavors applied.
   Includes:
   - wiki/Preview index-overwrite guard (CodeRabbit V1 #6 fix)
   - manageRoles/View missing watch (hole filler)
   - watch key switch to `selectedResult.uuid` (CodeRabbit V2 fix)
   - AbortController coverage expansion (Preview files + manageRoles)

## Testing

### Unit tests for the composable (`test/composables/test_useFreshPluginData.ts`)

The composable uses Vue lifecycle hooks (`onMounted` / `onUnmounted`),
so full testing requires a Vue test-utils harness. **We don't have
one yet**, and adding one as a dependency is out of scope.

Approach: extract the **core refresh logic** into a pure
`refreshOnce(opts, controller)` helper that the composable calls from
inside its managed lifecycle. Test `refreshOnce` directly with mocked
`fetch` (global stub for Node test runner).

```ts
// Pure core
export async function refreshOnce<T>(
  opts: UseFreshPluginDataOptions<T>,
  signal: AbortSignal,
): Promise<boolean>;

// Composable wraps it with lifecycle + AbortController management
```

Test cases (~12 total):

1. **Happy path** — mock fetch returns JSON, extract returns value,
   apply is called, returns `true`.
2. **Non-OK response** — fetch returns `{ ok: false }`, no apply,
   returns `false`.
3. **Malformed JSON** — `res.json()` throws, returns `false`.
4. **Extract returns null** — apply skipped, returns `false`.
5. **AbortError thrown** — returns `false`, doesn't rethrow.
6. **Other fetch error** — returns `false`, doesn't rethrow.
7. **Aborted before fetch returns** — no apply, returns `false`.
8. **Aborted between fetch and json parse** — no apply, returns `false`.
9. **Array extract flavor** (simulates todo/scheduler).
10. **Bare-array extract flavor** (simulates manageRoles).
11. **Guarded apply** (simulates wiki/Preview index guard — calls a
    spy that checks internal state before accepting data).
12. **Endpoint is called fresh each refresh** (caller can derive URL
    from changing refs).

### Existing tests stay unchanged

No plugin-level tests exist today for the view components, so the
migration doesn't break anything in the test suite. Manual smoke on
the 4 affected plugin views is the verification path (called out in
the PR description, not automated).

## Risks & mitigations

- **Risk**: PR A diff is large (~300 lines across 9 files), harder
  to review than a series of tiny PRs.
  **Mitigation**: 3-commit structure lets reviewers read commit-by-
  commit. Composable commit is self-contained with tests; migration
  commit is mechanical apart from the documented bug fixes.

- **Risk**: The bug fixes (wiki/Preview guard, manageRoles watch) get
  hidden inside the refactor.
  **Mitigation**: PR description explicitly enumerates every bug the
  refactor fixes and points at the exact lines. Commit message for
  commit 3 mentions each one.

- **Risk**: `refreshOnce` extraction adds complexity to the composable.
  **Mitigation**: It's 1 extra exported function, unit-testable in
  isolation. The caller-facing API stays the same.

- **Risk**: Some view currently has incidental behavior we'd lose in
  the migration (e.g. todo/Preview currently has no AbortController
  and relying on that race condition somehow).
  **Mitigation**: Can't see any such reliance on reading. Will double-
  check during migration.

- **Risk**: Tests rely on global `fetch` stub which may conflict with
  other test files running in the same Node process.
  **Mitigation**: Save/restore the global fetch in `beforeEach` /
  `afterEach`, same pattern as `test/utils/dom/test_scrollable.ts`
  used for `getComputedStyle`.

## Out of scope / deferred to other PRs

- **PR B**: view-level error surfacing and action result checking
  - scheduler `applyChanges` silent failure
  - `yamlError` on applyItemEdit failure (both views)
  - scheduler `remove` result check
  - manageRoles `as` cast → type guard
- **PR C**: `server/api/routes/wiki.ts` DRY refactor
- **Preview lazy fetch** (IntersectionObserver + deferred mount): not
  required until real performance issues surface.
