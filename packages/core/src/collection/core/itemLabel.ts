// Shared chip/label resolution for the collection calendar surfaces (month
// grid + day view), so both label a record identically. Pure, type-only
// dependency on the schema shape.

import { fieldText } from "./fieldText";
import type { CollectionItem, CollectionSchema } from "./schema";

// Text-like field types that make a sensible human-readable label.
const LABEL_FIELD_TYPES = new Set(["string", "text", "markdown", "email"]);

/** Which field labels a record: the schema's explicit `displayField`, else the
 *  first non-primary text-like field (so a collection without a displayField
 *  shows e.g. the title rather than the opaque primaryKey), else null → the
 *  caller falls back to the primary-key value. */
export function labelFieldFor(schema: CollectionSchema): string | null {
  if (schema.displayField) return schema.displayField;
  for (const [key, spec] of Object.entries(schema.fields)) {
    if (key !== schema.primaryKey && LABEL_FIELD_TYPES.has(spec.type)) return key;
  }
  return null;
}

/** A record's primary-key value as a string. */
export function itemIdOf(item: CollectionItem, schema: CollectionSchema): string {
  return fieldText(item[schema.primaryKey]);
}

/** A record's display label: the resolved `labelField` value, else the
 *  primary key. Pass the result of `labelFieldFor(schema)` as `labelField`
 *  (compute it once per render rather than per item). */
export function itemLabelOf(item: CollectionItem, schema: CollectionSchema, labelField: string | null): string {
  if (labelField) {
    const value = item[labelField];
    // Accept any primitive (string / number / boolean) so a numeric or boolean
    // display field still labels the record; objects/arrays fall through to the
    // id rather than rendering as "[object Object]".
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const text = String(value);
      if (text.length > 0) return text;
    }
  }
  return itemIdOf(item, schema);
}
