// Discovery's second source: apps whose roster carries your address.
//
// The behaviour under test is not "a query runs". It is that a collection you
// were INVITED to shows up with the app it actually belongs to, that a
// collection on this disk still wins its own name, and that a host with no
// session — or a Firestore that answers with an error — is left with exactly
// the collections it had before rather than an empty screen.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { configureCollectionHost, setFirestoreAccessor } from "../../src/collection/server/host";
import type { FirestoreDoc, FirestoreDocs } from "../../src/collection/server/firestoreDocs";
import { discoverCollections, loadCollection } from "../../src/collection/server/discovery";
import { forgetSubscribedCollections } from "../../src/collection/server/subscribedCollections";

configureCollectionHost({
  workspaceRoot: null,
  log: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
  paths: {
    userSkillsDir: () => null,
    projectSkillsDir: (root) => path.join(root, ".claude", "skills"),
    feedsRoot: (root) => path.join(root, "data", "feeds"),
    skillsStagingDir: () => null,
    archiveDir: "data/archive",
    collectionsRegistriesConfig: (root) => path.join(root, "config", "collections-registries.json"),
  },
  isPresetSlug: () => false,
});

const MY_EMAIL = "member@school.jp";
const OTHER_APP = "app_teacher_class";
const MY_APP = "app_my_repo";

let workdir: string;
let emptyUserDir: string;

/** A plain, disk-backed collection — the thing a subscribed source must never
 *  displace or take down with it. */
const LOCAL_SCHEMA = {
  title: "Notes",
  icon: "note",
  dataPath: "data/notes",
  primaryKey: "id",
  fields: { id: { type: "string", label: "ID", primary: true } },
};

const SHARED_SCHEMA = {
  title: "Answers",
  icon: "quiz",
  storage: { type: "firestore" },
  primaryKey: "id",
  fields: { id: { type: "string", label: "ID", primary: true }, choice: { type: "string", label: "Choice" } },
};

/** Documents keyed by collection path, driven straight from the test. */
function fakeDocs(seed: Record<string, Record<string, unknown>>): FirestoreDocs {
  const listOf = (collectionPath: string): FirestoreDoc[] => Object.entries(seed[collectionPath] ?? {}).map(([docId, data]) => ({ id: docId, data }));
  return {
    // The live-update seam. Not exercised here — discovery asks who you are a
    // member of, it does not listen — but a fake satisfies the seam whole or
    // it stops standing in for the backend.
    watch: () => () => {},
    list: (collectionPath) => Promise.resolve(listOf(collectionPath)),
    listWhereArrayContains: (collectionPath, field, value) =>
      Promise.resolve(
        listOf(collectionPath).filter((entry) => {
          const field_ = (entry.data as Record<string, unknown>)[field];
          return Array.isArray(field_) && field_.includes(value);
        }),
      ),
    get: (collectionPath, docId) => Promise.resolve(seed[collectionPath]?.[docId] ?? null),
    set: () => Promise.resolve(),
    create: () => Promise.resolve(true),
    delete: () => Promise.resolve(true),
  };
}

/** A teacher's app, with me on its roster. */
const rosteredApp = (emails: string[]): Record<string, Record<string, unknown>> => ({
  [`apps`]: {
    [OTHER_APP]: { owner: "uid_teacher", members: {}, memberEmails: emails },
  },
  [`apps/${OTHER_APP}/collections`]: {
    answers: { publishedSchema: SHARED_SCHEMA, publishedAt: 1, publishedBy: "teacher@school.jp" },
  },
});

/** Add one more published-collection document to a seeded app. */
function withPublished(seed: Record<string, Record<string, unknown>>, cid: string, doc: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const collections = seed[`apps/${OTHER_APP}/collections`] ?? {};
  return { ...seed, [`apps/${OTHER_APP}/collections`]: { ...collections, [cid]: doc } };
}

function connect(seed: Record<string, Record<string, unknown>>): void {
  setFirestoreAccessor(() => ({ docs: fakeDocs(seed), email: MY_EMAIL, uid: "uid_me" }));
}

function writeSkill(slug: string, schema: object): void {
  const dir = path.join(workdir, ".claude/skills", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${slug}\ndescription: test fixture\n---\nbody\n`);
  writeFileSync(path.join(dir, "schema.json"), JSON.stringify(schema));
}

const opts = () => ({ workspaceRoot: workdir, userSkillsDir: emptyUserDir });

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "subscribed-"));
  emptyUserDir = mkdtempSync(path.join(tmpdir(), "subscribed-user-"));
});

afterEach(() => {
  // Both are module-level state: an accessor left wired resolves in a later
  // test that never set one up, and the memoised subscription list would carry
  // one case's apps into the next.
  setFirestoreAccessor(null);
  forgetSubscribedCollections();
  rmSync(workdir, { recursive: true, force: true });
  rmSync(emptyUserDir, { recursive: true, force: true });
});

test("a collection from an app I was invited to is discovered", async () => {
  connect(rosteredApp([MY_EMAIL]));
  const found = await discoverCollections(opts());
  assert.deepEqual(
    found.map((entry) => entry.slug),
    ["answers"],
  );
});

test("its appId comes from the SUBSCRIPTION, not from this repository's app.json", async () => {
  // The whole reason this source exists rather than a file the directory scan
  // could find. `acceptParsedSchema` resolves a firestore schema's aid from
  // the workspace's app.json, so a subscribed schema written to disk would be
  // served under whichever repository the server happens to be serving — the
  // records of somebody else's app, read and written under my app id.
  writeFileSync(path.join(workdir, "app.json"), JSON.stringify({ aid: MY_APP }));
  connect(rosteredApp([MY_EMAIL]));
  const [answers] = await discoverCollections(opts());
  assert.ok(answers);
  assert.equal(answers.appId, OTHER_APP);
  assert.notEqual(answers.appId, MY_APP);
  assert.equal(answers.source, "subscribed");
});

test("an app whose roster does NOT carry my address is invisible", async () => {
  // The paired case. Without it, a query that returned everything would pass
  // every assertion above.
  connect(rosteredApp(["someone-else@school.jp"]));
  assert.deepEqual(await discoverCollections(opts()), []);
});

test("a collection on this disk wins its own name", async () => {
  // A repository's own copy is the one its author is editing. Serving the
  // published projection instead would make local edits look ineffective —
  // the schema in the editor and the schema in use would differ with nothing
  // saying so.
  writeFileSync(path.join(workdir, "app.json"), JSON.stringify({ aid: MY_APP }));
  writeSkill("answers", { ...SHARED_SCHEMA, title: "My Local Answers" });
  connect(rosteredApp([MY_EMAIL]));

  const [answers] = await discoverCollections(opts());
  assert.ok(answers);
  assert.equal(answers.schema.title, "My Local Answers");
  assert.equal(answers.source, "project");
  assert.equal(answers.appId, MY_APP);
});

test("loadCollection finds a subscribed slug, and prefers the local one", async () => {
  connect(rosteredApp([MY_EMAIL]));
  const subscribed = await loadCollection("answers", opts());
  assert.equal(subscribed?.source, "subscribed");

  writeFileSync(path.join(workdir, "app.json"), JSON.stringify({ aid: MY_APP }));
  writeSkill("answers", { ...SHARED_SCHEMA, title: "My Local Answers" });
  const local = await loadCollection("answers", opts());
  assert.equal(local?.source, "project");
});

test("no session means the local collections, not an empty list", async () => {
  // Every caller of discoverCollections is a screen or a tool that has to keep
  // working without Firestore. This is deliberately a different judgement from
  // the STORE's, which refuses loudly — there someone is reading data, and
  // "no records" must stay distinguishable from "not connected".
  writeFileSync(path.join(workdir, "app.json"), JSON.stringify({ aid: MY_APP }));
  writeSkill("notes", LOCAL_SCHEMA);
  setFirestoreAccessor(null);

  const found = await discoverCollections(opts());
  assert.deepEqual(
    found.map((entry) => entry.slug),
    ["notes"],
  );
});

test("a failing query leaves the local collections alone", async () => {
  // A network blip must not empty the list someone is looking at. It leaves
  // them with what they had a moment ago.
  writeSkill("notes", LOCAL_SCHEMA);
  const failing: FirestoreDocs = {
    ...fakeDocs({}),
    listWhereArrayContains: () => Promise.reject(new Error("permission-denied")),
  };
  setFirestoreAccessor(() => ({ docs: failing, email: MY_EMAIL, uid: "uid_me" }));

  const found = await discoverCollections(opts());
  assert.deepEqual(
    found.map((entry) => entry.slug),
    ["notes"],
  );
});

test("a published document that is not a usable schema is skipped, not fatal", async () => {
  // A subscribed app is written by SOMEONE ELSE. One unusable document must
  // not take the rest of their app — or this workspace — down with it.
  const seed = withPublished(rosteredApp([MY_EMAIL]), "broken", { publishedSchema: { title: "no fields here" } });
  connect(seed);

  const found = await discoverCollections(opts());
  assert.deepEqual(
    found.map((entry) => entry.slug),
    ["answers"],
  );
});

test("a published schema that is not firestore-backed is skipped", async () => {
  // Publish only ever emits firestore schemas into an app, so this is a
  // hand-written document. Serving it would point the store at THIS machine's
  // disk for records that live in someone else's app.
  const seed = withPublished(rosteredApp([MY_EMAIL]), "local", {
    publishedSchema: { title: "Local", icon: "note", dataPath: "data/local", primaryKey: "id", fields: { id: { type: "string", label: "ID", primary: true } } },
  });
  connect(seed);

  const found = await discoverCollections(opts());
  assert.deepEqual(
    found.map((entry) => entry.slug),
    ["answers"],
  );
});

test("a subscribed collection has NO skill directory — null, not an empty string", async () => {
  // `""` does not fail closed. `path.join("", "views/x.html")` is a RELATIVE
  // path, so a custom view or an action template would be read from wherever
  // the server process happens to be running. null makes every consumer state
  // what it does instead — refuse, or contribute no base at all.
  connect(rosteredApp([MY_EMAIL]));
  const [answers] = await discoverCollections(opts());
  assert.ok(answers);
  assert.equal(answers.skillDir, null);
  assert.notEqual(answers.skillDir, "");
});

test("the memo is keyed by WORKSPACE ROOT as well as address", async () => {
  // A cached LoadedCollection carries a dataDir built from the root that
  // produced it, and MulmoTerminal serves N roots from ONE process. Keyed by
  // address alone, the second root would be handed the first root's paths —
  // green types, green tests, wrong workspace.
  connect(rosteredApp([MY_EMAIL]));
  const otherRoot = mkdtempSync(path.join(tmpdir(), "subscribed-other-"));
  try {
    const [here] = await discoverCollections(opts());
    const [there] = await discoverCollections({ workspaceRoot: otherRoot, userSkillsDir: emptyUserDir });
    assert.ok(here && there);
    assert.ok(here.dataDir.startsWith(workdir), "the first root's dataDir belongs to the first root");
    assert.ok(there.dataDir.startsWith(otherRoot), "and the second root's to the second — not a memoised copy of the first");
  } finally {
    rmSync(otherRoot, { recursive: true, force: true });
  }
});

test("the subscription list is memoised, and forgotten on demand", async () => {
  // Discovery runs several times per interaction; a round trip on each would
  // make every screen pay for a membership list that changes when somebody
  // edits a roster.
  let queries = 0;
  const counting: FirestoreDocs = {
    ...fakeDocs(rosteredApp([MY_EMAIL])),
    listWhereArrayContains: (collectionPath, field, value) => {
      queries += 1;
      return fakeDocs(rosteredApp([MY_EMAIL])).listWhereArrayContains(collectionPath, field, value);
    },
  };
  setFirestoreAccessor(() => ({ docs: counting, email: MY_EMAIL, uid: "uid_me" }));

  await discoverCollections(opts());
  await discoverCollections(opts());
  assert.equal(queries, 1, "the second discovery must reuse the first answer");

  forgetSubscribedCollections();
  await discoverCollections(opts());
  assert.equal(queries, 2, "and forgetting it must ask again");
});
