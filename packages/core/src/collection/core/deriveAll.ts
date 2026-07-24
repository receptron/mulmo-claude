// The derived-field saturation loop for schema-driven collections,
// extracted from `composables/collections/useCollectionRendering.ts` so
// the server (manageCollection getItems enrichment) and the client
// (table cells, form display) evaluate formulas through ONE
// implementation — if the two ever diverged, the UI and the LLM would
// disagree on a number. Pure module: no Vue, no I/O.
//
// Like `actionVisible.ts`, the input types are minimal structural
// shapes so both the client `FieldSpec`/`CollectionSchema`
// (src/components/collectionTypes.ts) and the server
// `CollectionFieldSpec`/`CollectionSchema`
// (server/workspace/collections/types.ts) satisfy them as-is.

import { evaluateDerived, type FormulaContext } from "./derivedFormula";
import { ownProp } from "./ownProp";
import { matchesWhere, type Where } from "./where";

/** Minimal field shape the derive loop needs — accepts both the client
 *  FieldSpec and the server CollectionFieldSpec. */
export interface DerivableFieldSpec {
  type: string;
  /** When type === "ref": slug of the target collection. */
  to?: string;
  /** When type === "derived": formula evaluated against the record. */
  formula?: string;
  /** When type === "flag": predicate matched against the record. */
  where?: Where;
}

/** Minimal schema shape: just the ordered field map. */
export interface DerivableSchema {
  fields: Record<string, DerivableFieldSpec>;
}

export type DerivableRecord = Record<string, unknown>;

/** Per-target-collection cache of loaded referenced records:
 *  target collection slug → item slug → full record. Mirrors the
 *  client's `RefRecordCache` / the server's enrichment loader. */
export type DeriveRefRecords = Record<string, Record<string, DerivableRecord>>;

/** Map each `ref` field's stored slug to its loaded target record (or
 *  null when dangling / not loaded), keyed by the LOCAL field name —
 *  the shape `evaluateDerived` reads for `<field>.<col>` derefs. */
export function resolveRowRefs(schema: DerivableSchema, record: DerivableRecord, refRecords: DeriveRefRecords): NonNullable<FormulaContext["refs"]> {
  const refs: NonNullable<FormulaContext["refs"]> = {};
  for (const [key, field] of Object.entries(schema.fields)) {
    if (field.type !== "ref" || !field.to) continue;
    const slug = record[key];
    const targets = ownProp(refRecords, field.to);
    refs[key] = typeof slug === "string" && targets ? (ownProp(targets, slug) ?? null) : null;
  }
  return refs;
}

/** True for the field types the saturation loop below (re)computes:
 *  `derived` formulas and `flag` predicates. */
function isLoopComputed(field: DerivableFieldSpec): boolean {
  return field.type === "derived" || field.type === "flag";
}

/** The value one loop-computed field takes against the current
 *  `enriched` record: a `derived` formula result (`null` = failed) or a
 *  `flag` predicate match (total — always a boolean). `undefined` for
 *  every other field type (nothing to compute). */
function computeFieldValue(
  field: DerivableFieldSpec,
  enriched: DerivableRecord,
  refs: NonNullable<FormulaContext["refs"]>,
): number | boolean | null | undefined {
  if (field.type === "derived" && field.formula) return evaluateDerived(field.formula, { record: enriched, refs });
  if (field.type === "flag" && field.where) return matchesWhere(field.where, enriched);
  return undefined;
}

/** Evaluate every `derived` and `flag` field against `base`, saturating
 *  so a computed field can read another one computed in an earlier pass
 *  (`subtotal → tax → total` converges in ≤ field-count passes; a flag
 *  may read a derived value, or another flag via its stringified
 *  boolean). Cycles can't loop forever — passes are bounded by the
 *  number of computed fields and the loop breaks as soon as a pass
 *  changes nothing. Failed formulas stay ABSENT (the UI renders them as
 *  em-dash); flags are total (always true/false). Returns a copy;
 *  `base` is never mutated.
 *
 *  Computed keys already present in `base` are stripped before
 *  evaluation: computed output is host-truth, never persisted-input
 *  fallback. A record JSON can carry a stale (or forged) computed value
 *  — raw Write/Edit, legacy data — and without the strip, a failing
 *  formula would silently surface that value as if the host computed
 *  it. */
export function deriveAll(schema: DerivableSchema, base: DerivableRecord, refRecords: DeriveRefRecords): DerivableRecord {
  const computedKeys = new Set(
    Object.entries(schema.fields)
      .filter(([, field]) => isLoopComputed(field))
      .map(([key]) => key),
  );
  const enriched: DerivableRecord = Object.fromEntries(Object.entries(base).filter(([key]) => !computedKeys.has(key)));
  const refs = resolveRowRefs(schema, base, refRecords);
  for (let pass = 0; pass < computedKeys.size; pass++) {
    let mutated = false;
    for (const [key, field] of Object.entries(schema.fields)) {
      const next = computeFieldValue(field, enriched, refs);
      if (next !== undefined && next !== null && enriched[key] !== next) {
        enriched[key] = next;
        mutated = true;
      }
    }
    if (!mutated) break;
  }
  return enriched;
}
