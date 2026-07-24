// Pure resolver for a collection's dynamic launcher-shortcut icon (see
// `CollectionSchema.dynamicIcon`). Selects one "source" record from a
// (possibly cross-collection, optionally `where`-filtered) records pool,
// then maps it through a first-match-wins rules list to an icon name.
// No fs, no host state — the server-side compute
// (`packages/core/src/collection/server/dynamicIcon.ts`) loads the source
// collection's records and calls these.

import { fieldText } from "./fieldText";
import { matchesWhere } from "./where";
import type { CollectionFieldSpec, CollectionItem, CollectionSchema, DynamicIconSource, DynamicIconSpec } from "./schema";

/** The record with the greatest `String(record[field])` (localeCompare) —
 *  ties keep the first-seen record (stable left-to-right `reduce`). */
function latestByField(pool: CollectionItem[], field: string): CollectionItem {
  return pool.reduce((latest, candidate) => (fieldText(candidate[field]).localeCompare(fieldText(latest[field])) > 0 ? candidate : latest));
}

/** Reduce `records` to the one record that decides the effective icon, per
 *  `source`'s `where` filter + `from` strategy:
 *  - pool = `source.where`-filtered records, or every record when unset;
 *  - an empty pool resolves to `null` (no source record → fallback);
 *  - `from: "first"` / `"when"` → the first pool record (storage order);
 *  - `from: "latest"` (default), with `orderBy` given → the pool record
 *    whose `String(record[orderBy])` sorts highest;
 *  - `from: "latest"`, with no `orderBy` → the last pool record.
 *  `recordsById` (the source collection's records keyed by primaryKey)
 *  resolves any `valueFrom` reference inside `source.where`; omitted for
 *  callers with no cross-record lookups. */
export function selectDynamicRecord(
  records: CollectionItem[],
  source: DynamicIconSource,
  orderBy: string | undefined,
  recordsById: Record<string, CollectionItem> = {},
): CollectionItem | null {
  const { where } = source;
  const pool = where ? records.filter((record) => matchesWhere(where, record, recordsById)) : records;
  if (pool.length === 0) return null;
  if (source.from === "first" || source.from === "when") return pool[0];
  return orderBy ? latestByField(pool, orderBy) : pool[pool.length - 1];
}

/** Map a resolved source record to the effective icon: `spec.fallback`
 *  (or the collection's own static `icon`) when there's no record or no
 *  rule matches; otherwise the `icon` of the first rule whose `where`
 *  matches the record. `recordsById` resolves any `valueFrom` reference
 *  inside a rule's `where`, same as `selectDynamicRecord`. */
export function resolveIcon(
  record: CollectionItem | null,
  spec: DynamicIconSpec,
  staticIcon: string,
  recordsById: Record<string, CollectionItem> = {},
): string {
  const fallback = spec.fallback ?? staticIcon;
  if (!record) return fallback;
  const matched = spec.rules.find((rule) => matchesWhere(rule.where, record, recordsById));
  return matched ? matched.icon : fallback;
}

const isDateLikeField = (field: CollectionFieldSpec): boolean => field.type === "date" || field.type === "datetime";

/** The first field key (declaration order) whose type is `date` or
 *  `datetime` — the default `orderBy` for `from: "latest"` when a
 *  `DynamicIconSource` doesn't name one. `undefined` when the schema has
 *  no date-like field. */
export function firstDateField(schema: CollectionSchema): string | undefined {
  return Object.entries(schema.fields).find(([, field]) => isDateLikeField(field))?.[0];
}
