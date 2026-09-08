// Unit tests for the pure shortcut refresh rule
// (src/composables/shortcutRefresh.ts).
//
// The case that matters is REMOVAL. Patching the persisted entry (`{...entry,
// ...fresh}`) keeps a field the live row has dropped, so a removed accent
// colour survived the refresh, stayed on disk, and made `hasShortcutDrifted`
// true again on the very next reconcile — rewriting the file on every index
// visit, forever (#2987). Every "does it update" assertion passed throughout.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  hasShortcutDrifted,
  reconcileShortcuts,
  refreshShortcut,
  type ShortcutRefreshRow,
  type ShortcutRefreshSource,
} from "../../src/composables/shortcutRefresh";
import type { Shortcut } from "../../src/types/shortcuts";

const pinned: Shortcut = { kind: "collection", slug: "podcasts", title: "Podcasts", icon: "podcasts", color: "violet" };

describe("refreshShortcut", () => {
  it("keeps the pin's own identity and takes every index-owned field from the row", () => {
    const fresh: ShortcutRefreshSource = { title: "Renamed", icon: "rss_feed", color: "sky" };
    assert.deepEqual(refreshShortcut(pinned, fresh), { kind: "collection", slug: "podcasts", title: "Renamed", icon: "rss_feed", color: "sky" });
  });

  it("DROPS a colour the live row no longer carries", () => {
    const fresh: ShortcutRefreshSource = { title: "Podcasts", icon: "podcasts" };
    const refreshed = refreshShortcut(pinned, fresh);
    assert.equal("color" in refreshed, false);
    assert.equal(JSON.stringify(refreshed).includes("color"), false);
  });

  it("settles after one refresh — the rewrite loop closes", () => {
    // The actual defect: refresh, then ask whether it still disagrees. A patch
    // that carries the stale colour answers "yes" forever.
    const fresh: ShortcutRefreshSource = { title: "Podcasts", icon: "podcasts" };
    const refreshed = refreshShortcut(pinned, fresh);
    assert.equal(hasShortcutDrifted(refreshed, fresh), false);
  });

  it("settles for every kind of change, not just removal", () => {
    const rows: ShortcutRefreshSource[] = [
      { title: "Podcasts", icon: "podcasts", color: "violet" },
      { title: "Renamed", icon: "podcasts", color: "violet" },
      { title: "Podcasts", icon: "rss_feed", color: "violet" },
      { title: "Podcasts", icon: "podcasts", color: "teal" },
      { title: "Podcasts", icon: "podcasts" },
      { title: "New", icon: "inbox" },
    ];
    rows.forEach((fresh) => {
      assert.equal(hasShortcutDrifted(refreshShortcut(pinned, fresh), fresh), false, JSON.stringify(fresh));
    });
  });

  it("adds a colour to a shortcut that had none", () => {
    const plain: Shortcut = { kind: "feed", slug: "news", title: "News", icon: "rss_feed" };
    assert.deepEqual(refreshShortcut(plain, { title: "News", icon: "rss_feed", color: "lime" }), {
      kind: "feed",
      slug: "news",
      title: "News",
      icon: "rss_feed",
      color: "lime",
    });
  });
});

describe("hasShortcutDrifted", () => {
  it("is false when the row agrees with what is pinned", () => {
    assert.equal(hasShortcutDrifted(pinned, { title: "Podcasts", icon: "podcasts", color: "violet" }), false);
  });

  it("notices a removed colour", () => {
    assert.equal(hasShortcutDrifted(pinned, { title: "Podcasts", icon: "podcasts" }), true);
  });

  it("notices an added colour", () => {
    const plain: Shortcut = { kind: "feed", slug: "news", title: "News", icon: "rss_feed" };
    assert.equal(hasShortcutDrifted(plain, { title: "News", icon: "rss_feed", color: "lime" }), true);
  });

  it("notices a changed title, icon or colour", () => {
    assert.equal(hasShortcutDrifted(pinned, { title: "Other", icon: "podcasts", color: "violet" }), true);
    assert.equal(hasShortcutDrifted(pinned, { title: "Podcasts", icon: "inbox", color: "violet" }), true);
    assert.equal(hasShortcutDrifted(pinned, { title: "Podcasts", icon: "podcasts", color: "teal" }), true);
  });
});

describe("reconcileShortcuts", () => {
  const pins: Shortcut[] = [
    { kind: "collection", slug: "podcasts", title: "Podcasts", icon: "podcasts", color: "violet" },
    { kind: "collection", slug: "notes", title: "Notes", icon: "menu_book" },
    { kind: "feed", slug: "news", title: "News", icon: "rss_feed", color: "sky" },
  ];
  const rowsFor = (...rows: ShortcutRefreshRow[]): ShortcutRefreshRow[] => rows;

  it("reports no drift when the index agrees, and returns the same entries", () => {
    const result = reconcileShortcuts(
      pins,
      "collection",
      rowsFor({ slug: "podcasts", title: "Podcasts", icon: "podcasts", color: "violet" }, { slug: "notes", title: "Notes", icon: "menu_book" }),
    );
    assert.equal(result.drifted, false);
    assert.deepEqual(result.next, pins);
  });

  it("leaves other kinds untouched — an index only speaks for its own", () => {
    // The feed pin must survive a collection reconcile that does not list it.
    const result = reconcileShortcuts(
      pins,
      "collection",
      rowsFor({ slug: "podcasts", title: "Podcasts", icon: "podcasts", color: "violet" }, { slug: "notes", title: "Notes", icon: "menu_book" }),
    );
    assert.ok(result.next.some((entry) => entry.kind === "feed" && entry.slug === "news"));
  });

  it("prunes a slug the index no longer lists", () => {
    const result = reconcileShortcuts(pins, "collection", rowsFor({ slug: "podcasts", title: "Podcasts", icon: "podcasts", color: "violet" }));
    assert.equal(result.drifted, true);
    assert.deepEqual(
      result.next.map((entry) => entry.slug),
      ["podcasts", "news"],
    );
  });

  it("clears a colour the index dropped, and then settles", () => {
    const rows = rowsFor({ slug: "podcasts", title: "Podcasts", icon: "podcasts" }, { slug: "notes", title: "Notes", icon: "menu_book" });
    const once = reconcileShortcuts(pins, "collection", rows);
    assert.equal(once.drifted, true);
    assert.equal(once.next[0] && "color" in once.next[0], false);
    // Running it again on the result must be a no-op — this is the property
    // that stops the file being rewritten on every index visit.
    assert.equal(reconcileShortcuts(once.next, "collection", rows).drifted, false);
  });

  it("is idempotent for every shape of change", () => {
    const cases: ShortcutRefreshRow[][] = [
      rowsFor({ slug: "podcasts", title: "Renamed", icon: "podcasts", color: "violet" }, { slug: "notes", title: "Notes", icon: "menu_book" }),
      rowsFor({ slug: "podcasts", title: "Podcasts", icon: "inbox", color: "violet" }, { slug: "notes", title: "Notes", icon: "menu_book" }),
      rowsFor({ slug: "podcasts", title: "Podcasts", icon: "podcasts", color: "lime" }, { slug: "notes", title: "Notes", icon: "menu_book", color: "teal" }),
      rowsFor({ slug: "notes", title: "Notes", icon: "menu_book" }),
      rowsFor(),
    ];
    cases.forEach((rows, index) => {
      const once = reconcileShortcuts(pins, "collection", rows);
      assert.equal(reconcileShortcuts(once.next, "collection", rows).drifted, false, `case ${index}`);
    });
  });

  it("prunes every collection pin when the index comes back empty", () => {
    const result = reconcileShortcuts(pins, "collection", []);
    assert.equal(result.drifted, true);
    assert.deepEqual(
      result.next.map((entry) => entry.slug),
      ["news"],
    );
  });

  it("reports no drift for an empty pin list", () => {
    assert.deepEqual(reconcileShortcuts([], "collection", rowsFor({ slug: "x", title: "X", icon: "inbox" })), { next: [], drifted: false });
  });
});

describe("refreshShortcut / reconcileShortcuts — fields this build does not name (#3055)", () => {
  // `config/shortcuts.json` is shared with MulmoTerminal. An index here is
  // authoritative about title / icon / colour and about nothing else, so a
  // field only the other app writes must survive a reconcile — otherwise the
  // server carrying it through (#3055) is undone the first time someone opens
  // an index and anything drifted.
  //
  // The type is deliberately not widened: the extra key exists in the FILE, not
  // in what this build declares, which is exactly the situation under test.
  // Spread rather than cast — an object literal with an extra key is rejected
  // outright, and `as` would hide a genuine mismatch in the rest of the shape.
  const carryingExtra = (entry: Shortcut, extra: Record<string, unknown>): Shortcut => ({ ...extra, ...entry });
  const carrying = carryingExtra({ kind: "collection", slug: "lens", title: "Lens", icon: "photo_camera" }, { futureField: "from another build" });

  it("keeps a field the index says nothing about", () => {
    assert.deepEqual(refreshShortcut(carrying, { title: "Renamed", icon: "photo_camera" }), {
      kind: "collection",
      slug: "lens",
      title: "Renamed",
      icon: "photo_camera",
      futureField: "from another build",
    });
  });

  it("still settles after one refresh — a carried field never re-triggers drift", () => {
    const fresh: ShortcutRefreshSource = { title: "Renamed", icon: "photo_camera" };
    assert.equal(hasShortcutDrifted(refreshShortcut(carrying, fresh), fresh), false);
  });

  it("carries it through a reconcile that rewrites the entry", () => {
    const rows: ShortcutRefreshRow[] = [{ slug: "lens", title: "Renamed", icon: "photo_camera" }];
    const once = reconcileShortcuts([carrying], "collection", rows);
    assert.equal(once.drifted, true);
    assert.deepEqual(once.next, [{ kind: "collection", slug: "lens", title: "Renamed", icon: "photo_camera", futureField: "from another build" }]);
    assert.equal(reconcileShortcuts(once.next, "collection", rows).drifted, false);
  });

  it("does NOT resurrect a colour the index dropped (#2987 stays fixed)", () => {
    const coloured = carryingExtra({ kind: "collection", slug: "lens", title: "Lens", icon: "photo_camera", color: "violet" }, { futureField: "kept" });
    const refreshed = refreshShortcut(coloured, { title: "Lens", icon: "photo_camera" });
    assert.equal("color" in refreshed, false);
    assert.deepEqual(refreshed, { kind: "collection", slug: "lens", title: "Lens", icon: "photo_camera", futureField: "kept" });
  });
});
