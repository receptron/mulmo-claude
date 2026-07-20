// Regression coverage for #2193: a record file written directly (the
// canonical agent path — Write tool, no REST route) must still emit the
// live-refresh change event, or open views go silently stale.
//
// Drives `_scheduleItemReconcileForTesting` rather than a real `fs.watch`
// mount: the watcher exports it precisely because fs event timing is too
// flaky to assert against, and the single-flight slot is what coalesces a
// burst into one publish.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  configureCollectionHost,
  setCollectionChangePublisher,
  setFirestoreAccessor,
  type CollectionChangePayload,
  type LoadedCollection,
} from "../../src/collection/server/index.ts";
import { configureNotifier, setNotifierFilePaths } from "../../src/notifier/index.ts";
import {
  configureCollectionWatchers,
  _scheduleItemReconcileForTesting,
  _tickTimeTriggersForTesting,
  startCollectionWatchers,
  stopCollectionWatchers,
  type CollectionNotificationAdapter,
} from "../../src/collection-watchers/index.ts";

const root = mkdtempSync(path.join(tmpdir(), "cw-pub-"));
test.after(() => rmSync(root, { recursive: true, force: true }));
const noopLog = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };

configureCollectionHost({
  workspaceRoot: root,
  log: noopLog,
  paths: {
    userSkillsDir: path.join(root, ".user-skills"),
    projectSkillsDir: (wsRoot) => path.join(wsRoot, ".claude", "skills"),
    feedsRoot: (wsRoot) => path.join(wsRoot, "data", "feeds"),
    skillsStagingDir: (wsRoot) => path.join(wsRoot, "data", "skills"),
    archiveDir: "data/archive",
    collectionsRegistriesConfig: (wsRoot) => path.join(wsRoot, "config", "collections-registries.json"),
  },
  isPresetSlug: () => false,
});

configureNotifier({
  writeJson: async (filePath, data) => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(data, null, 2));
  },
  publishEvent: () => {},
});

const adapter: CollectionNotificationAdapter = {
  pluginPkg: "test-bells",
  priorityToSeverity: () => "nudge",
  buildNavigateTarget: (slug, itemId) => `/x/${slug}/${itemId}`,
  buildPluginData: ({ legacyId }) => ({ kind: "cw", legacyId }),
  readEntry: () => null,
};
const warnings: { message: string; data?: Record<string, unknown> }[] = [];
configureCollectionWatchers({
  adapter,
  log: { info: () => {}, warn: (message, data) => warnings.push({ message, data }) },
});

const SCHEMA = { primaryKey: "id", title: "Tasks", displayField: "name", completionField: "done", completionDoneValues: ["true"] } as never;

// The reconciler only needs slug + schema + dataDir off the collection;
// a minimal cast keeps the test independent of full discovery (mirrors
// `asCollection` in test_reconciler.ts).
const asCollection = (slug: string, schema: unknown, dataDir: string): LoadedCollection =>
  ({ slug, source: "project", schema, dataDir, skillDir: dataDir }) as unknown as LoadedCollection;

const published: CollectionChangePayload[] = [];
setCollectionChangePublisher((payload) => published.push(payload));

function freshDataDir(records: Record<string, unknown>[]): string {
  const dir = mkdtempSync(path.join(root, "coll-"));
  for (const rec of records) writeFileSync(path.join(dir, `${rec.id as string}.json`), JSON.stringify(rec));
  const notifDir = mkdtempSync(path.join(root, "notif-"));
  setNotifierFilePaths({ active: path.join(notifDir, "active.json"), history: path.join(notifDir, "history.json") });
  published.length = 0;
  return dir;
}

test("a record present on disk publishes op=upsert with its id", async () => {
  const dataDir = freshDataDir([{ id: "t1", name: "Pending", done: "false" }]);
  try {
    await _scheduleItemReconcileForTesting(asCollection("todo", SCHEMA, dataDir), "t1");
    assert.deepEqual(published, [{ slug: "todo", ids: ["t1"], op: "upsert" }]);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a record missing from disk publishes op=delete", async () => {
  const dataDir = freshDataDir([]);
  try {
    await _scheduleItemReconcileForTesting(asCollection("todo", SCHEMA, dataDir), "gone");
    assert.deepEqual(published, [{ slug: "todo", ids: ["gone"], op: "delete" }]);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a burst on one record coalesces into a single publish", async () => {
  const dataDir = freshDataDir([{ id: "t1", name: "Pending", done: "false" }]);
  try {
    // Same tick, same key: calls 2-3 land on the in-flight slot and only
    // set `pending`, so the burst must yield one event, not three.
    await Promise.all([
      _scheduleItemReconcileForTesting(asCollection("todo", SCHEMA, dataDir), "t1"),
      _scheduleItemReconcileForTesting(asCollection("todo", SCHEMA, dataDir), "t1"),
      _scheduleItemReconcileForTesting(asCollection("todo", SCHEMA, dataDir), "t1"),
    ]);
    assert.equal(published.length, 1);
    assert.deepEqual(published[0], { slug: "todo", ids: ["t1"], op: "upsert" });
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("distinct records each publish their own event", async () => {
  const dataDir = freshDataDir([
    { id: "a", name: "A", done: "false" },
    { id: "b", name: "B", done: "false" },
  ]);
  try {
    await Promise.all([
      _scheduleItemReconcileForTesting(asCollection("todo", SCHEMA, dataDir), "a"),
      _scheduleItemReconcileForTesting(asCollection("todo", SCHEMA, dataDir), "b"),
    ]);
    assert.equal(published.length, 2);
    assert.deepEqual(published.map((event) => event.ids?.[0]).sort(), ["a", "b"]);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a collection without completionField still publishes", async () => {
  const noBellSchema = { primaryKey: "id", title: "Notes", displayField: "name" } as never;
  const dataDir = freshDataDir([{ id: "n1", name: "Note" }]);
  try {
    await _scheduleItemReconcileForTesting(asCollection("notes", noBellSchema, dataDir), "n1");
    assert.deepEqual(published, [{ slug: "notes", ids: ["n1"], op: "upsert" }]);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a throwing publisher neither fails the reconcile nor wedges the slot", async () => {
  const dataDir = freshDataDir([{ id: "t1", name: "Pending", done: "false" }]);
  setCollectionChangePublisher(() => {
    throw new Error("host publisher exploded");
  });
  try {
    await assert.doesNotReject(() => _scheduleItemReconcileForTesting(asCollection("todo", SCHEMA, dataDir), "t1"));
    // The slot lives in a module-level map keyed by (slug, itemId); if the
    // throw escaped before its `finally` freed the key, this second pass
    // would join a dead slot and never publish.
    setCollectionChangePublisher((payload) => published.push(payload));
    await _scheduleItemReconcileForTesting(asCollection("todo", SCHEMA, dataDir), "t1");
    assert.deepEqual(published, [{ slug: "todo", ids: ["t1"], op: "upsert" }]);
  } finally {
    setCollectionChangePublisher((payload) => published.push(payload));
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// A closed remote-host session is an ordinary state that can last hours.
// `reconcileAllItems` warns on every failed store read, so attempting the
// pass anyway would emit a line per firestore collection per minute forever.
// The tick must skip the whole pass instead — asserted on the LOG, because
// that (not the bell state) is what the skip protects.
test("a disconnected session produces no per-tick reconcile warnings", async () => {
  const dir = mkdtempSync(path.join(root, "fs-quiet-"));
  const skillDir = path.join(dir, ".claude", "skills", "cloud-quiet");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: cloud-quiet\ndescription: t\n---\nbody\n");
  writeFileSync(
    path.join(skillDir, "schema.json"),
    JSON.stringify({
      title: "Quiet",
      icon: "cloud",
      storage: { type: "firestore" },
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true, required: true }, read: { type: "boolean", label: "R", required: true } },
      completionField: "read",
      completionDoneValues: ["true"],
    }),
  );

  setFirestoreAccessor(null); // no session
  await startCollectionWatchers({
    discoveryOpts: { workspaceRoot: dir, userSkillsDir: path.join(dir, ".user") },
    rediscoveryIntervalMs: null,
    triggerTickIntervalMs: null,
  });
  try {
    warnings.length = 0;
    await _tickTimeTriggersForTesting();
    await _tickTimeTriggersForTesting();
    const readFailures = warnings.filter((entry) => entry.message.includes("reconcile list failed"));
    assert.deepEqual(readFailures, [], "a closed session must not warn once per tick");
  } finally {
    await stopCollectionWatchers();
    setFirestoreAccessor(null);
    rmSync(dir, { recursive: true, force: true });
  }
});
