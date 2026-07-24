// Composite cell keys for the list table's per-cell state maps, plus the
// load-time "which enum cells were empty" snapshot the inline enum dropdown
// reads. Pure and framework-free so the view keeps only the reactive refs.

import { fieldText } from "./fieldText";
import type { CollectionItem } from "./schema";

/** The schema slice `snapshotEmptyEnums` reads — minimal structural shape so
 *  both the client and server collection-schema types satisfy it as-is. */
export interface EnumSnapshotSchema {
  fields: Record<string, { type: string }>;
  primaryKey: string;
}

/** Stable key for one cell (`<rowId>:<fieldKey>`) in the per-cell state maps. */
export function cellKey(rowId: string, fieldKey: string): string {
  return `${rowId}:${fieldKey}`;
}

/** The set of enum cells that were empty in the freshly-fetched records — the
 *  only cells whose inline dropdown offers an empty option. */
export function snapshotEmptyEnums(schema: EnumSnapshotSchema, records: CollectionItem[]): Set<string> {
  const empty = new Set<string>();
  const enumKeys = Object.entries(schema.fields)
    .filter(([, field]) => field.type === "enum")
    .map(([fieldKey]) => fieldKey);
  if (enumKeys.length === 0) return empty;
  for (const record of records) {
    const recordId = fieldText(record[schema.primaryKey]);
    for (const fieldKey of enumKeys) {
      if (record[fieldKey] == null || record[fieldKey] === "") empty.add(cellKey(recordId, fieldKey));
    }
  }
  return empty;
}
