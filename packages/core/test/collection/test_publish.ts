// publish, end to end, against an in-memory Firestore.
//
// No API key, no network, no emulator: the `FirestoreDocs` seam takes the same
// in-memory stand-in the store contract uses, so the whole path — read
// app.json, refuse, pre-validate the LIVE records, write three kinds of
// document in the order the rules require — is exercisable here.
//
// What this file cannot tell you is whether the rules ACCEPT what publish
// wrote. Nothing that reads the rules can: implementation order 2 put four
// rounds of static review through rules that then failed to execute at all.
// That is `../mulmoserver test/rules/rules_publish.ts`, which feeds these
// exact documents to the real rules under the emulator.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { configureCollectionHost, setFirestoreAccessor } from "../../src/collection/server/host";
import type { FirestoreDoc, FirestoreDocs } from "../../src/collection/server/firestoreDocs";
import { publishApp } from "../../src/collection/server/publish";
import { sharedItemsPath } from "../../src/collection/server/firestoreStore";
import { sharedCollectionKey } from "../../src/collection/core/collectionKey";

// Explicit-root mode (`workspaceRoot: null`): every call here passes its own
// root, and a call that read an ambient one would throw rather than quietly
// reach into a real workspace. That is the multi-root contract MulmoTerminal
// depends on — one process, N project roots.
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

const AID = "app_salon_7f3a";
const OWNER_EMAIL = "owner@salon.jp";
const OWNER_UID = "uid_owner";

let workdir: string;
let emptyUserDir: string;
let docs: FirestoreDocs;

/** The same in-memory stand-in the store-contract suite uses: document
 *  storage and create-atomicity, not consistency, listeners or rules. */
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
    listWhereArrayContains: (collectionPath, field, value) =>
      Promise.resolve(
        [...bucket(collectionPath).entries()]
          .filter(
            ([, data]) => Array.isArray((data as Record<string, unknown>)[field]) && ((data as Record<string, unknown>)[field] as unknown[]).includes(value),
          )
          .map(([docId, data]) => ({ id: docId, data })),
      ),
    // The live-update seam. Publish never listens — it writes three documents
    // and reports — but a fake has to satisfy the seam whole or it stops
    // standing in for the backend.
    watch: () => () => {},
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

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "publish-"));
  emptyUserDir = mkdtempSync(path.join(tmpdir(), "publish-user-"));
  docs = makeFakeFirestoreDocs();
  setFirestoreAccessor(() => ({ docs, email: OWNER_EMAIL, uid: OWNER_UID }));
});

afterEach(() => {
  // Module-level state: a fixture's fake left wired would resolve in a later
  // test that never set one up.
  setFirestoreAccessor(null);
  rmSync(workdir, { recursive: true, force: true });
  rmSync(emptyUserDir, { recursive: true, force: true });
});

const BOOKINGS_SCHEMA = {
  title: "Bookings",
  icon: "event",
  storage: { type: "firestore" },
  primaryKey: "id",
  fields: {
    id: { type: "string", label: "ID", primary: true },
    customerEmail: { type: "email", label: "Email" },
    // `enum`, not `status`: the design note's vocabulary table lists a
    // `status` field type and `schemaZ`'s discriminated union has no such
    // member. A schema declaring one is not an error anywhere — discovery
    // simply skips the collection, and publish then reports the cid as
    // unknown.
    status: { type: "enum", label: "Status", values: ["pending", "approved", "cancelled"] },
  },
};

function writeSkill(slug: string, schema: object): void {
  const dir = path.join(workdir, ".claude/skills", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${slug}\ndescription: test fixture\n---\nbody\n`);
  writeFileSync(path.join(dir, "schema.json"), JSON.stringify(schema));
}

/** An `app.json` that passes every check, so a test can break exactly one
 *  thing and know which check answered. */
function writeApp(overrides: Record<string, unknown> = {}): void {
  writeFileSync(
    path.join(workdir, "app.json"),
    JSON.stringify({
      aid: AID,
      name: "Sakura Hair",
      members: { [OWNER_EMAIL]: { "*": "owner" } },
      collections: { bookings: { statusField: "status", transitions: { initial: ["pending"], pending: ["approved", "cancelled"] } } },
      public: {
        enabled: true,
        read: ["bookings"],
        submit: {
          bookings: {
            auth: "verifiedEmail",
            // `id` is the schema's primaryKey, and a submission may carry only
            // the createFields — without it, every submitted row would be
            // stored with no primary key and rejected by every reader.
            createFields: ["id", "customerEmail", "status"],
            initialStatus: "pending",
            window: { until: "2026-12-31T23:59:59Z" },
          },
        },
      },
      ...overrides,
    }),
  );
}

/** Deterministic stamps, so an assertion can be about the document rather
 *  than about "something that looks like a timestamp". */
const opts = (extra: Record<string, unknown> = {}) => ({
  workspaceRoot: workdir,
  userSkillsDir: emptyUserDir,
  now: () => 1_760_000_000_000,
  resolveCommit: () => Promise.resolve({ commit: "abc123def456", dirty: false }),
  ...extra,
});

test("publish writes the app, each collection's schema, and the public config", async () => {
  writeSkill("bookings", BOOKINGS_SCHEMA);
  writeApp();

  const result = await publishApp(opts());
  assert.equal(result.ok, true, result.ok ? "" : result.problems.join("\n"));
  assert.equal(result.ok && result.created, true);

  const app = (await docs.get("apps", AID)) as Record<string, unknown>;
  assert.equal(app.owner, OWNER_UID);
  assert.deepEqual(app.memberEmails, [OWNER_EMAIL]);
  assert.equal(app.publishedBy, OWNER_EMAIL);
  assert.equal(app.publishedCommit, "abc123def456");
  assert.equal("publishedDirty" in app, false);

  const schema = (await docs.get(`apps/${AID}/collections`, "bookings")) as Record<string, unknown>;
  assert.equal((schema.publishedSchema as Record<string, unknown>).title, "Bookings");

  const config = (await docs.get(`apps/${AID}/config`, "public")) as Record<string, unknown>;
  assert.equal(config.enabled, true);
  assert.equal("members" in config, false);
});

test("the app document goes out before the documents it authorizes", async () => {
  // `allow write` on `collections/{cid}` and `config/{docId}` both resolve the
  // role from the APP document, so a publish that wrote a schema first would
  // be refused by the real rules on a first publish.
  writeSkill("bookings", BOOKINGS_SCHEMA);
  writeApp();
  const order: string[] = [];
  const recording: FirestoreDocs = { ...docs, set: (collectionPath, docId, data) => (order.push(collectionPath), docs.set(collectionPath, docId, data)) };
  setFirestoreAccessor(() => ({ docs: recording, email: OWNER_EMAIL, uid: OWNER_UID }));

  await publishApp(opts());
  assert.deepEqual(order, ["apps", `apps/${AID}/collections`, `apps/${AID}/config`]);
});

test("a refused declaration writes NOTHING", async () => {
  // The refusal has to be a gate, not a warning: a partial publish leaves the
  // rules enforcing one declaration while members read another.
  writeSkill("bookings", BOOKINGS_SCHEMA);
  writeApp({
    public: { submit: { bookings: { auth: "verifiedEmail", createFields: ["id", "customerEmail"], idFrom: "auth.uid" } } },
  });

  const result = await publishApp(opts());
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.problems.some((problem) => problem.includes("submitOnly must be true")));
  assert.equal(!result.ok && result.partial, false);
  assert.equal(await docs.get("apps", AID), null);
});

test("publish stops on live records the new schema would break, and confirm proceeds", async () => {
  // The pre-check reads the LIVE records — the ones members are looking at —
  // through the same store the app uses, which is what makes publish the
  // migration gate rather than a schema upload.
  writeSkill("bookings", BOOKINGS_SCHEMA);
  writeApp();
  const items = sharedItemsPath(sharedCollectionKey(AID, "bookings"));
  await docs.set(items, "b1", { id: "b1", status: "nonsense" });

  const stopped = await publishApp(opts());
  assert.equal(stopped.ok, false);
  assert.ok(!stopped.ok && stopped.problems.some((problem) => problem.includes("b1")));
  assert.equal(await docs.get("apps", AID), null, "nothing may be written while the gate is closed");

  const forced = await publishApp(opts({ confirm: true }));
  assert.equal(forced.ok, true, forced.ok ? "" : forced.problems.join("\n"));
  assert.equal(forced.ok && forced.recordIssues, 1);
});

test("a capped record scan reports a FLOOR, on the confirmed path as well as the refusal", async () => {
  // `validateCollectionRecords` stops at 25 per collection. Reporting that as
  // an exact total understates the repair owed — and it understates it on the
  // path where the records have already been published over, which is the one
  // place the number is acted on rather than reconsidered.
  writeSkill("bookings", BOOKINGS_SCHEMA);
  writeApp();
  const items = sharedItemsPath(sharedCollectionKey(AID, "bookings"));
  for (let index = 0; index < 30; index += 1) {
    await docs.set(items, `b${index}`, { id: `b${index}`, status: "nonsense" });
  }

  const stopped = await publishApp(opts());
  assert.equal(stopped.ok, false);
  assert.ok(!stopped.ok && stopped.problems.some((problem) => problem.includes("at least 25")));

  const forced = await publishApp(opts({ confirm: true }));
  assert.equal(forced.ok, true, forced.ok ? "" : forced.problems.join("\n"));
  assert.equal(forced.ok && forced.recordIssues, 25);
  assert.equal(forced.ok && forced.recordIssuesCapped, true, "a full batch is a floor, and the caller has to be able to tell");
});

test("an uncapped record scan is reported as the exact count it is", async () => {
  // The paired case: without it, `recordIssuesCapped: true` always would pass
  // the assertion above and turn every count into a hedge.
  writeSkill("bookings", BOOKINGS_SCHEMA);
  writeApp();
  const items = sharedItemsPath(sharedCollectionKey(AID, "bookings"));
  await docs.set(items, "b1", { id: "b1", status: "nonsense" });

  const forced = await publishApp(opts({ confirm: true }));
  assert.equal(forced.ok && forced.recordIssues, 1);
  assert.equal(forced.ok && forced.recordIssuesCapped, false);
});

test("republishing keeps the previous document and changes nothing else", async () => {
  writeSkill("bookings", BOOKINGS_SCHEMA);
  writeApp();
  await publishApp(opts());
  const first = (await docs.get("apps", AID)) as Record<string, unknown>;

  const second = await publishApp(opts({ now: () => 1_760_000_009_999 }));
  assert.equal(second.ok, true);
  assert.equal(second.ok && second.created, false, "the second publish is an update");

  const app = (await docs.get("apps", AID)) as Record<string, unknown>;
  assert.equal((app.previousPublished as Record<string, unknown>).publishedAt, first.publishedAt);
  assert.equal(app.owner, OWNER_UID);
  const { publishedAt: __secondAt, previousPublished: __secondPrev, ...rest } = app;
  const { publishedAt: __firstAt, previousPublished: __firstPrev, ...firstRest } = first;
  assert.deepEqual(rest, firstRest);
});

test("a dirty working tree is recorded, because the commit no longer describes the publish", async () => {
  writeSkill("bookings", BOOKINGS_SCHEMA);
  writeApp();
  const result = await publishApp(opts({ resolveCommit: () => Promise.resolve({ commit: "abc123def456", dirty: true }) }));
  assert.equal(result.ok, true);
  const app = (await docs.get("apps", AID)) as Record<string, unknown>;
  assert.equal(app.publishedDirty, true);
});

test("an unreadable backend stops publish, and confirm does NOT override it", async () => {
  // `confirm` means "I know these rows will not fit the new schema". Here
  // nobody knows anything — the records were never read, so the migration gate
  // did not run. Letting confirm through would publish blind, which is the one
  // thing the gate exists to prevent.
  writeSkill("bookings", BOOKINGS_SCHEMA);
  writeApp();
  const denied = Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
  const unreadable: FirestoreDocs = { ...docs, list: () => Promise.reject(denied) };
  setFirestoreAccessor(() => ({ docs: unreadable, email: OWNER_EMAIL, uid: OWNER_UID }));

  for (const confirm of [false, true]) {
    const result = await publishApp(opts({ confirm }));
    assert.equal(result.ok, false, `confirm: ${confirm} must not publish`);
    assert.ok(!result.ok && result.problems.some((problem) => problem.includes("could not be read")));
    assert.ok(!result.ok && result.problems.some((problem) => problem.includes("not something `confirm` overrides")));
  }
  assert.equal(await docs.get("apps", AID), null);
});

test("a failed write becomes a result naming the step, not a thrown call", async () => {
  // The tool's whole contract is actionable text. A raw rejection reaches the
  // agent as a crash — and does so having possibly written the app document,
  // which is exactly the fact the caller needs to hear.
  writeSkill("bookings", BOOKINGS_SCHEMA);
  writeApp();
  const failOnSchemas: FirestoreDocs = {
    ...docs,
    set: (collectionPath, docId, data) =>
      collectionPath === `apps/${AID}/collections` ? Promise.reject(new Error("network is unreachable")) : docs.set(collectionPath, docId, data),
  };
  setFirestoreAccessor(() => ({ docs: failOnSchemas, email: OWNER_EMAIL, uid: OWNER_UID }));

  const result = await publishApp(opts());
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.problems[0]?.includes("the published schema for 'bookings'"));
  // The flag the caller words its headline from. Inferring it from the prose
  // is what produced "nothing was written" over a live roster.
  assert.equal(!result.ok && result.partial, true);

  const said = !result.ok ? result.problems.join("\n") : "";
  // What landed is ENUMERATED, not summarised. The order is app → schemas →
  // config, so a summary written for one failure point is wrong at the others:
  // saying "the roster and configuration are live" here would name a config
  // document this publish never wrote.
  assert.match(said, /Written by this publish, and live now: the app document/);
  assert.match(said, /NOT written:.*public config document/s);
  assert.doesNotMatch(said, /configuration are already live/);
  // …and the enumeration is true on both sides.
  assert.notEqual(await docs.get("apps", AID), null);
  assert.equal(await docs.get(`apps/${AID}/config`, "public"), null);
});

test("a config-write failure names the schemas that DID land", async () => {
  // The other end of the same order. Here the app document and every schema
  // are live and only the public config is missing — the opposite of the case
  // above, and a message that summarised would be wrong at one of the two.
  writeSkill("bookings", BOOKINGS_SCHEMA);
  writeApp();
  const failOnConfig: FirestoreDocs = {
    ...docs,
    set: (collectionPath, docId, data) =>
      collectionPath === `apps/${AID}/config` ? Promise.reject(new Error("quota exceeded")) : docs.set(collectionPath, docId, data),
  };
  setFirestoreAccessor(() => ({ docs: failOnConfig, email: OWNER_EMAIL, uid: OWNER_UID }));

  const result = await publishApp(opts());
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.partial, true);
  const said = !result.ok ? result.problems.join("\n") : "";
  assert.match(said, /Written by this publish, and live now:.*the published schema for 'bookings'/s);
  assert.match(said, /NOT written: the public config document/);
  assert.notEqual(await docs.get(`apps/${AID}/collections`, "bookings"), null);
});

test("a rejecting preflight read becomes a result too, and says nothing was written", async () => {
  // The read that decides create-vs-update is a backend call like any other.
  // Left unguarded it escaped as a raw exception while the neighbouring read
  // and write paths both returned actionable results — and it happens before
  // any write, so the answer is unambiguous.
  writeSkill("bookings", BOOKINGS_SCHEMA);
  writeApp();
  const failOnGet: FirestoreDocs = {
    ...docs,
    get: (collectionPath, docId) => (collectionPath === "apps" ? Promise.reject(new Error("quota exceeded")) : docs.get(collectionPath, docId)),
  };
  setFirestoreAccessor(() => ({ docs: failOnGet, email: OWNER_EMAIL, uid: OWNER_UID }));

  const result = await publishApp(opts());
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.problems[0]?.includes(`reading the current app document (apps/${AID})`));
  assert.ok(!result.ok && result.problems.some((problem) => problem.includes("Nothing was written.")));
  assert.equal(await docs.get("apps", AID), null);
});

test("a first-step failure says nothing was written, because nothing was", async () => {
  // The paired case. "Everything before it was written" on the FIRST step
  // would send the user looking for a half-published app that does not exist.
  writeSkill("bookings", BOOKINGS_SCHEMA);
  writeApp();
  const failOnApp: FirestoreDocs = {
    ...docs,
    set: (collectionPath, docId, data) => (collectionPath === "apps" ? Promise.reject(new Error("permission denied")) : docs.set(collectionPath, docId, data)),
  };
  setFirestoreAccessor(() => ({ docs: failOnApp, email: OWNER_EMAIL, uid: OWNER_UID }));

  const result = await publishApp(opts());
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.problems.some((problem) => problem.includes("Nothing was written.")));
  assert.equal(!result.ok && result.partial, false, "a first-step failure wrote nothing, and must not claim otherwise");
});

test("a user-scope skill is NOT published into this repository's app", async () => {
  // `~/.claude/skills` is installed once per machine; a repository is not. And
  // discovery resolves every schema it finds — user scope included — against
  // the WORKSPACE root, so a globally installed firestore skill would pick up
  // whichever repository's aid it was discovered from and be written into that
  // app, and into every other app the same user publishes.
  //
  // A view is HTML, so this is not a tidiness question: it is the machine's
  // own skills reaching every member's browser.
  const userSkillDir = path.join(emptyUserDir, "globalnotes");
  mkdirSync(userSkillDir, { recursive: true });
  writeFileSync(path.join(userSkillDir, "SKILL.md"), "---\nname: globalnotes\ndescription: installed once per machine\n---\nbody\n");
  writeFileSync(path.join(userSkillDir, "schema.json"), JSON.stringify({ ...BOOKINGS_SCHEMA, title: "Global Notes" }));
  writeSkill("bookings", BOOKINGS_SCHEMA);
  writeApp();

  const result = await publishApp(opts());
  assert.equal(result.ok, true, result.ok ? "" : result.problems.join("\n"));
  assert.deepEqual(result.ok && result.cids, ["bookings"], "only the repository's own collections may be published");
  assert.equal(await docs.get(`apps/${AID}/collections`, "globalnotes"), null);
});

test("naming a user-scope-only collection in app.json is refused, not silently published", async () => {
  // The paired case, and the reason the boundary is safe to draw: a cid that
  // exists only outside the repository becomes an unknown cid — said by name —
  // rather than a schema from off the repository going live.
  const userSkillDir = path.join(emptyUserDir, "globalnotes");
  mkdirSync(userSkillDir, { recursive: true });
  writeFileSync(path.join(userSkillDir, "SKILL.md"), "---\nname: globalnotes\ndescription: installed once per machine\n---\nbody\n");
  writeFileSync(path.join(userSkillDir, "schema.json"), JSON.stringify({ ...BOOKINGS_SCHEMA, title: "Global Notes" }));
  writeSkill("bookings", BOOKINGS_SCHEMA);
  writeApp({ participantRead: ["globalnotes"] });

  const result = await publishApp(opts());
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.problems.some((problem) => problem.includes("participantRead names 'globalnotes'")));
});

test("publish without a session refuses instead of failing document by document", async () => {
  writeSkill("bookings", BOOKINGS_SCHEMA);
  writeApp();
  setFirestoreAccessor(() => null);
  const result = await publishApp(opts());
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.problems.some((problem) => problem.includes("connect remote-host first")));
});

test("an app.json declaring someone else's owner uid is refused, not quietly ignored", async () => {
  // The sample in the design note carries `"owner": "<uid>"`. Publishing over
  // it silently would leave the author believing the key does something.
  writeSkill("bookings", BOOKINGS_SCHEMA);
  writeApp({ owner: "<uid>" });
  const result = await publishApp(opts());
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.problems.some((problem) => problem.includes("remove it from app.json")));
});
