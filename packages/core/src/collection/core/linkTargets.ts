// The single implementation of "which linked collections must be
// preloaded" for a schema — walked identically by the server (derive /
// enrich, `server/derive.ts`) and the client (linked-cache fetch,
// collection-plugin). Both sides MUST agree: the server derefs exactly the
// collections the client caches, so a new ref-shaped field type is taught
// here once instead of drifting between two mirrored copies. Pure schema
// walk, no zod / I/O — safe for the browser barrel.

import type { CollectionFieldSpec, CollectionSchema } from "./schema";

/** Slugs of every collection referenced by a `ref` field — top-level and
 *  one level into `table` sub-fields (nested tables are schema-rejected,
 *  so a single recursion suffices). */
export function uniqueRefTargets(schema: CollectionSchema): string[] {
  const targets = new Set<string>();
  const walk = (fields: Record<string, CollectionFieldSpec>): void => {
    for (const field of Object.values(fields)) {
      if (field.type === "ref" && typeof field.to === "string" && field.to.length > 0) targets.add(field.to);
      if (field.type === "table" && field.of) walk(field.of);
    }
  };
  walk(schema.fields);
  return [...targets];
}

/** Slugs of every collection referenced by an `embed` field. Top-level
 *  only — the schema rejects `embed` inside a table's `of`, so no
 *  recursion. */
export function uniqueEmbedTargets(schema: CollectionSchema): string[] {
  const targets = new Set<string>();
  for (const field of Object.values(schema.fields)) {
    if (field.type === "embed" && typeof field.to === "string" && field.to.length > 0) targets.add(field.to);
  }
  return [...targets];
}

/** Slugs of every SOURCE collection a `backlinks` or `rollup` field
 *  reverses over — loaded once (the two field kinds share one load).
 *  Top-level only, like `embed` (the schema rejects both inside a table's
 *  `of`). */
export function uniqueBacklinkSources(schema: CollectionSchema): string[] {
  const sources = new Set<string>();
  for (const field of Object.values(schema.fields)) {
    if ((field.type === "backlinks" || field.type === "rollup") && field.from.length > 0) sources.add(field.from);
  }
  return [...sources];
}
