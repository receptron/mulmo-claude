import "../../../server/workspace/collections/configure.js"; // configure @mulmoclaude/core/collection host binding for tests
// Watcher-layer tests for the collection-completion bell. Exercises:
//
//  - Boot reconcile (a pending item already on disk gets a bell entry
//    when `startCollectionWatchers` runs).
//  - Runtime collection removal (the schema dir is deleted; a manual
//    `_syncWatchersForTesting` call clears the now-orphaned entry).
//  - Schema flip from no-tracking to tracking (existing items get
//    entries on the next sync — the case Codex flagged).
//  - The per-key single-flight scheduler (`scheduleItemReconcile`):
//    rapid-fire calls coalesce into one publish plus one trailing
//    pass, so concurrent reconciles can't race the engine's write
//    queue into duplicate entries.
//
// `fs.watch` event timing is too flaky to assert against directly —
// the watcher boots fine in production but a Node test that writes a
// file and immediately checks the bell can land before the OS has
// dispatched the event. We exercise the watcher's logic through
// `_syncWatchersForTesting` (sync the watcher set on demand) and
// `_scheduleItemReconcileForTesting` (drive the single-flight slot
// directly).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _setFilePathsForTesting, initNotifier, listAll } from "../../../server/notifier/engine.js";
import {
  _scheduleItemReconcileForTesting,
  _scheduleStorageReconcileForTesting,
  _syncWatchersForTesting,
  startCollectionWatchers,
  stopCollectionWatchers,
} from "../../../server/workspace/collections/watcher.js";
import { loadCollection, storeFor } from "@mulmoclaude/core/collection/server";
import type { CollectionSchema } from "../../../server/workspace/collections/types.js";
import type { LoadedCollection } from "@mulmoclaude/core/collection/server";

let workdir: string;
let userDir: string;
let notifierDir: string;

const SLUG = "test-watcher";

function buildSchema(extra: Partial<CollectionSchema> = {}): CollectionSchema {
  return {
    title: "Test Watcher",
    icon: "check_circle",
    dataPath: `data/${SLUG}/items`,
    primaryKey: "id",
    fields: {
      id: { type: "string", label: "ID", primary: true, required: true },
      read: { type: "boolean", label: "Read", required: true },
    },
    completionField: "read",
    completionDoneValues: ["true"],
    ...extra,
  };
}

function writeSchema(schema: CollectionSchema): void {
  const skillDir = path.join(workdir, ".claude/skills", SLUG);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: ${SLUG}\ndescription: test\n---\nbody\n`);
  writeFileSync(path.join(skillDir, "schema.json"), JSON.stringify(schema));
}

function deleteSchemaDir(): void {
  rmSync(path.join(workdir, ".claude/skills", SLUG), { recursive: true, force: true });
}

function writeItem(itemId: string, body: Record<string, unknown>): void {
  const dataDir = path.join(workdir, "data", SLUG, "items");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, `${itemId}.json`), JSON.stringify({ id: itemId, ...body }));
}

async function activeCompletionEntries(): Promise<{ id: string; legacyId: string }[]> {
  const entries = await listAll();
  return entries
    .filter((entry) => {
      const data = entry.pluginData as Record<string, unknown> | undefined;
      return data?.legacy === true && typeof data.legacyId === "string" && (data.legacyId as string).startsWith("collection-completion:");
    })
    .map((entry) => ({
      id: entry.id,
      legacyId: (entry.pluginData as Record<string, unknown>).legacyId as string,
    }));
}

beforeEach(async () => {
  workdir = mkdtempSync(path.join(tmpdir(), "test-watcher-"));
  userDir = mkdtempSync(path.join(tmpdir(), "test-watcher-user-"));
  notifierDir = mkdtempSync(path.join(tmpdir(), "test-watcher-notifier-"));
  _setFilePathsForTesting({
    active: path.join(notifierDir, "active.json"),
    history: path.join(notifierDir, "history.json"),
  });
  initNotifier({ publish: () => {} });
  // Make sure a previous test's watcher state didn't leak.
  await stopCollectionWatchers();
});

afterEach(async () => {
  await stopCollectionWatchers();
  rmSync(workdir, { recursive: true, force: true });
  rmSync(userDir, { recursive: true, force: true });
  rmSync(notifierDir, { recursive: true, force: true });
});

describe("startCollectionWatchers boot reconcile", () => {
  it("publishes bell entries for pending items already on disk at boot", async () => {
    writeSchema(buildSchema());
    writeItem("a", { read: false });
    writeItem("b", { read: true });
    writeItem("c", { read: false });

    await startCollectionWatchers({
      discoveryOpts: { workspaceRoot: workdir, userSkillsDir: userDir },
      rediscoveryIntervalMs: null,
    });

    const entries = await activeCompletionEntries();
    const legacyIds = entries.map((entry) => entry.legacyId).sort();
    assert.deepEqual(legacyIds, [`collection-completion:${SLUG}:a`, `collection-completion:${SLUG}:c`]);
  });

  it("ignores collections that don't declare completionField", async () => {
    writeSchema(buildSchema({ completionField: undefined, completionDoneValues: undefined }));
    writeItem("a", { read: false });

    await startCollectionWatchers({
      discoveryOpts: { workspaceRoot: workdir, userSkillsDir: userDir },
      rediscoveryIntervalMs: null,
    });

    assert.equal((await activeCompletionEntries()).length, 0);
  });
});

describe("syncWatchers runtime drift", () => {
  it("clears the entry when the collection is deleted at runtime", async () => {
    writeSchema(buildSchema());
    writeItem("a", { read: false });

    await startCollectionWatchers({
      discoveryOpts: { workspaceRoot: workdir, userSkillsDir: userDir },
      rediscoveryIntervalMs: null,
    });
    assert.equal((await activeCompletionEntries()).length, 1);

    deleteSchemaDir();
    await _syncWatchersForTesting();

    assert.equal((await activeCompletionEntries()).length, 0);
  });

  it("publishes for a still-pending item when completionField is added later", async () => {
    // Schema without completion tracking + one item.
    writeSchema(buildSchema({ completionField: undefined, completionDoneValues: undefined }));
    writeItem("a", { read: false });

    await startCollectionWatchers({
      discoveryOpts: { workspaceRoot: workdir, userSkillsDir: userDir },
      rediscoveryIntervalMs: null,
    });
    assert.equal((await activeCompletionEntries()).length, 0);

    // Flip the schema to start tracking — re-sync should fill in the entry.
    writeSchema(buildSchema());
    await _syncWatchersForTesting();

    const entries = await activeCompletionEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.legacyId, `collection-completion:${SLUG}:a`);
  });

  it("clears entries when completionField is removed from the schema", async () => {
    writeSchema(buildSchema());
    writeItem("a", { read: false });

    await startCollectionWatchers({
      discoveryOpts: { workspaceRoot: workdir, userSkillsDir: userDir },
      rediscoveryIntervalMs: null,
    });
    assert.equal((await activeCompletionEntries()).length, 1);

    writeSchema(buildSchema({ completionField: undefined, completionDoneValues: undefined }));
    await _syncWatchersForTesting();

    assert.equal((await activeCompletionEntries()).length, 0);
  });
});

describe("scheduleItemReconcile single-flight", () => {
  it("produces exactly one bell entry from a rapid-fire burst on the same key", async () => {
    writeSchema(buildSchema());
    writeItem("a", { read: false });

    // Discover so the watcher module has discoveryOpts (the
    // single-flight path doesn't need a started watcher, but the
    // reconciler's readItem still needs the right workspaceRoot
    // threaded through).
    await startCollectionWatchers({
      discoveryOpts: { workspaceRoot: workdir, userSkillsDir: userDir },
      rediscoveryIntervalMs: null,
    });
    // Boot reconcile may have already published an entry for the
    // pending item; record that baseline and assert the burst added
    // at most one more (in practice: zero — `ensure*` is idempotent).
    const baseline = (await activeCompletionEntries()).length;

    // Fire ten concurrent reconciles. With the single-flight slot, all
    // ten collapse into one in-flight reconcile + one trailing re-run.
    // Without it, each would `listAll → publish` while the others'
    // writes are still queued, producing duplicate entries.
    const schema = buildSchema();
    const dataDir = path.join(workdir, "data", SLUG, "items");
    const promises = Array.from({ length: 10 }, () =>
      _scheduleItemReconcileForTesting({ slug: SLUG, source: "project", schema, dataDir, skillDir: dataDir } as unknown as LoadedCollection, "a"),
    );
    await Promise.all(promises);

    const after = (await activeCompletionEntries()).length;
    // Either there was already a boot entry (baseline=1, after=1) or
    // there wasn't (baseline=0, after=1). Either way, the burst added
    // at most one entry — never two.
    assert.equal(after, Math.max(baseline, 1), "rapid-fire reconciles must not produce duplicate entries");
  });
});

describe("storage (sqlite) collection reconciliation", () => {
  const DB_SLUG = "test-watcher-db";

  function writeDbSchema(): void {
    const skillDir = path.join(workdir, ".claude/skills", DB_SLUG);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: ${DB_SLUG}\ndescription: test\n---\nbody\n`);
    writeFileSync(
      path.join(skillDir, "schema.json"),
      JSON.stringify({
        title: "DB Watcher",
        icon: "check_circle",
        storage: { type: "sqlite", path: `data/${DB_SLUG}.db` },
        primaryKey: "id",
        fields: {
          id: { type: "string", label: "ID", primary: true, required: true },
          read: { type: "boolean", label: "Read", required: true },
        },
        completionField: "read",
        completionDoneValues: ["true"],
      }),
    );
  }

  it("bells a pending sqlite record and clears it when it turns done", async () => {
    writeDbSchema();
    await startCollectionWatchers({
      discoveryOpts: { workspaceRoot: workdir, userSkillsDir: userDir },
      rediscoveryIntervalMs: null,
      triggerTickIntervalMs: null,
    });
    const collection = await loadCollection(DB_SLUG, { workspaceRoot: workdir, userSkillsDir: userDir });
    assert.ok(collection);
    const store = storeFor(collection, { workspaceRoot: workdir });
    assert.ok(store.write);

    await store.write("a", { id: "a", read: false });
    await _scheduleStorageReconcileForTesting(DB_SLUG);
    let legacyIds = (await activeCompletionEntries()).map((entry) => entry.legacyId);
    assert.ok(legacyIds.includes(`collection-completion:${DB_SLUG}:a`), `expected a bell for a, got ${JSON.stringify(legacyIds)}`);

    await store.write("a", { id: "a", read: true });
    await _scheduleStorageReconcileForTesting(DB_SLUG);
    legacyIds = (await activeCompletionEntries()).map((entry) => entry.legacyId);
    assert.ok(!legacyIds.includes(`collection-completion:${DB_SLUG}:a`), "bell must clear once the record is done");
  });

  it("clears the bell when a pending sqlite record is DELETED (stale sweep)", async () => {
    writeDbSchema();
    await startCollectionWatchers({
      discoveryOpts: { workspaceRoot: workdir, userSkillsDir: userDir },
      rediscoveryIntervalMs: null,
      triggerTickIntervalMs: null,
    });
    const collection = await loadCollection(DB_SLUG, { workspaceRoot: workdir, userSkillsDir: userDir });
    assert.ok(collection);
    const store = storeFor(collection, { workspaceRoot: workdir });
    assert.ok(store.write && store.delete);

    await store.write("b", { id: "b", read: false });
    await _scheduleStorageReconcileForTesting(DB_SLUG);
    let legacyIds = (await activeCompletionEntries()).map((entry) => entry.legacyId);
    assert.ok(legacyIds.includes(`collection-completion:${DB_SLUG}:b`));

    // One db file holds every record — a delete produces no per-item event,
    // so the full-pass reconcile must pair with the stale sweep (PR #2204
    // review finding) to clear the removed record's bell.
    await store.delete("b");
    await _scheduleStorageReconcileForTesting(DB_SLUG);
    legacyIds = (await activeCompletionEntries()).map((entry) => entry.legacyId);
    assert.ok(!legacyIds.includes(`collection-completion:${DB_SLUG}:b`), "bell must clear when the record is deleted");
  });
});

describe("storage (firestore) collection — watcher set stays quiet", () => {
  const FS_SLUG = "test-watcher-firestore";

  function writeFirestoreSchema(): void {
    const skillDir = path.join(workdir, ".claude/skills", FS_SLUG);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: ${FS_SLUG}\ndescription: test\n---\nbody\n`);
    writeFileSync(
      path.join(skillDir, "schema.json"),
      JSON.stringify({
        title: "Cloud Watcher",
        icon: "cloud",
        storage: { type: "firestore" },
        primaryKey: "id",
        fields: {
          id: { type: "string", label: "ID", primary: true, required: true },
          item: { type: "string", label: "Item" },
        },
      }),
    );
  }

  // Regression for the Codex finding on PR #2209: a firestore collection has
  // no file to watch, so it never enters `watchers` and `startNewWatchers`
  // retries it on every tick. Reporting that attempt as a mutation made
  // `syncWatchers` sweep every 30s forever, for as long as one such
  // collection existed. A quiet tick must report no mutation.
  it("does not report a mutation on repeat ticks (no permanent sweep loop)", async () => {
    writeFirestoreSchema();
    await startCollectionWatchers({
      discoveryOpts: { workspaceRoot: workdir, userSkillsDir: userDir },
      rediscoveryIntervalMs: null,
      triggerTickIntervalMs: null,
    });

    // Nothing changed between these — both must be quiet. Before the fix the
    // firestore collection made every one of them report a mutation.
    assert.equal(await _syncWatchersForTesting(), false, "first quiet tick must not sweep");
    assert.equal(await _syncWatchersForTesting(), false, "second quiet tick must not sweep");
  });

  it("still reports a mutation when a watchable collection really appears", async () => {
    writeFirestoreSchema();
    await startCollectionWatchers({
      discoveryOpts: { workspaceRoot: workdir, userSkillsDir: userDir },
      rediscoveryIntervalMs: null,
      triggerTickIntervalMs: null,
    });
    assert.equal(await _syncWatchersForTesting(), false);

    // A file-backed collection appearing IS a real mutation — the quiet-tick
    // fix must not suppress that signal.
    writeSchema(buildSchema());
    assert.equal(await _syncWatchersForTesting(), true, "a newly mounted watcher must still sweep");
  });
});
