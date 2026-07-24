// State-parameterized pure renderers for collection surfaces, extracted from
// useCollectionRendering.ts. Unlike the leaf formatters in
// `useCollectionRendering.helpers.ts`, these take the resolved cache values
// and locale as EXPLICIT arguments (never a reactive ref), so the composable
// can wire them with thin closures while they stay unit-testable in isolation.
// NO vue / DOM / I/O / reactive state here — every function is pure.

import { backlinkRows, deriveAll, embedTargetId, fieldText, rollupValue } from "@mulmoclaude/core/collection";
import type {
  BacklinksView,
  CollectionItem,
  CollectionSchema,
  CollectionFieldSpec as FieldSpec,
  EmbedCache,
  EmbedRow,
  EmbedView,
  RefCache,
  RefOption,
  RefRecordCache,
} from "@mulmoclaude/core/collection";
import {
  buildEmbedOptions,
  derivedRecordsById,
  detailText,
  formatCell,
  formatMoney,
  resolveCurrency,
  sortedRefOptions,
} from "./useCollectionRendering.helpers";

export function lookupRefDisplay(refCache: RefCache, targetSlug: string, itemSlug: string): string {
  const map = refCache[targetSlug];
  return (map && map[itemSlug]) || itemSlug;
}

export function refOptionsFor(refCache: RefCache, targetSlug: string): RefOption[] {
  const map = refCache[targetSlug];
  return map ? sortedRefOptions(map) : [];
}

/** Dropdown options for an `embed` field's per-record picker (`idField`):
 *  every record in the target collection, labelled by its name/title (or
 *  primary key). Built from `embedCache` so it works for embed targets
 *  that aren't also `ref` targets (the profile collection, say). */
export function embedOptionsFor(embedCache: EmbedCache, targetSlug: string): RefOption[] {
  const data = embedCache[targetSlug];
  return data ? buildEmbedOptions(data.schema, data.items) : [];
}

export function resolveEmbed(
  field: FieldSpec,
  record: CollectionItem | null,
  embedCache: EmbedCache,
): { schema: CollectionSchema | null; item: CollectionItem | null } {
  if (field.type !== "embed" || !field.to) return { schema: null, item: null };
  const targetId = embedTargetId(field, record);
  const data = targetId ? embedCache[field.to] : undefined;
  if (!data) return { schema: null, item: null };
  const item = data.items.find((entry) => fieldText(entry[data.schema.primaryKey]) === targetId) ?? null;
  return { schema: data.schema, item };
}

export function formatEmbedValue(field: FieldSpec, value: unknown, record: CollectionItem | null, locale: string): string {
  if (field.type === "money") return formatMoney(value, resolveCurrency(field, record), locale);
  return detailText(value);
}

/** Build the read-only embed view-models for one record. A function of the
 *  open record (not a bare computed) because a per-record `idField` embed
 *  resolves a different target per row. `schema` is the OPEN collection's
 *  schema (null when no collection is loaded → no views). */
export function buildEmbedViews(
  schema: CollectionSchema | null,
  embedCache: EmbedCache,
  record: CollectionItem | null,
  locale: string,
): Record<string, EmbedView> {
  const out: Record<string, EmbedView> = {};
  if (!schema) return out;
  for (const [key, field] of Object.entries(schema.fields)) {
    if (field.type !== "embed") continue;
    const { schema: targetSchema, item } = resolveEmbed(field, record, embedCache);
    const rows: EmbedRow[] = [];
    if (targetSchema && item) {
      for (const [subKey, subField] of Object.entries(targetSchema.fields)) {
        const value = item[subKey];
        // Skip empty fields — the embed is a read-only summary, so
        // unfilled optionals would just be "—" noise.
        if (value === undefined || value === null || value === "") continue;
        rows.push({ key: subKey, label: subField.label, type: subField.type, value, display: formatEmbedValue(subField, value, item, locale) });
      }
    }
    out[key] = { found: Boolean(item), rows, targetSlug: field.to ?? "", recordId: embedTargetId(field, record) };
  }
  return out;
}

/** One backlinks table CELL: money formatted with its currency, anything
 *  else through the same `formatCell` list tables use — so a markdown
 *  source column (a worklog `notes`) shows the one-line 80-char preview,
 *  not the whole text. Unknown `display` key ⇒ plain text (fail-soft). */
function formatBacklinkCell(sourceField: FieldSpec | undefined, value: unknown, row: CollectionItem, locale: string): string {
  if (!sourceField) return detailText(value);
  if (sourceField.type === "money") return formatMoney(value, resolveCurrency(sourceField, row), locale);
  return formatCell(value, sourceField.type);
}

/** Build the read-only backlinks view-models for one record: for each
 *  `backlinks` field, the rows of `from` whose `via` points at the open
 *  record (matched via the SHARED `backlinkRows`, on source records
 *  derived exactly like the server's enrichment — so a `display`/`filter`
 *  on a derived column such as an invoice `total` agrees on both sides).
 *  Source data comes out of `embedCache` (reverse sources ride the embed
 *  fan-out — see `linkedTargets`). Fail-soft: an unloadable source or an
 *  unknown `display` key degrades to `found: false` / a raw-key column,
 *  never a throw. */
export function buildBacklinksViews(
  schema: CollectionSchema | null,
  embedCache: EmbedCache,
  record: CollectionItem | null,
  locale: string,
): Record<string, BacklinksView> {
  const out: Record<string, BacklinksView> = {};
  if (!schema) return out;
  for (const [key, field] of Object.entries(schema.fields)) {
    if (field.type !== "backlinks") continue;
    const columns = field.display.map((col) => ({ key: col, label: col }));
    const data = embedCache[field.from];
    if (!data) {
      out[key] = { found: false, columns, rows: [], fromSlug: field.from };
      continue;
    }
    for (const column of columns) column.label = data.schema.fields[column.key]?.label ?? column.key;
    const selfId = fieldText(record?.[schema.primaryKey]);
    // Index the derived source records EXACTLY like the server's
    // `loadTarget` (shared memo over `derivedRecordsById`): non-empty
    // string ids, one record per id — so the client can never surface a
    // row that `getItems` wouldn't (blank ids, duplicate-id files), and
    // every rendered row is navigable with a unique Vue key.
    const sourceItems = derivedSourceItems(embedCache, field.from) ?? [];
    const rows = backlinkRows(field, selfId, sourceItems).map((row) => ({
      id: fieldText(row[data.schema.primaryKey]),
      cells: columns.map((column) => formatBacklinkCell(data.schema.fields[column.key], row[column.key], row, locale)),
    }));
    out[key] = { found: true, columns, rows, fromSlug: field.from };
  }
  return out;
}

// Derived source records per (embedCache object, source slug) — the same
// index-then-derive the server's loadTarget runs, memoized because rollup
// renders per LIST CELL (every row × every rollup column); re-deriving the
// whole source collection per cell would be quadratic. Keyed by the cache
// OBJECT: `loadLinkedCollections` replaces it wholesale, invalidating this
// memo naturally.
const derivedSourceMemo = new WeakMap<object, Map<string, CollectionItem[]>>();

function derivedSourceItems(embedCache: EmbedCache, from: string): CollectionItem[] | null {
  const data = embedCache[from];
  if (!data) return null;
  let bySlug = derivedSourceMemo.get(embedCache);
  if (!bySlug) {
    bySlug = new Map();
    derivedSourceMemo.set(embedCache, bySlug);
  }
  let items = bySlug.get(from);
  if (!items) {
    items = Object.values(derivedRecordsById(data.schema, data.items));
    bySlug.set(from, items);
  }
  return items;
}

/** The rollup scalar for one record, from the reverse sources riding the
 *  embed cache — the SAME index (non-empty ids, one record per id, derived
 *  against themselves) and the SAME `rollupValue` the server enrichment
 *  uses, so the cell and getItems can't disagree. Null (em-dash) when the
 *  source collection isn't loadable; a real 0 for an empty match set. */
export function rollupValueFor(field: FieldSpec, record: CollectionItem | null, schema: CollectionSchema | null, embedCache: EmbedCache): number | null {
  if (field.type !== "rollup" || !schema || !record) return null;
  const items = derivedSourceItems(embedCache, field.from);
  if (items === null) return null;
  // No empty-id guard here: an empty primaryKey matches nothing inside
  // `backlinkRows` and yields a real 0 — exactly what the server's
  // `projectRollups` returns for the same record (Codex on PR #2116).
  return rollupValue(field, fieldText(record[schema.primaryKey]), items);
}

/** Display string for a rollup cell: the aggregate as a plain number,
 *  em-dash when the source collection couldn't be resolved. */
export function renderRollup(field: FieldSpec, record: CollectionItem | null, schema: CollectionSchema | null, embedCache: EmbedCache): string {
  const value = rollupValueFor(field, record, schema, embedCache);
  return value === null ? "—" : formatCell(value, "number");
}

/** Copy of `item` with every rollup field resolved from the reverse
 *  sources — injected BEFORE the formula pass so a `derived` formula can
 *  read rollup values as plain identifiers (`played = homePlayed +
 *  awayPlayed`), in the same rollups-then-formulas order the server
 *  enrichment runs. Returns `item` unchanged when the schema declares no
 *  rollups (the overwhelmingly common case — no copy). */
export function withRollupValues(schema: CollectionSchema | null, item: CollectionItem, embedCache: EmbedCache): CollectionItem {
  if (!schema) return item;
  let out = item;
  for (const [key, field] of Object.entries(schema.fields)) {
    if (field.type !== "rollup") continue;
    if (out === item) out = { ...item };
    out[key] = rollupValueFor(field, item, schema, embedCache);
  }
  return out;
}

export function renderSubCell(subField: FieldSpec, value: unknown, record: CollectionItem | null, refCache: RefCache, locale: string): string {
  if (subField.type === "money") return formatMoney(value, resolveCurrency(subField, record), locale);
  if (subField.type === "ref" && subField.to && typeof value === "string" && value.length > 0) return lookupRefDisplay(refCache, subField.to, value);
  return formatCell(value, subField.type);
}

// The derive loop itself lives in `@mulmoclaude/core/collection` (deriveAll),
// shared with the server's manageCollection enrichment so both sides compute
// identical values. These wrappers bind it to the open collection's schema +
// the loaded ref records.

export function evaluateDerived(
  field: FieldSpec,
  fieldKey: string,
  item: CollectionItem,
  schema: CollectionSchema | null,
  refRecords: RefRecordCache,
  embedCache: EmbedCache = {},
): number | null {
  if (field.type !== "derived" || !schema) return null;
  // Rollups resolve FIRST so formulas can reference them — mirroring the
  // server's enrichment order exactly.
  const enriched = deriveAll(schema, withRollupValues(schema, item, embedCache), refRecords);
  const result = enriched[fieldKey];
  return typeof result === "number" && Number.isFinite(result) ? result : null;
}

export function renderDerived(field: FieldSpec, computedValue: unknown, record: CollectionItem | null, locale: string): string {
  if (computedValue === null || computedValue === undefined) return "—";
  const display = field.type === "derived" ? field.display : undefined;
  if (display === "money") return formatMoney(computedValue, resolveCurrency(field, record), locale);
  return formatCell(computedValue, display ?? "number");
}
