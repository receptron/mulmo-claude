// publish — the one dangerous operation in a shared app.
//
// Merging a pull request changes nobody's screen. Publishing changes
// everyone's, immediately, and in two ways at once: a breaking schema change
// leaves live records inconsistent with the schema that is now supposed to
// describe them, and — because a view is HTML — the right to publish is in
// practice the right to run JavaScript in every member's browser. So this
// module is deliberately not a convenience. It refuses more than it accepts,
// it reports what it is about to break before it breaks it, and it signs what
// it writes.
//
// The order of operations is load → CHECK → pre-validate live records →
// project → write, and each stage's failure is returned as text rather than
// thrown, because the caller is an agent tool whose whole contract is
// actionable prose.
//
// WRITE ORDER is not arbitrary. The app document authorizes the other two
// (`allow write: if role(app(aid), '*') == "owner"` reads the app document to
// decide), so it goes first. A publish that failed halfway leaves an app whose
// roster and configuration are new and whose published schemas are one publish
// behind — recoverable by publishing again, and strictly better than the
// reverse, where a schema the rules have not been told about is already live.
//
// NO CI. The design note defers automated publishing on purpose: a service
// account holding the owner role is a new kind of principal in the permission
// model, and the model is currently "the roster is people". Manual, signed
// with the commit, is where this starts.

import { isRecord } from "@mulmoclaude/common";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { CollectionSchema } from "../core/schema";
import { APP_MANIFEST_FILE } from "./appManifest";
import { discoverCollections, type DiscoveryOptions } from "./discovery";
import type { LoadedCollection } from "./discoveredCollection";
import { firestoreHandle, getWorkspaceRoot } from "./host";
import { parseAuthoredApp, type AuthoredApp } from "./publishManifest";
import { publishProblems } from "./publishChecks";
import { APPS_COLLECTION, PUBLIC_CONFIG_DOC, appConfigPath, appSchemasPath, projectApp, type PublishStamp, type PublishedApp } from "./publishProject";
import { MAX_RECORD_ISSUES, STORE_UNREADABLE, validateCollectionRecords } from "./validate";

const execFileAsync = promisify(execFile);

/** How many broken records to name before summarising. A publish that would
 *  break a thousand rows is answered by the count and a sample; dumping all of
 *  them buries the number, which is the part the decision turns on. */
const MAX_LISTED_ISSUES = 10;

export interface PublishOptions extends DiscoveryOptions {
  /** Proceed even though existing records fail the schemas about to be
   *  published. Never a default: the pre-check is the migration gate, and a
   *  gate that opens itself is a log line. */
  confirm?: boolean | undefined;
  /** Wall clock, injectable so a test can assert an exact document. */
  now?: (() => number) | undefined;
  /** Resolve the commit the declaration is being published from. Injectable
   *  for the same reason, and because a repository without git is a normal
   *  state rather than a failure. */
  resolveCommit?: ((root: string) => Promise<{ commit?: string | undefined; dirty?: boolean | undefined }>) | undefined;
}

export type PublishResult =
  | {
      ok: false;
      problems: string[];
      /** Did any document reach Firestore before this failed?
       *
       *  Almost every refusal happens before the first write, and saying so is
       *  most of the value of refusing. But a write that fails part-way is a
       *  DIFFERENT state — the roster and configuration are live while the
       *  schemas are one publish behind — and it is the state a caller most
       *  needs to hear about. Carried as a field rather than left for the
       *  caller to infer from prose, because a caller that guesses will guess
       *  "nothing was written": that is what every other failure means. */
      partial: boolean;
    }
  | {
      ok: true;
      aid: string;
      cids: string[];
      created: boolean;
      commit?: string | undefined;
      dirty: boolean;
      /** How many live records the pre-check found that the published schemas
       *  reject — and whether that number is a FLOOR.
       *
       *  `validateCollectionRecords` stops at its own cap per collection, so a
       *  full batch means "at least this many". The count and the cap travel
       *  together because they are read together: a caller that reports the
       *  number without the flag understates how much repair is owed, on the
       *  one path (a confirmed publish) where the damage is already done. */
      recordIssues: number;
      recordIssuesCapped: boolean;
      published: PublishedApp;
    };

/** `git rev-parse HEAD` plus a dirty check, or nothing.
 *
 *  A missing git, a repository with no commits and a non-repository are all
 *  the same answer here — no commit — because the stamp is attribution, not a
 *  requirement. What is NOT acceptable is a stamp that lies, which is why the
 *  dirty flag exists: publishing from a modified tree records a commit that
 *  does not describe what was published, and the flag is the only thing that
 *  would ever tell a reader so. */
async function gitStamp(root: string): Promise<{ commit?: string | undefined; dirty?: boolean | undefined }> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"]);
    const commit = stdout.trim();
    const { stdout: status } = await execFileAsync("git", ["-C", root, "status", "--porcelain"]);
    return { commit: commit.length > 0 ? commit : undefined, dirty: status.trim().length > 0 };
  } catch {
    return {};
  }
}

/** The shared collections of THIS REPOSITORY, by cid.
 *
 *  `userSkillsDir: null` — not a test convenience, a boundary. Discovery
 *  resolves every schema it finds against the WORKSPACE root, user-scope
 *  included, so a globally installed skill under `~/.claude/skills` carrying
 *  `storage.type: "firestore"` picks up whichever repository's `aid` it
 *  happens to be discovered from. Left in, publish would write that schema
 *  into this app — and into every other app the same user publishes, since the
 *  skill is installed once per machine and the repositories are not.
 *
 *  An app is a REPOSITORY (design D1): its collections are the ones committed
 *  beside its `app.json`, which is what makes a clone resolve the same
 *  collections and an invitation a matter of authorization rather than
 *  discovery. A schema that is not in the repository has no claim on a cid
 *  there. And because a view is HTML, publishing one is not a tidiness
 *  question: it is the machine's own skills reaching every member's browser.
 *
 *  The consequence is deliberate: a cid named in `app.json` that exists only
 *  in user scope is now an unknown cid, and publish says so by name instead of
 *  quietly publishing a schema from outside the repository. */
async function sharedCollections(opts: DiscoveryOptions, root: string): Promise<LoadedCollection[]> {
  const all = await discoverCollections({ ...opts, workspaceRoot: root, userSkillsDir: null });
  // `appId !== undefined` is NOT the test. Discovery's second source hands back
  // the collections of apps this address was INVITED to, and those carry an
  // appId too — somebody else's. Publishing one would write another app's
  // schema into THIS repository's app, under this repository's aid: the same
  // shape as the user-scope hole above, arriving through a different door.
  //
  // An app is a repository, and what it publishes is what is committed beside
  // its own `app.json`. So the test is where the collection CAME FROM.
  return all.filter((collection) => collection.appId !== undefined && collection.source !== "subscribed");
}

interface RecordScan {
  lines: string[];
  records: number;
  capped: boolean;
  /** Collections whose records could not be READ at all. Kept apart from
   *  `lines` because `confirm` may not override them. */
  unreadable: string[];
}

/** Existing records that would not satisfy the schema about to be published.
 *
 *  Read from FIRESTORE, not from disk: a shared collection's records live in
 *  the app, and the question this answers is "what does the live data look
 *  like under the new schema" — which is the migration question. Reported as
 *  a refusal the publisher can override, because a breaking change is
 *  sometimes exactly what is intended and the point is that it is a decision
 *  rather than a discovery. */
async function recordProblems(collections: LoadedCollection[], opts: DiscoveryOptions): Promise<RecordScan> {
  const lines: string[] = [];
  const unreadable: string[] = [];
  let records = 0;
  let cappedAnywhere = false;
  for (const collection of collections) {
    const issues = await validateCollectionRecords(collection, opts);
    if (issues.length === 0) continue;
    // "the backend could not be read" is not a broken record, and must not be
    // overridable the way a broken record is: `confirm` means "I know these
    // rows will not fit the new schema", and here nobody knows anything —
    // the migration gate did not run. Overriding it would publish blind.
    const unread = issues.filter((issue) => issue.file === STORE_UNREADABLE);
    if (unread.length > 0) {
      unreadable.push(`${collection.slug}: ${unread.map((issue) => issue.problem).join("; ")}`);
      continue;
    }
    records += issues.length;
    // `validateCollectionRecords` stops at its own cap (25 per collection), so
    // a full batch means "at least this many" and saying otherwise would read
    // as a complete count of the damage.
    const capped = issues.length >= MAX_RECORD_ISSUES;
    cappedAnywhere = cappedAnywhere || capped;
    const count = capped ? `at least ${issues.length}` : String(issues.length);
    const plural = issues.length === 1 ? "" : "s";
    const note = capped ? " (the scan stops there)" : "";
    lines.push(`${collection.slug}: ${count} existing record${plural} would not satisfy the schema about to be published${note}`);
    for (const issue of issues.slice(0, MAX_LISTED_ISSUES)) lines.push(`  - ${issue.file}: ${issue.problem}`);
    if (issues.length > MAX_LISTED_ISSUES) lines.push(`  - … and ${issues.length - MAX_LISTED_ISSUES} more`);
  }
  return { lines, records, capped: cappedAnywhere, unreadable };
}

function schemasOf(collections: LoadedCollection[]): { cid: string; schema: CollectionSchema }[] {
  return collections
    .map((collection) => ({ cid: collection.slug, schema: collection.schema }))
    .sort((left, right) => (left.cid < right.cid ? -1 : left.cid > right.cid ? 1 : 0));
}

/** Read and parse `<root>/app.json`'s full declaration. */
async function readAuthored(root: string): Promise<{ ok: true; app: AuthoredApp } | { ok: false; problems: string[] }> {
  let raw: string;
  try {
    raw = await readFile(path.join(root, APP_MANIFEST_FILE), "utf-8");
  } catch (err) {
    return { ok: false, problems: [`cannot read ${path.join(root, APP_MANIFEST_FILE)}: ${String(err)}`] };
  }
  return parseAuthoredApp(raw);
}

/** Everything wrong with the declaration itself, publisher included. */
function declarationProblems(app: AuthoredApp, collections: LoadedCollection[], handle: { uid: string; email: string }): string[] {
  const problems = publishProblems(
    app,
    collections.map((collection) => ({ cid: collection.slug, primaryKey: collection.schema.primaryKey })),
    handle.email,
  );
  if (app.owner !== undefined && app.owner !== handle.uid) {
    // Not fatal on its own — the rules pin `owner` to the EXISTING document on
    // update — but a declaration naming somebody else's uid is either the
    // sample's `<uid>` placeholder or a misunderstanding of what the key is.
    problems.push(
      `app.json declares owner "${app.owner}", which is not your uid (${handle.uid}). ` +
        "`owner` is stamped by publish and carried forward unchanged afterwards — remove it from app.json rather than maintaining it by hand.",
    );
  }
  return problems;
}

/** Put the three kinds of document, in the order the rules require, and turn a
 *  rejected write into the result type instead of letting it escape.
 *
 *  Returns null when everything was written; a failure result otherwise.
 *
 *  A raw rejection here would reach the agent as a tool crash rather than the
 *  actionable text this tool promises. But "actionable" is a strong claim for
 *  a half-finished publish, so the message ENUMERATES what landed rather than
 *  summarising it: the order is app → every schema → config, and a summary
 *  written for one failure point is wrong at the others. Saying "the roster
 *  and configuration are live" after a SCHEMA write failed names a config
 *  document this publish never wrote — which still holds whatever the last
 *  publish left, and is exactly the state the caller is trying to repair. */
async function writeDocuments(handle: NonNullable<ReturnType<typeof firestoreHandle>>, aid: string, published: PublishedApp): Promise<PublishResult | null> {
  const steps: { what: string; run: () => Promise<void> }[] = [
    { what: `the app document (apps/${aid})`, run: () => handle.docs.set(APPS_COLLECTION, aid, published.app) },
    ...published.schemas.map(({ cid, doc }) => ({ what: `the published schema for '${cid}'`, run: () => handle.docs.set(appSchemasPath(aid), cid, doc) })),
    {
      what: `the public config document (apps/${aid}/config/${PUBLIC_CONFIG_DOC})`,
      run: () => handle.docs.set(appConfigPath(aid), PUBLIC_CONFIG_DOC, published.config),
    },
  ];
  const landed: string[] = [];
  for (const [index, step] of steps.entries()) {
    try {
      await step.run();
      landed.push(step.what);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        // The whole reason the flag exists: this is the one failure where
        // documents ARE live.
        partial: index > 0,
        // The failed step belongs to "not written" — it is the first thing
        // that did not land, and leaving it out of the list left the sentence
        // empty when the LAST step failed.
        problems: [
          `publish failed while writing ${step.what}: ${reason}`,
          ...partialState(landed, [step.what, ...steps.slice(index + 1).map((rest) => rest.what)]),
        ],
      };
    }
  }
  return null;
}

/** What is live and what is not, listed rather than summarised.
 *
 *  Two facts, and both matter for the repair: a document this publish wrote is
 *  live NOW, and a document it did not write still holds what the LAST publish
 *  left — which is not the same as being absent, and not the same as matching
 *  the declaration that was just half-applied. */
function partialState(landed: readonly string[], notWritten: readonly string[]): string[] {
  const repair = "Publishing again is the repair: the write is idempotent, and it re-does every step, including the ones that did land.";
  if (landed.length === 0) return [`Nothing was written. ${repair}`];
  return [
    `Written by this publish, and live now: ${landed.join("; ")}.`,
    `NOT written: ${notWritten.join("; ")} — ${notWritten.length === 1 ? "it still holds" : "they still hold"} whatever the previous publish left.`,
    repair,
  ];
}

/** Publish this repository's declaration to its app.
 *
 *  Everything variable is a parameter or comes from the host binding, so the
 *  whole path is exercisable against an in-memory `FirestoreDocs` with no
 *  network and no API key — which is the only way the conversion table gets
 *  tested as a table. */
export async function publishApp(opts: PublishOptions = {}): Promise<PublishResult> {
  const root = opts.workspaceRoot ?? getWorkspaceRoot();
  const handle = firestoreHandle();
  if (!handle) {
    return {
      ok: false,
      partial: false,
      problems: [
        "publish needs a signed-in Firestore session: connect remote-host first. Publishing writes the app's roster and configuration as the app's owner, which is an authenticated write.",
      ],
    };
  }

  const authored = await readAuthored(root);
  if (!authored.ok) return { ...authored, partial: false };

  const collections = await sharedCollections(opts, root);
  const problems = declarationProblems(authored.app, collections, handle);
  if (problems.length > 0) return { ok: false, partial: false, problems };

  const issues = await recordProblems(collections, { ...opts, workspaceRoot: root });
  if (issues.unreadable.length > 0) {
    return {
      ok: false,
      partial: false,
      problems: [
        ...issues.unreadable,
        "publish stopped: the live records could not be read, so nothing checked whether the schemas about to be published still fit them. " +
          "This is not something `confirm` overrides — confirming means accepting a known breakage, and here there is no reading at all. Fix the access (or the connection) and publish again.",
      ],
    };
  }
  if (issues.records > 0 && opts.confirm !== true) {
    return {
      ok: false,
      partial: false,
      problems: [
        ...issues.lines,
        "publish stopped: these records are live and members are reading them. Migrate them first, or re-run with confirm to publish the schema anyway and repair the records afterwards.",
      ],
    };
  }

  return writePublished(authored.app, collections, handle, opts, root, issues);
}

/** The write half: stamp, project, and put the documents in the order the
 *  rules require. Split from the gate above so neither half hides the other —
 *  everything up to here can refuse, and nothing from here on does. */
async function writePublished(
  authored: AuthoredApp,
  collections: LoadedCollection[],
  handle: NonNullable<ReturnType<typeof firestoreHandle>>,
  opts: PublishOptions,
  root: string,
  issues: { records: number; capped: boolean },
): Promise<PublishResult> {
  const { aid } = authored;
  // The preflight read is a backend call like any other, and it decides two
  // things the rules care about: whether `owner` is stamped or carried
  // forward, and what `previousPublished` holds. A rejection here — permission,
  // network, quota — must become the documented result rather than escape as a
  // raw exception: `manageCollectionHandler` only translates
  // `BackendUnavailableError`, so anything else reaches the agent as a tool
  // crash. It happens before any write, which is the one thing the caller most
  // needs told.
  let existing: unknown;
  try {
    existing = await handle.docs.get(APPS_COLLECTION, aid);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      partial: false,
      problems: [
        `publish failed while reading the current app document (apps/${aid}): ${reason}`,
        "Nothing was written. Publishing again is safe — this read only decides whether the app is created or updated.",
      ],
    };
  }
  const stampSource = await (opts.resolveCommit ?? gitStamp)(root);
  const stamp: PublishStamp = {
    uid: handle.uid,
    email: handle.email,
    publishedAt: (opts.now ?? Date.now)(),
    commit: stampSource.commit,
  };
  // ONE normalization of "was there an app document?", used by the projection
  // and by the report. Two spellings of the same question (`isRecord` here,
  // `=== null` there) disagree the moment `get` resolves to anything that is
  // neither a record nor null: the projection stamps a fresh `owner` while the
  // reply says "Updated".
  const existingApp = isRecord(existing) ? existing : null;
  const published = projectApp(authored, schemasOf(collections), stamp, existingApp);
  if (stampSource.dirty === true) published.app.publishedDirty = true;

  const written = await writeDocuments(handle, aid, published);
  if (written !== null) return written;

  return {
    ok: true,
    aid,
    cids: published.schemas.map((entry) => entry.cid),
    created: existingApp === null,
    commit: stamp.commit,
    dirty: stampSource.dirty === true,
    recordIssues: issues.records,
    recordIssuesCapped: issues.capped,
    published,
  };
}
