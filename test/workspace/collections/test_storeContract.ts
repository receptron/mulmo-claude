import "../../../server/workspace/collections/configure.js"; // configure @mulmoclaude/core/collection host binding for tests
// Shared storage-contract suite (plans/refactor-storage-virtualization.md).
// ONE set of assertions run against EVERY CollectionStore implementation —
// the per-record JSON file store, the DuckDB-backed CSV `dataSource` store,
// and the node:sqlite `storage` store — pinning the contract documented on
// the interface: stable order, offset/limit paging, `fields` projection
// with the primary key always kept, `read` round-trips for every listed
// id, honest `truncated`/`total`, `query` present iff `nativeQuery`, and
// write/delete present iff writable (with create-conflict semantics).
// A future backend joins by passing this suite unchanged.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  CollectionSchemaZ,
  discoverCollections,
  pageFromFullRead,
  projectItemFields,
  setFirestoreAccessor,
  storeFor,
  type CollectionStore,
  type FirestoreDoc,
  type FirestoreDocs,
} from "@mulmoclaude/core/collection/server";

let workdir: string;
let emptyUserDir: string;

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "store-contract-"));
  emptyUserDir = mkdtempSync(path.join(tmpdir(), "store-contract-user-"));
});

afterEach(() => {
  // Module-level state — leaving a fixture's fake wired would let a
  // firestore collection resolve in a later test that never set one up.
  setFirestoreAccessor(null);
  rmSync(workdir, { recursive: true, force: true });
  rmSync(emptyUserDir, { recursive: true, force: true });
});

const discoveryOpts = () => ({ workspaceRoot: workdir, userSkillsDir: emptyUserDir });

function writeSkill(slug: string, schema: object): void {
  const dir = path.join(workdir, ".claude/skills", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${slug}\ndescription: test fixture\n---\nbody\n`);
  writeFileSync(path.join(dir, "schema.json"), JSON.stringify(schema));
}

const FILE_SCHEMA = {
  title: "Notes",
  icon: "note",
  dataPath: "data/notes/items",
  primaryKey: "id",
  fields: {
    id: { type: "string", label: "ID", primary: true },
    title: { type: "string", label: "Title" },
    score: { type: "number", label: "Score" },
  },
};

const CSV_SCHEMA = {
  title: "Students",
  icon: "school",
  dataSource: { type: "csv", path: "data/students.csv" },
  primaryKey: "id",
  displayField: "title",
  fields: {
    id: { type: "string", label: "ID", primary: true },
    title: { type: "string", label: "Title" },
    score: { type: "number", label: "Score" },
  },
};

/** Both fixtures hold the same four logical records. The file store's
 *  documented order is lexicographic by id (written shuffled to prove the
 *  sort); the CSV store's is file row order (written in that same order so
 *  one expectation serves both). */
const EXPECTED_IDS = ["n1", "n2", "n3", "n4"];

async function fileStoreFixture(): Promise<CollectionStore> {
  writeSkill("notes", FILE_SCHEMA);
  const dataDir = path.join(workdir, "data/notes/items");
  mkdirSync(dataDir, { recursive: true });
  for (const recordId of ["n3", "n1", "n4", "n2"]) {
    writeFileSync(path.join(dataDir, `${recordId}.json`), JSON.stringify({ id: recordId, title: `T-${recordId}`, score: Number(recordId.slice(1)) }));
  }
  const [collection] = await discoverCollections(discoveryOpts());
  assert.ok(collection);
  return storeFor(collection, { workspaceRoot: workdir });
}

async function csvStoreFixture(): Promise<CollectionStore> {
  writeSkill("students", CSV_SCHEMA);
  const file = path.join(workdir, "data/students.csv");
  mkdirSync(path.dirname(file), { recursive: true });
  const rows = EXPECTED_IDS.map((recordId) => `${recordId},T-${recordId},${recordId.slice(1)}`);
  writeFileSync(file, `id,title,score\n${rows.join("\n")}\n`);
  const [collection] = await discoverCollections(discoveryOpts());
  assert.ok(collection);
  return storeFor(collection, { workspaceRoot: workdir });
}

const SQLITE_SCHEMA = {
  title: "Notes DB",
  icon: "database",
  storage: { type: "sqlite", path: "data/notes.db" },
  primaryKey: "id",
  fields: {
    id: { type: "string", label: "ID", primary: true },
    title: { type: "string", label: "Title" },
    score: { type: "number", label: "Score" },
  },
};

async function sqliteStoreFixture(): Promise<CollectionStore> {
  writeSkill("notesdb", SQLITE_SCHEMA);
  const [collection] = await discoverCollections(discoveryOpts());
  assert.ok(collection);
  const store = storeFor(collection, { workspaceRoot: workdir });
  assert.ok(store.write, "sqlite store must be writable");
  // Seed through the store's own write path, shuffled to prove ORDER BY id.
  for (const recordId of ["n3", "n1", "n4", "n2"]) {
    const written = await store.write(recordId, { id: recordId, title: `T-${recordId}`, score: Number(recordId.slice(1)) });
    assert.equal(written.kind, "ok");
  }
  return store;
}

const FIRESTORE_SCHEMA = {
  title: "Notes Cloud",
  icon: "cloud",
  storage: { type: "firestore" },
  primaryKey: "id",
  fields: {
    id: { type: "string", label: "ID", primary: true },
    title: { type: "string", label: "Title" },
    score: { type: "number", label: "Score" },
  },
};

const FAKE_UID = "test-uid";

/** In-memory stand-in for the Firestore SDK, satisfying the same
 *  `FirestoreDocs` seam the real implementation does. Insertion order is
 *  deliberately NOT the read order — `list` sorts by document id, so the
 *  fixture seeding shuffled proves the store's documented stable order the
 *  same way the sqlite fixture does.
 *
 *  Fidelity limits (why this can't fully replace a live check): it models
 *  document storage and create-atomicity, not Firestore's consistency
 *  model, security rules, or listener semantics. */
function makeFakeFirestoreDocs(): FirestoreDocs {
  const collections = new Map<string, Map<string, unknown>>();
  const bucket = (collectionPath: string): Map<string, unknown> => {
    const existing = collections.get(collectionPath);
    if (existing) return existing;
    const created = new Map<string, unknown>();
    collections.set(collectionPath, created);
    return created;
  };
  return {
    list: (collectionPath) => {
      const entries: FirestoreDoc[] = [...bucket(collectionPath).entries()].map(([docId, data]) => ({ id: docId, data }));
      entries.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
      return Promise.resolve(entries);
    },
    get: (collectionPath, docId) => Promise.resolve(bucket(collectionPath).has(docId) ? (bucket(collectionPath).get(docId) as unknown) : null),
    set: (collectionPath, docId, data) => {
      bucket(collectionPath).set(docId, data);
      return Promise.resolve();
    },
    create: (collectionPath, docId, data) => {
      if (bucket(collectionPath).has(docId)) return Promise.resolve(false);
      bucket(collectionPath).set(docId, data);
      return Promise.resolve(true);
    },
    delete: (collectionPath, docId) => Promise.resolve(bucket(collectionPath).delete(docId)),
  };
}

async function firestoreStoreFixture(): Promise<CollectionStore> {
  writeSkill("notescloud", FIRESTORE_SCHEMA);
  // One fake per fixture — the accessor is called per operation, so
  // building it inside the closure would hand out a fresh empty store
  // every time and silently lose every write.
  const docs = makeFakeFirestoreDocs();
  setFirestoreAccessor(() => ({ docs, uid: FAKE_UID }));
  const [collection] = await discoverCollections(discoveryOpts());
  assert.ok(collection);
  const store = storeFor(collection, { workspaceRoot: workdir });
  assert.ok(store.write, "firestore store must be writable");
  // Seed through the store's own write path, shuffled to prove id ordering.
  for (const recordId of ["n3", "n1", "n4", "n2"]) {
    const written = await store.write(recordId, { id: recordId, title: `T-${recordId}`, score: Number(recordId.slice(1)) });
    assert.equal(written.kind, "ok");
  }
  return store;
}

const FIXTURES: { name: string; make: () => Promise<CollectionStore>; writable: boolean; nativeQuery: boolean }[] = [
  { name: "file store", make: fileStoreFixture, writable: true, nativeQuery: false },
  { name: "csv store", make: csvStoreFixture, writable: false, nativeQuery: true },
  { name: "sqlite store", make: sqliteStoreFixture, writable: true, nativeQuery: false },
  { name: "firestore store", make: firestoreStoreFixture, writable: true, nativeQuery: false },
];

for (const fixture of FIXTURES) {
  describe(`store contract: ${fixture.name}`, () => {
    it("declares its capabilities, with query present iff nativeQuery", async () => {
      const store = await fixture.make();
      assert.equal(store.capabilities.writable, fixture.writable);
      assert.equal(store.capabilities.nativeQuery, fixture.nativeQuery);
      assert.equal(typeof store.capabilities.nativePaging, "boolean");
      assert.equal(store.query !== undefined, fixture.nativeQuery);
    });

    it("pages in a stable documented order, repeatable across calls", async () => {
      const store = await fixture.make();
      const first = await store.page();
      const second = await store.page();
      assert.deepEqual(
        first.items.map((item) => item.id),
        EXPECTED_IDS,
      );
      assert.deepEqual(first.items, second.items);
      assert.equal(first.total, EXPECTED_IDS.length);
      assert.equal(first.truncated, false);
    });

    it("honours offset/limit boundaries — mid-page, count-only, past-the-end", async () => {
      const store = await fixture.make();
      const mid = await store.page({ offset: 1, limit: 2 });
      assert.deepEqual(
        mid.items.map((item) => item.id),
        ["n2", "n3"],
      );
      assert.equal(mid.total, 4);
      const countOnly = await store.page({ limit: 0 });
      assert.deepEqual(countOnly.items, []);
      assert.equal(countOnly.total, 4);
      const past = await store.page({ offset: 10, limit: 5 });
      assert.deepEqual(past.items, []);
      assert.equal(past.total, 4);
    });

    it("projects `fields` and always keeps the primary key", async () => {
      const store = await fixture.make();
      const page = await store.page({ fields: ["title"] });
      for (const item of page.items) {
        assert.deepEqual(Object.keys(item).sort(), ["id", "title"]);
      }
    });

    it("read() round-trips every id page() returned", async () => {
      const store = await fixture.make();
      const page = await store.page();
      for (const item of page.items) {
        const record = await store.read(String(item.id));
        assert.ok(record, `read(${String(item.id)}) must resolve`);
        assert.equal(record.title, item.title);
      }
    });

    it("list() returns the same records page() serves (legacy full read)", async () => {
      const store = await fixture.make();
      const all = await store.list();
      const page = await store.page();
      assert.deepEqual(all.map((item) => item.id).sort(), page.items.map((item) => item.id).sort());
    });

    it("exposes write/delete iff writable — absence IS the read-only refusal", async () => {
      const store = await fixture.make();
      assert.equal(store.write !== undefined, fixture.writable);
      assert.equal(store.delete !== undefined, fixture.writable);
    });

    if (fixture.writable) {
      it("write() round-trips through read(), refuses create-overwrite, delete() removes", async () => {
        const store = await fixture.make();
        assert.ok(store.write && store.delete);
        const written = await store.write("n9", { id: "n9", title: "T-n9", score: 9 });
        assert.equal(written.kind, "ok");
        assert.equal((await store.read("n9"))?.title, "T-n9");
        assert.equal((await store.write("n9", { id: "n9", title: "again" }, { refuseOverwrite: true })).kind, "conflict");
        assert.equal((await store.delete("n9")).kind, "ok");
        assert.equal(await store.read("n9"), null);
        assert.equal((await store.delete("n9")).kind, "not-found");
      });
    }
  });
}

describe("storage schema gates (sqlite)", () => {
  it("accepts a storage schema: storageFile + phantom dataDir resolved, collection is writable", async () => {
    writeSkill("notesdb", SQLITE_SCHEMA);
    const [collection] = await discoverCollections(discoveryOpts());
    assert.ok(collection);
    assert.equal(collection.storageFile, path.resolve(workdir, "data/notes.db"));
    assert.equal(collection.dataDir, path.resolve(workdir, "data/collections/notesdb/items"));
    assert.equal(storeFor(collection, { workspaceRoot: workdir }).capabilities.writable, true);
  });

  it("rejects storage combined with dataPath or dataSource; ACCEPTS the full write machinery", async () => {
    writeSkill("both-path", { ...SQLITE_SCHEMA, dataPath: "data/x/items" });
    writeSkill("both-source", { ...SQLITE_SCHEMA, dataSource: { type: "csv", path: "data/x.csv" } });
    assert.equal((await discoverCollections(discoveryOpts())).length, 0);
    // spawn / completionField / triggerField are store-aware now — a
    // storage schema declaring them must parse (the old v1 refine is gone).
    const parsed = CollectionSchemaZ.safeParse({
      ...SQLITE_SCHEMA,
      fields: { ...SQLITE_SCHEMA.fields, dueOn: { type: "date", label: "Due" }, status: { type: "enum", label: "St", values: ["pending", "paid"] } },
      completionField: "status",
      completionDoneValues: ["paid"],
      triggerField: "dueOn",
      spawn: { when: { field: "status", in: ["paid"] }, every: { unit: "month", interval: 1, dayOfMonth: 10 } },
    });
    assert.equal(parsed.success, true, parsed.success ? "" : parsed.error.issues.map((issue) => issue.message).join(" | "));
  });

  it("rejects a storage.path escaping the workspace", async () => {
    writeSkill("escape", { ...SQLITE_SCHEMA, storage: { type: "sqlite", path: "../outside.db" } });
    assert.equal((await discoverCollections(discoveryOpts())).length, 0);
  });
});

describe("storage schema gates (firestore)", () => {
  it("accepts a firestore schema and resolves NO storageFile — records aren't on disk", async () => {
    writeSkill("notescloud", FIRESTORE_SCHEMA);
    const [collection] = await discoverCollections(discoveryOpts());
    assert.ok(collection);
    assert.equal(collection.storageFile, undefined);
    assert.equal(collection.dataDir, path.resolve(workdir, "data/collections/notescloud/items"));
    assert.equal(storeFor(collection, { workspaceRoot: workdir }).capabilities.writable, true);
  });

  it("rejects a firestore schema carrying a path — the location is host-derived, not schema-supplied", () => {
    const parsed = CollectionSchemaZ.safeParse({ ...FIRESTORE_SCHEMA, storage: { type: "firestore", path: "data/x.db" } });
    assert.equal(parsed.success, false);
  });

  it("keeps the sqlite variant parsing unchanged (discriminated-union regression)", () => {
    assert.equal(CollectionSchemaZ.safeParse(SQLITE_SCHEMA).success, true);
    assert.equal(CollectionSchemaZ.safeParse({ ...SQLITE_SCHEMA, storage: { type: "sqlite" } }).success, false, "sqlite still requires its path");
    assert.equal(CollectionSchemaZ.safeParse({ ...SQLITE_SCHEMA, storage: { type: "mongo", path: "x" } }).success, false, "unknown backend refused");
  });

  it("fails loudly when there is no session — never an empty result", async () => {
    writeSkill("notescloud", FIRESTORE_SCHEMA);
    setFirestoreAccessor(null); // no remote-host session
    const [collection] = await discoverCollections(discoveryOpts());
    assert.ok(collection);
    const store = storeFor(collection, { workspaceRoot: workdir });
    // The FACTORY must not throw: storeFor runs on screens that merely list
    // collections, and one disconnected backend can't break them.
    const { write, delete: removeItem } = store;
    assert.ok(write);
    assert.ok(removeItem);
    // Every operation must reject with something the user can act on. An
    // empty list here would read as "this collection has no records".
    await assert.rejects(() => store.list(), /connect remote-host/i);
    await assert.rejects(() => store.page(), /connect remote-host/i);
    await assert.rejects(() => store.read("n1"), /connect remote-host/i);
    await assert.rejects(() => write("n1", { id: "n1" }), /connect remote-host/i);
    await assert.rejects(() => removeItem("n1"), /connect remote-host/i);
  });
});

describe("page emulation helpers (pure)", () => {
  const items = [
    { id: "a", x: 1, y: "p" },
    { id: "b", x: 2, y: "q" },
  ];

  it("projectItemFields keeps the primary key and passes through with no fields", () => {
    assert.deepEqual(projectItemFields(items, ["x"], "id"), [
      { id: "a", x: 1 },
      { id: "b", x: 2 },
    ]);
    assert.deepEqual(projectItemFields(items, undefined, "id"), items);
  });

  it("pageFromFullRead clamps negative offset/limit and carries truncated through", () => {
    const page = pageFromFullRead(items, { offset: -5, limit: -1 }, "id", true);
    assert.deepEqual(page.items, []);
    assert.equal(page.total, 2);
    assert.equal(page.truncated, true);
    assert.deepEqual(pageFromFullRead(items, { offset: -5 }, "id", false).items, items);
  });
});
