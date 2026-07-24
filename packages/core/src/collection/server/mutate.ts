// Execute a `kind: "mutate"` action (plan step ④ of
// plans/done/collection-ontology.md): the HOST applies a declarative,
// merge-semantics write to one record — no LLM, no tokens. The pipeline
// deliberately reuses the governed write path's pieces, never a third
// mechanism:
//
//   1. params  — the mini-form is validated per spec by the SAME
//      compiled record checks `putItems` uses (`recordFieldProblem`,
//      strict tier: required/enum plus typed values, since a form
//      rejects rather than lints);
//   2. merge   — the resolved `set` merges over the stored record with
//      computed keys stripped (healing stale copies, exactly like
//      manageCollection's `mode: "merge"`);
//   3. gate    — `validateRecordObject`, the same write gate every
//      governed path runs;
//   4. write   — `writeItem` (atomic, change-publishing).
//
// The `require` state gate is enforced HERE, against the exact snapshot
// the merge runs on — the route's earlier `actionVisible` pre-check is a
// fast 409 on a stale button, but a concurrent write between the route's
// read and ours could otherwise slip a mutation past a gate that no
// longer holds (Codex on PR #2105). Visibility is the authorization
// rule, shared with the chat/agent kinds.

import { actionVisible } from "../core/actionVisible";
import { COMPUTED_TYPES, recordFieldProblem } from "../core/recordZ";
import { resolveMutateSet } from "../core/mutateAction";
import type { IoOptions } from "./io";
import { storeFor } from "./store";
import { validateRecordObject } from "./validate";
import type { LoadedCollection } from "./discoveredCollection";
import type { CollectionItem, CollectionMutateAction } from "../core/schema";

export type MutateActionOutcome =
  | { ok: true; item: CollectionItem }
  /** `status` picks the HTTP mapping: bad params / a write-gate reject are
   *  the caller's 400s, a missing record its 404, an unmet `require` its
   *  409, a refused write its 500. */
  | { ok: false; status: "invalid-params" | "invalid-record" | "not-found" | "require-unmet" | "write-refused"; problem: string };

/** First problem with the submitted params, or null. Every declared param
 *  is checked by the shared record-field validator; keys the action never
 *  declared are rejected outright — a stray key would otherwise ride the
 *  resolved `set` semantics silently. */
export function firstMutateParamProblem(action: CollectionMutateAction, params: Record<string, unknown>): string | null {
  const declared = action.params ?? {};
  for (const key of Object.keys(params)) {
    // Own-property check, not a bare index: `params` keys come from the request
    // body, so `constructor` / `toString` would resolve to an `Object.prototype`
    // member and slip past the rejection this loop exists to make.
    if (!Object.hasOwn(declared, key)) return `unknown param '${key}' — not declared by action '${action.id}'`;
  }
  for (const [key, spec] of Object.entries(declared)) {
    const problem = recordFieldProblem(key, spec, params[key], "strict");
    if (problem) return problem;
  }
  return null;
}

/** Apply one mutate action to one record. Never throws for data-shaped
 *  failures — the outcome's `problem` doubles as agent feedback when an
 *  LLM (not the user) pressed the button. */
export async function applyMutateAction(
  collection: LoadedCollection,
  action: CollectionMutateAction,
  itemId: string,
  params: Record<string, unknown>,
  opts: IoOptions = {},
): Promise<MutateActionOutcome> {
  const paramProblem = firstMutateParamProblem(action, params);
  if (paramProblem) return { ok: false, status: "invalid-params", problem: paramProblem };

  // Discovery statically rejects mutate actions on read-only (dataSource)
  // schemas, so a missing `write` is defense in depth, not a live path.
  const store = storeFor(collection, opts);
  if (!store.write) return { ok: false, status: "write-refused", problem: "write refused (read-only collection)" };

  const existing = await store.read(itemId);
  if (!existing) return { ok: false, status: "not-found", problem: `item '${itemId}' not found` };

  // Re-check `require` against THIS read — the snapshot the merge below
  // actually uses — so a write that landed after the route's pre-check
  // can't let the mutation run with its gate no longer satisfied.
  if (!actionVisible(action, existing)) {
    return { ok: false, status: "require-unmet", problem: `action '${action.id}' is not available for item '${itemId}' in its current state` };
  }

  // Merge over the stored record with computed keys stripped — a legacy /
  // raw-written record can carry a stale derived/embed value, and
  // re-writing it would perpetuate a forged host-computed value.
  const stored = Object.entries(existing).filter(([key]) => {
    const spec = collection.schema.fields[key];
    return !spec || !COMPUTED_TYPES.has(spec.type);
  });
  const merged: CollectionItem = { ...Object.fromEntries(stored), ...resolveMutateSet(action.set, params) };

  const invalid = validateRecordObject(merged, itemId, collection.schema);
  if (invalid) return { ok: false, status: "invalid-record", problem: invalid };

  const result = await store.write(itemId, merged);
  if (result.kind !== "ok") return { ok: false, status: "write-refused", problem: `write refused (${result.kind})` };
  return { ok: true, item: merged };
}
