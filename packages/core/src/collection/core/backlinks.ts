// Pure resolution for `backlinks` fields (plan step ② of
// plans/done/collection-ontology.md): the display-only reverse side of `ref`.
// Both the server enrichment (`server/derive.ts`) and the client detail
// view derive the row set through THESE helpers, so the LLM (getItems)
// and the user (record panel) always see the same rows — the same
// single-implementation rule `deriveAll` follows for formulas. No zod,
// no I/O; safe for the browser barrel.

import { whenMatches } from "./actionVisible";
import { fieldTextOrNull } from "./fieldText";
import type { CollectionFieldSpec, CollectionItem } from "./schema";

/** The `backlinks` member of the field-spec union. */
export type BacklinksFieldSpec = Extract<CollectionFieldSpec, { type: "backlinks" }>;

/** Does `item` reference `recordId` through `via`? Three shapes, tried in
 *  order so the dotted form never regresses an existing flat key:
 *
 *  - Exact key (`via` is an own property of `item`): the field holds the id
 *    directly — compared as text, like every ref deref. This is checked FIRST
 *    because `schemaZ` accepts any field name (`z.string()`), so a field
 *    literally named `"client.id"` keeps its pre-nesting flat-match behaviour
 *    instead of being reinterpreted as a table path. A field holding an
 *    array/object has no id to compare, so it matches nothing (rather than
 *    testing "[object Object]" against the record id).
 *  - Nested ref (`via: "<tableField>.<refColumn>"`, split on the FIRST `.`,
 *    only when no exact key exists): the source stores its ref one level down,
 *    inside a `table` field's rows (the ontology scanner advertises these as
 *    `${key}.${subKey}`). Matches when `item[tableField]` is an array and ANY
 *    row's `refColumn` derefs to `recordId`. A record referencing the target in
 *    several rows still matches once — the caller filters over source records,
 *    each yielded at most once.
 *  - No dot and no such key: matches nothing.
 *
 *  Fail-soft throughout: a dotted `via` whose table field is absent / non-array,
 *  or whose rows lack the column, matches nothing — the same "a `via` that
 *  doesn't resolve matches nothing" contract as the flat case. Deeper nesting
 *  (`a.b.c`) makes `b.c` the column name, which no row carries → no match. */
export function viaMatches(via: string, item: CollectionItem, recordId: string): boolean {
  if (Object.hasOwn(item, via)) return fieldTextOrNull(item[via]) === recordId;
  const dot = via.indexOf(".");
  if (dot === -1) return false;
  const tableField = via.slice(0, dot);
  const refColumn = via.slice(dot + 1);
  const rows = item[tableField];
  if (!Array.isArray(rows)) return false;
  return rows.some((row) => fieldTextOrNull((row as CollectionItem)?.[refColumn]) === recordId);
}

/** The SOURCE records whose `via` field stores `recordId` (compared as
 *  strings, like every ref deref), with the optional `filter` applied —
 *  in the source items' given order. `via` may be a top-level column or a
 *  `<tableField>.<refColumn>` path into a `table` field's rows (see
 *  {@link viaMatches}). Fail-soft by construction: a `via` that doesn't
 *  resolve on the source records simply matches nothing.
 *  Callers pass DERIVED source records, so a `filter`/`display` on a
 *  derived column works when its formula is SELF-CONTAINED (an invoice
 *  `total` = sum over its own line items); a source column that derefs
 *  yet another collection stays absent — the same each-record-derives-
 *  against-itself rule ref targets follow. */
export function backlinkRows(spec: Pick<BacklinksFieldSpec, "via" | "filter">, recordId: string, sourceItems: CollectionItem[]): CollectionItem[] {
  if (!recordId) return [];
  return sourceItems.filter((item) => viaMatches(spec.via, item, recordId) && whenMatches(spec.filter, item));
}

/** Project one backlink row to the keys consumers surface: the source
 *  collection's primaryKey (rows must stay addressable — it's the link
 *  target) plus the declared `display` columns. Keys the row doesn't
 *  carry are simply absent, mirroring `projectFields` in getItems. */
export function projectBacklinkRow(row: CollectionItem, display: readonly string[], primaryKey: string): CollectionItem {
  const keys = display.includes(primaryKey) ? display : [primaryKey, ...display];
  // Own-property only (matches `viaMatches` above): a display column named
  // `toString` must be absent, not project an inherited prototype function.
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]]));
}

/** The `rollup` member of the field-spec union. */
export type RollupFieldSpec = Extract<CollectionFieldSpec, { type: "rollup" }>;

/** Numeric coercion shared by the strict record lint (`./recordZ`) and
 *  rollup sums: a plain number, or a non-blank numeric string (renderers
 *  coerce those via `Number(...)`, so they display fine). Anything else —
 *  arrays (`[]` stringifies to `""` = 0, `[42]` to `"42"`), booleans,
 *  objects — is NaN. Lives here (zod-free) so both consumers share one
 *  definition of "numeric". */
export function coerceNumeric(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
}

/** The rollup aggregate over the matching source rows (plan step ⑤):
 *  `count` = how many rows match; `sum` = the total of `column` over
 *  them, skipping non-numeric / absent values (a partially-filled source
 *  still sums what's there). An EMPTY match set is a real 0 — the
 *  fail-soft null lives at the caller, for a source collection that
 *  couldn't be resolved at all. Same derived-source-records contract as
 *  `backlinkRows`: pass records derived against themselves, so summing a
 *  self-contained derived column (an invoice `total`) works. */
export function rollupValue(spec: Pick<RollupFieldSpec, "via" | "filter" | "op" | "column">, recordId: string, sourceItems: CollectionItem[]): number {
  const rows = backlinkRows(spec, recordId, sourceItems);
  if (spec.op === "count") return rows.length;
  let total = 0;
  for (const row of rows) {
    const value = coerceNumeric(spec.column === undefined ? undefined : row[spec.column]);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}
