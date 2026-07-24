// @mulmoclaude/core/collection/server — node-only collection engine.
//
// The host server imports from here (storage, validation, discovery, …);
// it is kept separate from the isomorphic `./collection` entry so the frontend
// bundle never pulls in node:fs. Configure the host binding once at startup:
//   import { configureCollectionHost } from "@mulmoclaude/core/collection/server";
//   configureCollectionHost({ workspaceRoot, log });

export {
  configureCollectionHost,
  getWorkspaceRoot,
  log,
  setCollectionChangePublisher,
  publishCollectionChange,
  type CollectionHost,
  type CollectionLogger,
  type CollectionChangePayload,
  firestoreHandle,
  setFirestoreAccessor,
  type FirestoreHandle,
} from "./host";
// NOTE: `createFirestoreDocs` is deliberately NOT re-exported here. It lives in
// a module that top-level imports `firebase/firestore`, and a re-export links
// eagerly — so exporting it would make the OPTIONAL `firebase` peer effectively
// required for every consumer of this entry, including hosts with no Firestore
// at all. It ships from the dedicated `@mulmoclaude/core/collection/firestore`
// subpath instead (same isolation `./remote-host/server` uses). The TYPES are
// safe here: they erase at build time.
export type { FirestoreDoc, FirestoreDocs } from "./firestoreDocs";
export { firestoreItemsPath } from "./firestoreStore";
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
