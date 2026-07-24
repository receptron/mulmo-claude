// Server-side compute for a collection's dynamic launcher-shortcut icon
// (see `CollectionSchema.dynamicIcon`). Wraps the pure resolver in
// `../core/dynamicIcon` with the one bit of I/O it needs: loading the
// source collection's raw stored records.

import { fieldText } from "../core/fieldText";
import { firstDateField, resolveIcon, selectDynamicRecord } from "../core/dynamicIcon";
import { loadCollection, type DiscoveryOptions } from "./discovery";
import { storeFor } from "./store";
import { log } from "./host";
import type { LoadedCollection } from "./discoveredCollection";
import type { CollectionItem } from "../core/schema";

/** Index `items` by their `primaryKey` value — the `recordsById` map a
 *  `valueFrom` reference (e.g. `_config.defaultCity`) resolves against.
 *  Items whose primary key isn't a string (shouldn't happen for a valid
 *  schema, but records are untyped storage) are skipped rather than
 *  coerced, so a broken key never silently shadows a real one. */
function buildRecordsById(items: CollectionItem[], primaryKey: string): Record<string, CollectionItem> {
  const entries = items.filter((item) => typeof item[primaryKey] === "string").map((item): [string, CollectionItem] => [String(item[primaryKey]), item]);
  return Object.fromEntries(entries);
}

/** Order records by their `primaryKey` so record selection is deterministic:
 *  `listItems` returns filesystem `readdir` order (arbitrary across machines),
 *  which would let `from: "first"`, the no-`orderBy` `latest`, and `orderBy`
 *  ties pick a different record — and thus a different icon — between
 *  reconciles. A stable id sort pins one answer. */
function sortByPrimaryKey(items: CollectionItem[], primaryKey: string): CollectionItem[] {
  return [...items].sort((left, right) => fieldText(left[primaryKey]).localeCompare(fieldText(right[primaryKey])));
}

/** Compute the effective launcher icon for `collection`: its static
 *  `schema.icon` when it declares no `dynamicIcon`, else the icon
 *  resolved from `dynamicIcon.source`'s RAW stored records (no
 *  derive/enrich — the icon rules match against stored values) via the
 *  pure resolver. Fails soft on any read/discovery error (missing source
 *  collection, filesystem error): falls back to `dynamicIcon.fallback ??
 *  schema.icon` rather than surfacing to the collections list. */
export async function computeCollectionIcon(collection: LoadedCollection, opts: DiscoveryOptions = {}): Promise<string> {
  const { schema } = collection;
  const spec = schema.dynamicIcon;
  if (!spec) return schema.icon;
  try {
    const source = await loadCollection(spec.source.collection, opts);
    if (!source) return spec.fallback ?? schema.icon;
    const items = await storeFor(source, { workspaceRoot: opts.workspaceRoot }).list();
    const ordered = sortByPrimaryKey(items, source.schema.primaryKey);
    const orderBy = spec.source.orderBy ?? firstDateField(source.schema);
    const recordsById = buildRecordsById(ordered, source.schema.primaryKey);
    const record = selectDynamicRecord(ordered, spec.source, orderBy, recordsById);
    return resolveIcon(record, spec, schema.icon, recordsById);
  } catch (err) {
    log.warn("collections", "dynamic icon compute failed, falling back", {
      slug: collection.slug,
      source: spec.source.collection,
      error: String(err),
    });
    return spec.fallback ?? schema.icon;
  }
}
