// @mulmoclaude/core/collection/server — node-only collection engine.
//
// The host server imports from here (storage, validation, discovery, …);
// it is kept separate from the isomorphic `./collection` entry so the frontend
// bundle never pulls in node:fs. Configure the host binding once at startup:
//   import { configureCollectionHost } from "@mulmoclaude/core/collection/server";
//   configureCollectionHost({ workspaceRoot, log });
//
// ── The multi-root contract (read before adding an entry point) ────────────
//
// The engine is root-PARAMETERIZED, not root-bound. Every exported entry point
// that touches the filesystem MUST accept a root override — `opts.workspaceRoot`
// for the options-object calls, an explicit parameter otherwise — and resolve it
// as `opts.workspaceRoot ?? getWorkspaceRoot()`. The host binding is a DEFAULT,
// never the source of truth.
//
// This is load-bearing, not style. MulmoClaude has one workspace, so a call that
// reads the ambient root directly looks correct there forever. MulmoTerminal
// serves N project roots off the same process: there the same call does not
// crash — it reads or writes the WRONG project's data, silently, with types and
// tests green. A host that wants that failure to be loud binds
// `workspaceRoot: null` (explicit-root mode), after which `getWorkspaceRoot()`
// throws instead of guessing.
//
// Two consequences worth stating:
//   - Anything derived from the root (a dataDir, a containment check, a change
//     payload's `root`) must come from the SAME root the call was given. Never
//     reconstruct a root from an absolute path by string surgery.
//   - No helper may close over the ambient root on a caller's behalf. That is
//     why `isContainedInWorkspace()` was deleted rather than kept — see the
//     note in `paths.ts`.
//
// `test/collection/test_multiRoot.ts` pins this: it drives a representative set
// of entry points against a tmpdir root under a null-root host and asserts the
// configured workspace is never touched. A new entry point that reads the
// ambient root fails it.

export {
  configureCollectionHost,
  canonicalRoot,
  getWorkspaceRoot,
  peekWorkspaceRoot,
  COLLECTION_ROOT_REQUIRED,
  log,
  setCollectionChangePublisher,
  publishCollectionChange,
  collectionChangePayload,
  sharedCollectionChangePayload,
  collectionChangeKey,
  localCollectionKey,
  type CollectionHost,
  type CollectionLogger,
  type CollectionChangePayload,
  firestoreHandle,
  setFirestoreAccessor,
  type FirestoreHandle,
  type LocalCollectionChange,
  type SharedCollectionChange,
} from "./host";
// NOTE: `createFirestoreDocs` is deliberately NOT re-exported here. It lives in
// a module that top-level imports `firebase/firestore`, and a re-export links
// eagerly — so exporting it would make the OPTIONAL `firebase` peer effectively
// required for every consumer of this entry, including hosts with no Firestore
// at all. It ships from the dedicated `@mulmoclaude/core/collection/firestore`
// subpath instead. The TYPES are safe here: they erase at build time.
export type { FirestoreDoc, FirestoreDocs } from "./firestoreDocs";
export { sharedItemsPath } from "./firestoreStore";
export { loadAppManifest, parseAppManifest, appManifestReason, APP_MANIFEST_FILE, type AppManifest, type AppManifestResult } from "./appManifest";
// publish (git -> Firestore). `publishManifest` reads the parts of `app.json`
// that `appManifest` deliberately does not; `publishProject` is the whole
// authored -> published conversion; `publishChecks` is what publish refuses.
export {
  AuthoredAppZ,
  parseAuthoredApp,
  APP_ROLES,
  type AuthoredApp,
  type AuthoredCollectionConfig,
  type AuthoredMail,
  type AuthoredSubmit,
} from "./publishManifest";
export {
  projectApp,
  APPS_COLLECTION,
  PUBLIC_CONFIG_DOC,
  appConfigPath,
  appSchemasPath,
  type PublishStamp,
  type PublishedApp,
  type PublishedConfigDoc,
  type PublishedSchemaDoc,
} from "./publishProject";
export { publishProblems, bindsSubmitterIdentity, type PublishableCollection } from "./publishChecks";
export { publishApp, type PublishOptions, type PublishResult } from "./publish";
export { subscribedCollections, forgetSubscribedCollections } from "./subscribedCollections";
export type { LoadedCollection } from "./discoveredCollection";
export * from "./paths";
export * from "./templatePath";
export * from "./io";
export * from "./skillAssets";
export * from "./store";
export { BackendUnavailableError, isBackendUnavailable } from "./backendAvailability";
export { MAX_CSV_ROWS, encodeCsvRecordId, decodeCsvRecordId, normalizeCsvValue, csvRowToItem, dedupeByRecordId } from "./csvStore";
export { compileCsvQuery, compileJsonlQuery } from "./csvQuery";
export { runQueryOverRows } from "./jsonlQuery";
export { runCollectionQuery } from "./queryRunner";
export { CollectionQueryZ, MAX_QUERY_ROWS, DEFAULT_QUERY_ROWS } from "../core/queryZ";
export type { CollectionQuery, CollectionQueryAggregate, CollectionQueryOrder, CollectionQueryWhere } from "../core/queryZ";
export * from "./validate";
export * from "./mutate";
export * from "./discovery";
export * from "./ontology";
export * from "./derive";
export * from "./dynamicIcon";
export * from "./spawn";
export * from "./delete";
export * from "./views";
export * from "./manageTool";
