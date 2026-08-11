// The collections you can reach because someone put you on a roster.
//
// Discovery has always answered one question — "what is on this disk?" — and
// for a shared app that is the wrong question. A member of an app has never
// cloned its repository and may never; the invitation is an entry in
// `apps/{aid}.members`, and the schema is a document publish wrote. So this is
// discovery's SECOND source, and the two are unioned (design: implementation
// order 4).
//
// FIRESTORE IS THE SOURCE OF TRUTH HERE, and the disk is at most a display
// copy. That is not a preference, it is what keeps the read path from
// re-opening the hole publish just closed: `acceptParsedSchema` resolves a
// firestore schema's `aid` from the WORKSPACE's `app.json`, so any subscribed
// schema written into a skills directory would be re-discovered as if it
// belonged to whichever repository the server happens to be serving. A
// subscribed collection's `aid` comes from the SUBSCRIPTION and from nowhere
// else, which is only expressible by building the collection here rather than
// leaving a file for the directory scan to find.
//
// WHY `memberEmails` AND NOT `members`. Firestore cannot index the keys of a
// map, so "which apps am I in?" is unanswerable against the roster itself.
// That is the entire reason publish derives the denormalised array, and the
// reason the rules refuse a write where the two disagree — a stale
// `memberEmails` is not a cosmetic drift, it is a member who cannot find the
// app they were invited to.

import { isRecord } from "@mulmoclaude/common";
import type { CollectionSchema } from "../core/schema";
import { CollectionSchemaZ } from "../core/schemaZ";
import { resolveDataDir } from "./paths";
// `conventionalDataPath` lives with the acceptance gate that first needed it;
// importing it keeps one definition of "where a slug's data dir would be".
import { conventionalDataPath } from "./discovery";
import type { LoadedCollection } from "./discoveredCollection";
import { firestoreHandle, log, type FirestoreHandle } from "./host";
import { appSchemasPath, APPS_COLLECTION } from "./publishProject";

/** The field publish derives so this query is possible at all. */
const MEMBER_EMAILS = "memberEmails";

/** How long a resolved subscription list is reused.
 *
 *  `discoverCollections` is called from ontology, validation, routes and the
 *  agent tool — several times per interaction — and a Firestore round trip on
 *  each would make every one of those paths pay for a membership list that
 *  changes when somebody edits a roster, i.e. almost never. Short enough that
 *  an invitation shows up without a restart; long enough that a screen listing
 *  collections does not issue a query per widget. */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  email: string;
  /** The root the cached collections were RESOLVED AGAINST.
   *
   *  Part of the key, not decoration. A cached `LoadedCollection` carries a
   *  `dataDir` built from the workspace root that produced it, and
   *  MulmoTerminal serves N project roots from ONE process — so a cache keyed
   *  by address alone would hand the second root the first root's paths, with
   *  types and tests green and nothing to see. This is the same multi-root
   *  contract the engine's entry points are held to; a memo is just another
   *  place to break it. */
  workspaceRoot: string;
  at: number;
  collections: LoadedCollection[];
}

let cache: CacheEntry | null = null;

/** Drop the memoised subscription list.
 *
 *  Exported because two events invalidate it and neither is a clock: signing
 *  out (the next caller must not see the previous account's apps) and
 *  publishing (an app whose roster just changed). Tests call it between cases
 *  for the same reason they reset the accessor. */
export function forgetSubscribedCollections(): void {
  cache = null;
}

/** One published collection document → a collection the engine can serve.
 *
 *  Returns null rather than throwing, and says why in the log: a subscribed
 *  app is written by SOMEONE ELSE, so a document that fails validation is a
 *  normal state of the world, not a bug here. Refusing the one collection and
 *  keeping the rest is the behaviour that matches — the alternative is that a
 *  stranger's malformed publish empties your workspace. */
function toSubscribedCollection(aid: string, cid: string, data: unknown, workspaceRoot: string): LoadedCollection | null {
  if (!isRecord(data)) return null;
  const parsed = CollectionSchemaZ.safeParse(data.publishedSchema);
  if (!parsed.success) {
    log.warn("collections", "subscribed collection has an unusable published schema, skipping", { aid, cid, issues: parsed.error.issues });
    return null;
  }
  const schema: CollectionSchema = parsed.data;
  if (schema.storage?.type !== "firestore") {
    // Publish only ever emits firestore-backed schemas into an app, so this is
    // a document written by hand or by an older publisher. Serving it would
    // point the store at this machine's disk for records that live in the app.
    log.warn("collections", "subscribed collection does not declare firestore storage, skipping", { aid, cid });
    return null;
  }
  // The records live in Firestore, so this directory holds nothing — but the
  // engine's delete/archive paths need it to be well-defined and inside the
  // workspace, exactly as it is for a locally declared firestore collection.
  const dataDir = resolveDataDir(conventionalDataPath(cid), workspaceRoot);
  if (dataDir === null) return null;
  return {
    slug: cid,
    source: "subscribed",
    schema,
    dataDir,
    appId: aid,
    // No skill directory: nothing was cloned. Action templates and custom-view
    // files are read from one, and a subscribed collection has none until it is
    // materialised (implementation order 4, second half). NULL, not "" — an
    // empty base does not fail closed, it makes every path RELATIVE and so
    // reads from the server's working directory.
    skillDir: null,
  };
}

/** Every collection of every app whose roster carries this address. */
async function loadFor(handle: FirestoreHandle, workspaceRoot: string): Promise<LoadedCollection[]> {
  const apps = await handle.docs.listWhereArrayContains(APPS_COLLECTION, MEMBER_EMAILS, handle.email);
  const collections: LoadedCollection[] = [];
  for (const app of apps) {
    const schemas = await handle.docs.list(appSchemasPath(app.id));
    for (const schema of schemas) {
      const loaded = toSubscribedCollection(app.id, schema.id, schema.data, workspaceRoot);
      if (loaded) collections.push(loaded);
    }
  }
  return collections;
}

/** The subscribed source, memoised, and silent when there is nothing to ask.
 *
 *  Returns an empty list — never throws — when there is no session, because
 *  every caller of `discoverCollections` is a screen or a tool that must keep
 *  working without one. That is a different judgement from the STORE's, which
 *  refuses loudly: there, "no records" and "not connected" must stay
 *  distinguishable because someone is reading data. Here the question is which
 *  collections exist, and a host with no Firestore has exactly the ones on its
 *  disk.
 *
 *  A query failure is logged and treated the same way, for the same reason: a
 *  network blip must not empty the collection list a user is looking at — it
 *  must leave them with their local collections, which is what they had a
 *  moment ago. */
export async function subscribedCollections(workspaceRoot: string): Promise<LoadedCollection[]> {
  const handle = firestoreHandle();
  if (!handle) return [];
  const now = Date.now();
  if (cache && cache.email === handle.email && cache.workspaceRoot === workspaceRoot && now - cache.at < CACHE_TTL_MS) return cache.collections;
  try {
    const collections = await loadFor(handle, workspaceRoot);
    cache = { email: handle.email, workspaceRoot, at: now, collections };
    return collections;
  } catch (err) {
    log.warn("collections", "could not list subscribed apps, falling back to local collections only", { error: String(err) });
    return [];
  }
}
