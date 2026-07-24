// Validation of an API-supplied config array with an entry cap (#2341).
//
// The rule — array check, cap, per-entry parse, `entry ${i}: ...` errors —
// is shared by every workspace config list (custom dirs, reference dirs).

import { hasStringProp } from "./types.js";

export type EntryListResult<T> = { entries: T[] } | { error: string };

export interface EntryListSpec<T, K extends string> {
  /** Each list owns its own cap; they are unrelated limits, not one constant. */
  maxEntries: number;
  validateEntry: (item: unknown) => T | null;
  /** Property echoed back in a per-entry error, e.g. `"path"` / `"hostPath"`. */
  echoProp: K;
  /** Wording after `entry ${i}: `, given the echoed value. */
  describeInvalid: (echoedValue: string) => string;
}

export function validateEntryList<T, K extends string>(raw: unknown, spec: EntryListSpec<T, K>): EntryListResult<T> {
  if (!Array.isArray(raw)) {
    return { error: "expected an array" };
  }
  if (raw.length > spec.maxEntries) {
    return { error: `too many entries (max ${spec.maxEntries})` };
  }

  const entries: T[] = [];
  const errors: string[] = [];
  raw.forEach((item: unknown, i) => {
    const entry = spec.validateEntry(item);
    if (entry !== null) {
      entries.push(entry);
      return;
    }
    // Only echo a genuine string back in the error; a non-string property is
    // exactly the case where "[object Object]" would mislead the reader about
    // what their config actually says.
    const echoed = hasStringProp(item, spec.echoProp) ? item[spec.echoProp] : "";
    errors.push(`entry ${i}: ${spec.describeInvalid(echoed)}`);
  });

  if (errors.length > 0) {
    return { error: errors.join("; ") };
  }
  return { entries };
}
