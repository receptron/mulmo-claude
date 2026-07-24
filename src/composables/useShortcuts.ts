// Client store for manually-pinned launcher shortcuts (collections /
// feeds). Singleton module state shared across every consumer — the
// launcher renders them, the index cards + view header toggle them, and
// the indexes reconcile stale labels — so they all see one list.
//
// Persistence is server-side (`config/shortcuts.json` via PUT /api/
// shortcuts); the client owns the full array and replaces it wholesale.
// Mutations are optimistic with rollback on failure.

import { computed, ref, type ComputedRef } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { apiGet, apiPut } from "../utils/api";
import { createMutationQueue } from "../utils/mutationQueue";
import { sameShortcut, type Shortcut, type ShortcutKind } from "../types/shortcuts";

const shortcuts = ref<Shortcut[]>([]);
const loadError = ref<string | null>(null);
/** True only after a GET has authoritatively populated `shortcuts`. Until
 *  then, mutations refuse to persist — a replace-all PUT built on the
 *  empty default would clobber an existing `shortcuts.json`. */
const loaded = ref(false);
let loadPromise: Promise<void> | null = null;

interface ShortcutsResponse {
  shortcuts: Shortcut[];
}

/** Load once per session (deduped). Subsequent calls return the same
 *  promise; pass `force` to re-fetch (rarely needed — mutations keep the
 *  ref authoritative). A FAILED load is not cached: `loadPromise` is
 *  cleared so the next call retries, rather than permanently serving the
 *  failed result (which would leave `loaded` false and block mutations
 *  until reload). */
async function load(force = false): Promise<void> {
  if (loadPromise && !force) return loadPromise;
  loadPromise = (async () => {
    const result = await apiGet<ShortcutsResponse>(API_ROUTES.shortcuts);
    if (!result.ok) {
      loadError.value = result.error;
      loadPromise = null; // allow retry on the next call
      return;
    }
    loadError.value = null;
    shortcuts.value = result.data.shortcuts;
    loaded.value = true;
  })();
  return loadPromise;
}

// `PUT /api/shortcuts` rewrites the whole array, so every mutation runs
// through this queue and the replace-all PUTs never overlap. See
// `createMutationQueue` for the races that prevents.
const { enqueue } = createMutationQueue();

/** Persist the given list, rolling the local ref back to `previous` on
 *  failure. Returns true on success. Call only from inside `enqueue`. */
async function persist(next: Shortcut[], previous: Shortcut[]): Promise<boolean> {
  shortcuts.value = next;
  const result = await apiPut<ShortcutsResponse>(API_ROUTES.shortcuts, { shortcuts: next });
  if (!result.ok) {
    shortcuts.value = previous;
    loadError.value = result.error;
    // Surfacing in console mirrors useNotifications' own failure
    // handling — a transient pin error shouldn't shout from the chrome.
    console.error("[useShortcuts] persist failed", result.error);
    return false;
  }
  // Adopt the server's canonical (normalised) list.
  shortcuts.value = result.data.shortcuts;
  loadError.value = null;
  return true;
}

function isPinned(kind: ShortcutKind, slug: string): boolean {
  return shortcuts.value.some((entry) => sameShortcut(entry, { kind, slug }));
}

/** Pin a shortcut (no-op if already pinned). Appends in insertion order. */
function pin(shortcut: Shortcut): Promise<boolean> {
  return enqueue(async () => {
    await load();
    if (!loaded.value) return false; // never overwrite an unread list
    if (isPinned(shortcut.kind, shortcut.slug)) return true;
    const previous = shortcuts.value;
    return persist([...previous, shortcut], previous);
  });
}

/** Remove a pinned shortcut (no-op if not pinned). */
function unpin(kind: ShortcutKind, slug: string): Promise<boolean> {
  return enqueue(async () => {
    await load();
    if (!loaded.value) return false; // never overwrite an unread list
    if (!isPinned(kind, slug)) return true;
    const previous = shortcuts.value;
    return persist(
      previous.filter((entry) => !sameShortcut(entry, { kind, slug })),
      previous,
    );
  });
}

/** Bulk reconcile one kind against the authoritative `{slug,title,icon}`
 *  list an index just fetched: prune dead slugs, refresh survivors'
 *  title/icon. If anything drifted, PUT the corrected list so the file
 *  self-heals (an in-memory filter alone leaves dead entries forever).
 *  Other kinds are left untouched. */
function reconcile(kind: ShortcutKind, live: { slug: string; title: string; icon: string }[]): Promise<void> {
  return enqueue(async () => {
    await load();
    if (!loaded.value) return; // never overwrite an unread list
    const liveBySlug = new Map(live.map((entry) => [entry.slug, entry]));
    let drifted = false;
    const next = shortcuts.value.flatMap((entry) => {
      if (entry.kind !== kind) return [entry];
      const fresh = liveBySlug.get(entry.slug);
      if (!fresh) {
        drifted = true; // dead slug — prune
        return [];
      }
      if (fresh.title !== entry.title || fresh.icon !== entry.icon) {
        drifted = true; // stale label — refresh
        return [{ ...entry, title: fresh.title, icon: fresh.icon }];
      }
      return [entry];
    });
    if (drifted) await persist(next, shortcuts.value);
  });
}

export function useShortcuts(): {
  shortcuts: ComputedRef<Shortcut[]>;
  loadError: ComputedRef<string | null>;
  load: (force?: boolean) => Promise<void>;
  isPinned: (kind: ShortcutKind, slug: string) => boolean;
  pin: (shortcut: Shortcut) => Promise<boolean>;
  unpin: (kind: ShortcutKind, slug: string) => Promise<boolean>;
  reconcile: (kind: ShortcutKind, live: { slug: string; title: string; icon: string }[]) => Promise<void>;
} {
  void load();
  return {
    shortcuts: computed(() => shortcuts.value),
    loadError: computed(() => loadError.value),
    load,
    isPinned,
    pin,
    unpin,
    reconcile,
  };
}
