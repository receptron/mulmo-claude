import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { WORKSPACE_FILES } from "../../../../server/workspace/paths.js";
import { normalizeShortcuts, readShortcuts, writeShortcuts } from "../../../../server/utils/files/shortcuts-io.js";
import type { Shortcut } from "../../../../src/types/shortcuts.js";
import { ACCENT_COLORS } from "@mulmoclaude/core/collection";

function makeWorkspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mulmoclaude-shortcuts-"));
  return realpathSync(dir);
}

function rmDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function filePath(root: string): string {
  return path.join(root, WORKSPACE_FILES.shortcuts);
}

const sample: Shortcut = { kind: "collection", slug: "invoices", title: "Invoices", icon: "receipt" };

describe("shortcuts-io — read", () => {
  let root: string;
  before(() => {
    root = makeWorkspace();
  });
  after(() => rmDir(root));

  it("returns [] when the file is missing", async () => {
    assert.deepEqual(await readShortcuts(root), []);
  });

  it("returns [] on malformed JSON", async () => {
    mkdirSync(path.dirname(filePath(root)), { recursive: true });
    writeFileSync(filePath(root), "{ not json");
    assert.deepEqual(await readShortcuts(root), []);
  });

  it("reads back what was written", async () => {
    await writeShortcuts([sample], root);
    assert.deepEqual(await readShortcuts(root), [sample]);
  });
});

describe("shortcuts-io — write", () => {
  let root: string;
  before(() => {
    root = makeWorkspace();
  });
  after(() => rmDir(root));

  it("persists the object-wrapped shape with a trailing newline", async () => {
    await writeShortcuts([sample], root);
    const raw = readFileSync(filePath(root), "utf-8");
    assert.equal(raw.endsWith("\n"), true);
    assert.deepEqual(JSON.parse(raw), { shortcuts: [sample] });
  });

  it("dedupes on (kind, slug), keeping the first occurrence", async () => {
    const written = await writeShortcuts(
      [sample, { kind: "collection", slug: "invoices", title: "Other label", icon: "x" }, { kind: "feed", slug: "invoices", title: "Feed", icon: "rss_feed" }],
      root,
    );
    assert.deepEqual(written, [sample, { kind: "feed", slug: "invoices", title: "Feed", icon: "rss_feed" }]);
  });
});

describe("normalizeShortcuts — accent colour (#2987)", () => {
  // `normalizeShortcuts` REBUILDS every field it names — `color` among them —
  // and every pin / unpin / reorder / reconcile goes through it. Without these,
  // the accent survived in memory and vanished the moment it was persisted,
  // which is exactly how it shipped broken. (A field it does NOT name is carried
  // rather than dropped — see the #3055 block below.)
  it("preserves a palette colour through a write/read round trip", async () => {
    const root = makeWorkspace();
    try {
      await writeShortcuts([{ kind: "collection", slug: "podcasts", title: "Podcasts", icon: "podcasts", color: "violet" }], root);
      assert.deepEqual(await readShortcuts(root), [{ kind: "collection", slug: "podcasts", title: "Podcasts", icon: "podcasts", color: "violet" }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps every colour the palette declares", () => {
    ACCENT_COLORS.forEach((color) => {
      const [entry] = normalizeShortcuts([{ kind: "collection", slug: "s", title: "T", icon: "podcasts", color }]);
      assert.equal(entry?.color, color, color);
    });
  });

  it("drops a colour the palette does not carry rather than persisting it", () => {
    ["puce", "Violet", "", "red", 7, null, {}].forEach((color) => {
      const [entry] = normalizeShortcuts([{ kind: "collection", slug: "s", title: "T", icon: "podcasts", color }]);
      assert.ok(entry, JSON.stringify(color));
      assert.equal("color" in entry, false, JSON.stringify(color));
    });
  });

  it("omits the key entirely when there is no colour, rather than writing a null", () => {
    const [entry] = normalizeShortcuts([{ kind: "collection", slug: "s", title: "T", icon: "podcasts" }]);
    assert.ok(entry);
    assert.equal("color" in entry, false);
    assert.equal(JSON.stringify(entry).includes("color"), false);
  });
});

describe("normalizeShortcuts — validation", () => {
  it("drops non-array input", () => {
    assert.deepEqual(normalizeShortcuts(null), []);
    assert.deepEqual(normalizeShortcuts({ foo: 1 }), []);
  });

  it("drops entries with a bad kind or empty slug", () => {
    const input = [
      { kind: "wiki", slug: "x", title: "t", icon: "i" }, // bad kind
      { kind: "collection", slug: "", title: "t", icon: "i" }, // empty slug
      { kind: "feed", slug: "ok", title: "t", icon: "i" }, // valid
    ];
    assert.deepEqual(normalizeShortcuts(input), [{ kind: "feed", slug: "ok", title: "t", icon: "i" }]);
  });

  it("backfills missing title/icon defaults", () => {
    assert.deepEqual(normalizeShortcuts([{ kind: "collection", slug: "s" }]), [{ kind: "collection", slug: "s", title: "s", icon: "bookmark" }]);
  });
});

describe("normalizeShortcuts — fields this build does not name (#3055)", () => {
  // `config/shortcuts.json` is shared with MulmoTerminal, and both apps rebuild
  // every record they write — so a field only one of them names is deleted by
  // the other. That is how `color` broke, in both directions (#2987 /
  // mulmoterminal#1993). Naming each new field in both apps is a rule someone
  // has to remember; carrying the rest through is not.
  it("carries a field this build has never heard of", () => {
    const stored = { kind: "collection", slug: "lens", title: "Lens", icon: "photo_camera", sortHint: 3, badge: { text: "new" } };
    assert.deepEqual(normalizeShortcuts([stored]), [stored]);
  });

  // ...but a carried field never beats a validated one: the known keys are
  // applied last.
  it("lets the checked value win over what the file held", () => {
    assert.deepEqual(normalizeShortcuts([{ kind: "feed", slug: "b", title: 5, icon: "", extra: "kept" }]), [
      { kind: "feed", slug: "b", title: "b", icon: "bookmark", extra: "kept" },
    ]);
  });

  it("survives the write/read round trip that a pin, unpin or reorder performs", async () => {
    const root = makeWorkspace();
    try {
      mkdirSync(path.dirname(filePath(root)), { recursive: true });
      const stored = { kind: "collection", slug: "lens", title: "Lens", icon: "photo_camera", futureField: "from another build" };
      writeFileSync(filePath(root), JSON.stringify({ shortcuts: [stored] }));

      // The list written back is the one that was read — what every mutation in
      // `useShortcuts` does. A read that dropped the field would still pass an
      // assertion made against the fixture instead.
      const served = await readShortcuts(root);
      assert.deepEqual(served, [stored]);
      await writeShortcuts(served, root);
      assert.deepEqual(JSON.parse(readFileSync(filePath(root), "utf-8")), { shortcuts: [stored] });
    } finally {
      rmDir(root);
    }
  });

  // Carried, NOT merged. A writer that means to REMOVE the field — the other app
  // dropping something it no longer stores — must not have it put back by this
  // one, which is what merging against the file on write would do.
  it("lets a write remove an unknown field it left out", async () => {
    const root = makeWorkspace();
    try {
      mkdirSync(path.dirname(filePath(root)), { recursive: true });
      const kept = { kind: "collection", slug: "lens", title: "Lens", icon: "photo_camera" };
      writeFileSync(filePath(root), JSON.stringify({ shortcuts: [{ ...kept, futureField: "from another build" }] }));

      await writeShortcuts([kept], root);
      assert.deepEqual(JSON.parse(readFileSync(filePath(root), "utf-8")), { shortcuts: [kept] });
    } finally {
      rmDir(root);
    }
  });

  // A key named `__proto__` is a setter on Object.prototype: assigning it
  // re-parents the object and the key vanishes from the JSON. Built with
  // `Object.fromEntries`, it stays ordinary data.
  it("keeps a __proto__ key as data rather than a prototype", () => {
    const [entry] = normalizeShortcuts([JSON.parse('{"kind":"collection","slug":"a","title":"A","icon":"star","__proto__":{"polluted":true}}')]);
    assert.ok(entry);
    assert.equal(Object.getPrototypeOf(entry), Object.prototype);
    assert.equal(Object.hasOwn(entry, "__proto__"), true);
    assert.equal("polluted" in {}, false);
    assert.equal(JSON.stringify(entry).includes("__proto__"), true);
  });
});
