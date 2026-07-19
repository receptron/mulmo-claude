// @mulmoclaude/core/collection — isomorphic collection engine.
//
// Pure, framework-free logic shared by the host server (validation /
// derive / notifications) and the host frontend (rendering). Lives in
// @mulmoclaude/core so MulmoClaude and MulmoTerminal share one implementation;
// the Vue surfaces live in @mulmoclaude/collection-plugin/vue.

export * from "./core/schema";
// Type-only: queryZ carries zod, which stays OUT of the browser bundle
// (same rule as schemaZ) — servers import `CollectionQueryZ` via
// `collection/server`; browser code needs only the derived types.
export type { CollectionQuery, CollectionQueryAggregate, CollectionQueryOrder, CollectionQueryWhere } from "./core/queryZ";
export * from "./core/ids";
export * from "./core/fieldText";
export * from "./core/project";
export * from "./core/uiTypes";
export * from "./core/presentCollection";
export * from "./core/enumColors";
export * from "./core/draft";
export * from "./core/actionVisible";
export * from "./core/backlinks";
export * from "./core/where";
export * from "./core/completion";
export * from "./core/dynamicIcon";
export * from "./core/derivedFormula";
export * from "./core/deriveAll";
export * from "./core/sortItems";
export * from "./core/itemLabel";
export * from "./core/calendarGrid";
export * from "./core/errorMessage";
export * from "./core/shortHexId";
export * from "./core/promptSafety";
