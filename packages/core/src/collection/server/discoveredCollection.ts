import type { CollectionSchema, CollectionSource } from "../core/schema";

/** A collection discovered + loaded from disk: its schema plus the resolved
 *  on-disk locations. Produced by the host's discovery layer (which supplies
 *  the workspace scan) and consumed by the storage / validation engine.
 *
 *  The host's `discovery.ts` re-exports this type so its many existing
 *  importers keep resolving it from there. */
export interface LoadedCollection {
  slug: string;
  source: CollectionSource;
  schema: CollectionSchema;
  /** Absolute path to the resolved dataPath directory (inside the workspace).
   *  May not exist yet — the data folder is created on first write. For a
   *  `dataSource` collection this is the conventional per-slug dir
   *  (`data/collections/<slug>/items`) — records never live there (they're
   *  rows of `dataSourceFile`), but delete/archive paths stay well-defined. */
  dataDir: string;
  /** Absolute path to the external data file (schema `dataSource.path`,
   *  resolved with the same workspace containment as dataDir). Present iff
   *  the schema declares `dataSource` — i.e. iff the collection is
   *  read-only and its records come from the CSV store. */
  dataSourceFile?: string;
  /** Absolute path to the alternative-backend data file (schema
   *  `storage.path`, e.g. a SQLite database — same containment as dataDir).
   *  Present iff the schema declares `storage`. */
  storageFile?: string;
  /** The app id this collection's records belong to, from the repository's
   *  `app.json`. Present iff the schema declares `storage.type: "firestore"` —
   *  a shared collection's identity is `(appId, slug)`, and the store builds
   *  `apps/{appId}/collections/{slug}/items` from it.
   *
   *  Resolved by discovery, exactly like `storageFile`, so the identity is
   *  settled ONCE and the store never reads `app.json` on a read path. Absent
   *  is not a fallback: a firestore schema whose root declares no `aid` is
   *  REFUSED at discovery, so this is present whenever the backend needs it. */
  appId?: string;
  /** Absolute path to the skill directory this collection was loaded from
   *  (`<skillsRoot>/<slug>/`). Action templates are read from here, path-safely.
   *
   *  **null for a SUBSCRIBED collection**: nothing was cloned, so there is no
   *  directory. It is null rather than `""` because an empty string does not
   *  fail closed — `path.join("", "views/x.html")` is a RELATIVE path, which
   *  resolves against the server's working directory, so a template or a
   *  custom view would be read from wherever the process happens to be
   *  running. Making it null moves that from an accident to a decision each
   *  consumer states: a subscribed collection's schema cannot be edited here
   *  (it belongs to another app's repository), and it has no view files until
   *  it is materialised. */
  skillDir: string | null;
}
