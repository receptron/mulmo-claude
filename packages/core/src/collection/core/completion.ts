// The "is this record done?" predicate — THE single implementation,
// shared by the notification reconciler (bell clearing, collection-watchers),
// spawn (successor-predicate fallback, ../server/spawn.ts), and view-side
// completion filters. Zod-free and I/O-free like the rest of `core/`, so
// it is browser-safe through the collection barrel.
//
// Two completion forms (see `CollectionSchemaZ`'s completion refine):
//  - legacy pair: `completionField` names a stored field and
//    `completionDoneValues` lists the values that mean done —
//    done ⇔ `String(item[completionField])` ∈ `completionDoneValues`.
//  - flag form: `completionField` names a `flag` field (and
//    `completionDoneValues` is absent) — done ⇔ the flag's `where`
//    matches. Evaluated directly against the raw record here (NOT read
//    from a materialized value) because callers like the reconciler and
//    spawn work on records straight off disk, before any `deriveAll`
//    enrichment. That raw evaluation is CORRECT BY CONSTRUCTION: a
//    schema-level refine rejects a completion flag whose `where`
//    references computed fields, so every condition reads stored data.

import { fieldTextOrNull } from "./fieldText";
import { matchesWhere, type Where } from "./where";

/** The slice of a parsed schema the done predicate reads — minimal
 *  structural shape (like `DerivableSchema`) so the client and server
 *  `CollectionSchema` types both satisfy it as-is. */
export interface CompletionSchemaView {
  /** Optional so legacy-pair callers (and their test fixtures) that
   *  never consult field specs keep working; only the flag form needs
   *  to look the completion field up. */
  fields?: Record<string, { type: string; where?: Where }>;
  completionField?: string;
  completionDoneValues?: readonly string[];
}

/** True iff the schema declares completion tracking AND `item` is done
 *  under whichever completion form the schema uses (see module doc). */
export function itemIsDone(schema: CompletionSchemaView, item: Record<string, unknown>): boolean {
  const { completionField, completionDoneValues } = schema;
  if (!completionField) return false;
  const spec = schema.fields?.[completionField];
  if (spec?.type === "flag" && spec.where) return matchesWhere(spec.where, item);
  if (!completionDoneValues) return false;
  // An array/object field has no text form; treat it as "not done" rather than
  // letting "[object Object]" match a configured done-value.
  const text = fieldTextOrNull(item[completionField]);
  if (text === null) return false;
  return completionDoneValues.includes(text);
}
