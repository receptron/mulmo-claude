// Field-type → comparable value for the collection list-table sort. Splits
// the header sort's per-row value extraction out of the Vue view so the
// dispatch (which field type maps to which SortValue constructor) is testable
// on its own. The comparators live in `./sortItems`; this module only routes.
//
// A few field kinds can't be sorted from the raw cell alone — `toggle` and
// `flag` are projected booleans, `derived` is a formula, and `ref` sorts by
// its resolved display label. Those readers live in the view's rendering
// composable, so they are passed in (dependency injection) rather than
// imported, keeping this module pure and framework-free.

import { numericSortValue, stringSortValue, dateSortValue, enumSortValue, boolSortValue, type SortValue } from "./sortItems";
import type { CollectionItem, CollectionFieldSpec as FieldSpec } from "./schema";

/** Resolve a `ref` cell to its human display label (target slug + item id). */
export type RefDisplayResolver = (targetSlug: string, itemSlug: string) => string;

/** The row readers the view supplies for the field kinds that can't sort off
 *  the raw cell value. All come from the rendering composable. */
export interface SortValueDeps {
  toggleChecked: (item: CollectionItem, field: FieldSpec) => boolean;
  flagValueOf: (key: string, item: CollectionItem) => boolean;
  evaluateDerived: (field: FieldSpec, key: string, item: CollectionItem) => number | null;
  deriveRecord: (item: CollectionItem) => CollectionItem;
  resolveRefDisplay: RefDisplayResolver;
}

/** Comparable value for scalar fields that key off the raw cell value. */
export function scalarSortValue(field: FieldSpec, raw: unknown, resolveRefDisplay: RefDisplayResolver): SortValue {
  switch (field.type) {
    case "number":
    case "money":
      return numericSortValue(raw);
    case "date":
    case "datetime":
      return dateSortValue(raw);
    case "enum":
      return enumSortValue(field.values, raw);
    case "boolean":
      return boolSortValue(raw === true);
    case "ref":
      return field.to && typeof raw === "string" && raw ? stringSortValue(resolveRefDisplay(field.to, raw)) : stringSortValue(raw);
    default:
      return stringSortValue(raw);
  }
}

/** Derived rows sort by their display type: money/number → numeric,
 *  date → epoch, anything else → the enriched value as a string. */
export function derivedSortValue(
  field: FieldSpec,
  key: string,
  item: CollectionItem,
  deps: Pick<SortValueDeps, "evaluateDerived" | "deriveRecord">,
): SortValue {
  const display = field.type === "derived" ? field.display : undefined;
  if (display === undefined || display === "number" || display === "money") {
    return numericSortValue(deps.evaluateDerived(field, key, item));
  }
  const enriched = deps.deriveRecord(item);
  if (display === "date") return dateSortValue(enriched[key]);
  return stringSortValue(enriched[key]);
}

/** Comparable value for one row under the active field. Toggle, flag, and
 *  derived need the whole record; every other type keys off the raw cell. */
export function sortValueOf(field: FieldSpec, key: string, item: CollectionItem, deps: SortValueDeps): SortValue {
  if (field.type === "toggle") return boolSortValue(deps.toggleChecked(item, field));
  if (field.type === "flag") return boolSortValue(deps.flagValueOf(key, item));
  if (field.type === "derived") return derivedSortValue(field, key, item, deps);
  return scalarSortValue(field, item[key], deps.resolveRefDisplay);
}
