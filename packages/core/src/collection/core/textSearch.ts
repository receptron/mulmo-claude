// Free-text record matching for the collection list search box. Pure and
// framework-free so the view's `filteredItems` computed just calls it.

import { fieldTextOrNull } from "./fieldText";
import type { CollectionItem } from "./schema";

/** Case-insensitive substring match across an item's scalar fields.
 *  Object/array-valued fields (table rows, nested records) have no text
 *  form (`fieldTextOrNull` → `null`) and are skipped — they don't render as
 *  searchable text in the list table.
 *
 *  `query` is matched against each cell's lower-cased text but is NOT
 *  lower-cased here: callers pass an already-normalised (trimmed +
 *  lower-cased) query, so an upper-case `query` intentionally matches
 *  nothing. Keeping the normalisation at the call site avoids re-lowering
 *  the same query once per row. */
export function itemMatchesQuery(item: CollectionItem, query: string): boolean {
  // An empty query matches every record — otherwise a row whose only fields are
  // object/array-valued (no scalar cell reaches `includes("")`) would vanish
  // when the search box is cleared. The list caller already short-circuits the
  // empty case, so this only guards a future caller that doesn't.
  if (query === "") return true;
  return Object.values(item).some((value) => {
    const text = fieldTextOrNull(value);
    return text !== null && text.toLowerCase().includes(query);
  });
}
