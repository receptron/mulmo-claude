// Cross-field rules for the collection schema — the checks a single field
// cannot make because it cannot see its siblings.
//
// Each one is a named predicate over a parsed-but-unvalidated schema, returning
// true when the schema is ACCEPTABLE. They live here rather than as anonymous
// lambdas inside `./schemaZ`'s refine chain so each rule can be unit-tested on
// its own, and so the chain reads as a list of rule names instead of 500 lines
// of inline logic.
//
// Every rule guards a misconfiguration that would otherwise fail SILENTLY at
// runtime: a completion bell that never rings, a spawn that fans out forever, a
// currency that mislabels amounts. That is why they are hard errors at load
// rather than warnings.
//
// The type-only import of `CollectionSchemaInput` is erased at emit, so the
// module graph stays acyclic at runtime: schemaZ → schemaRules → schema.

import { fieldTextOrNull } from "./fieldText";
import { isSafeSlug, isSafeRecordId } from "./ids";
import { paramRefName } from "./mutateAction";
import { COMPUTED_TYPES } from "./schema";
import type { CollectionSchemaInput } from "./schemaZ";

type Schema = CollectionSchemaInput;
type Fields = Schema["fields"];

// A field pointer names a REAL declared field only when it is an OWN key of
// `fields`. A bare `fields[name]` reaches inherited Object.prototype members
// (`constructor`, `__proto__`, `toString`), so an LLM-authored pointer like
// `completionField: "constructor"` would resolve to a function and pass every
// "names a declared field" check, then misfire silently at runtime (#2318).
const declaredField = (fields: Fields, name: string): Fields[string] | undefined => (Object.hasOwn(fields, name) ? fields[name] : undefined);

// The calendar anchor/end fields accept either a date-only or a datetime
// field (the latter carries the clock for the day view).
const isDateLike = (type: string | undefined): boolean => type === "date" || type === "datetime";

// `calendarTimeField` parses a free-form time string, so it must name a
// string-backed field — a number/enum/date column has no time-range text.
const isTimeStringField = (type: string | undefined): boolean => type === "string" || type === "text";

// Field types that can hold a currency code string. A `currencyField`
// pointer must resolve to one of these — pointing at a number / boolean
// / table would never yield a usable ISO code.
const CODE_FIELD_TYPES = new Set(["string", "text", "enum"]);

const namesStoredField = (fields: Fields, name: string, primaryKey: string): boolean => {
  const target = declaredField(fields, name);
  return target !== undefined && !COMPUTED_TYPES.has(target.type) && name !== primaryKey;
};

const hasUniqueIds = (entries: { id: string }[] | undefined): boolean =>
  entries === undefined || new Set(entries.map((entry) => entry.id)).size === entries.length;

// ---------------------------------------------------------------------------
// Storage declaration
// ---------------------------------------------------------------------------

/** Exactly one storage declaration: native records need `dataPath`, an external
 *  data file needs `dataSource`, an alternative backend needs `storage`. Zero
 *  (nowhere to read) and several (ambiguous which wins) are equally
 *  meaningless — fail loudly at load instead of picking silently. */
export function declaresExactlyOneStore(schema: Schema): boolean {
  return [schema.dataPath, schema.dataSource, schema.storage].filter((declared) => declared !== undefined).length === 1;
}

// NOTE: `storage` collections support the full write machinery (`spawn` /
// `completionField` / `triggerField` / `singleton` / `ingest` / mutate actions)
// — spawn and the watcher reconcilers go through the CollectionStore seam, and
// a db-file watcher drives their reconciliation (collection-watchers/watcher.ts).
/** A `dataSource` collection is read-only by definition, so schema-level write
 *  machinery can never fire: `singleton` pins CREATES, `ingest` REFILLS
 *  records, `spawn` WRITES successor records. Rejecting them at validation
 *  kills whole classes of writes before any runtime guard. */
export function dataSourceDeclaresNoWriteMachinery(schema: Schema): boolean {
  if (schema.dataSource === undefined) return true;
  return schema.singleton === undefined && schema.ingest === undefined && schema.spawn === undefined && schema.googleCalendar === undefined;
}

/** Same rule for declarative host writes: a mutate action writes the record
 *  it's invoked on, which a read-only collection has no business doing. */
export function dataSourceDeclaresNoMutateAction(schema: Schema): boolean {
  if (schema.dataSource !== undefined) {
    return [...(schema.actions ?? []), ...(schema.collectionActions ?? [])].every((action) => action.kind !== "mutate");
  }
  return true;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Action ids must be unique so the dispatch route resolves unambiguously. */
export function actionIdsAreUnique(schema: Schema): boolean {
  return hasUniqueIds(schema.actions);
}

/** Collection-level action ids must likewise be unique. */
export function collectionActionIdsAreUnique(schema: Schema): boolean {
  return hasUniqueIds(schema.collectionActions);
}

/** A mutate action's `set` writes real STORED fields: a typo'd key would write
 *  a stray value forever, a computed/projected field is never persisted, and
 *  the primaryKey is the filename (renaming is not a mutation). */
export function mutateSetKeysNameStoredFields(schema: Schema): boolean {
  return (schema.actions ?? []).every(
    (action) => action.kind !== "mutate" || Object.keys(action.set).every((key) => namesStoredField(schema.fields, key, schema.primaryKey)),
  );
}

/** Every `$params.<name>` reference in `set` must name a declared param — an
 *  undeclared one would silently no-op the assignment. */
export function mutateParamRefsAreDeclared(schema: Schema): boolean {
  return (schema.actions ?? []).every(
    (action) =>
      action.kind !== "mutate" ||
      Object.values(action.set).every((value) => {
        const ref = paramRefName(value);
        return ref === null || (action.params ?? {})[ref] !== undefined;
      }),
  );
}

/** A collection-level action has no record to write. */
export function collectionActionsAreNotMutate(schema: Schema): boolean {
  return (schema.collectionActions ?? []).every((action) => action.kind !== "mutate");
}

// ---------------------------------------------------------------------------
// Singleton, currency
// ---------------------------------------------------------------------------

/** The singleton value becomes a record id (and thus a `<id>.json` filename),
 *  so it must satisfy the SAME record-id rule the write path enforces —
 *  otherwise the create form would lock the primary key to a value the POST
 *  route then rejects, making the collection impossible to initialize. */
export function singletonIsAValidRecordId(schema: Schema): boolean {
  return schema.singleton === undefined || isSafeRecordId(schema.singleton);
}

// `type` is carried on both levels even though this helper never reads it:
// without a required property these become weak types, and a field variant that
// declares no `currencyField` would no longer be assignable.
interface CurrencyBearingField {
  type: string;
  currencyField?: string;
  of?: Record<string, { type: string; currencyField?: string }>;
}

// Every `currencyField` declared anywhere in the schema — top-level fields and
// a table's `of` sub-fields. Sub-field money cells resolve currency against the
// TOP-LEVEL record (rows carry no currency), so their pointers are validated
// against the top-level field set too.
function collectCurrencyFieldRefs(fields: Record<string, CurrencyBearingField>): string[] {
  const refs: string[] = [];
  for (const field of Object.values(fields)) {
    if (typeof field.currencyField === "string" && field.currencyField.length > 0) refs.push(field.currencyField);
    for (const sub of Object.values(field.of ?? {})) {
      if (typeof sub.currencyField === "string" && sub.currencyField.length > 0) refs.push(sub.currencyField);
    }
  }
  return refs;
}

/** A `currencyField` pointer must name a real top-level field that holds a code
 *  string — a typo (`curreny`) would otherwise pass the per-field check, then
 *  silently fall back to the literal / USD at render and mislabel amounts. */
export function currencyFieldRefsNameCodeFields(schema: Schema): boolean {
  return collectCurrencyFieldRefs(schema.fields).every((name) => CODE_FIELD_TYPES.has(declaredField(schema.fields, name)?.type ?? ""));
}

// ---------------------------------------------------------------------------
// Completion tracking
// ---------------------------------------------------------------------------

/** The pair must be declared together — one without the other is meaningless:
 *  the host would either never fire (no done values to compare against) or
 *  never clear (no field to read).
 *
 *  EXCEPTION: when `completionField` names a `flag` field, done ⇔ the flag's
 *  `where` matches, so `completionDoneValues` carries no information and MUST
 *  be omitted (declaring it would invite a contradictory second source of
 *  truth). */
export function completionPairIsCoherent(schema: Schema): boolean {
  if (schema.completionField !== undefined && declaredField(schema.fields, schema.completionField)?.type === "flag") {
    return schema.completionDoneValues === undefined;
  }
  return (schema.completionField === undefined) === (schema.completionDoneValues === undefined);
}

/** `completionField` must name a real top-level field — a typo would silently
 *  disable the notification mechanism otherwise. */
export function completionFieldIsDeclared(schema: Schema): boolean {
  return schema.completionField === undefined || declaredField(schema.fields, schema.completionField) !== undefined;
}

/** A flag named by `completionField` is evaluated against the RAW record — the
 *  reconciler (and spawn's fallback) read items straight off disk, BEFORE any
 *  `deriveAll` enrichment — so its `where` may only reference STORED fields. A
 *  condition over a computed sibling would see an absent key: `ne` matches
 *  vacuously, every other op reads false, and the bell would clear wrongly /
 *  never. General (non-completion) flags keep the full vocabulary — the UI
 *  evaluates them post-enrichment. */
export function completionFlagReadsOnlyStoredFields(schema: Schema): boolean {
  const spec = schema.completionField === undefined ? undefined : declaredField(schema.fields, schema.completionField);
  if (spec?.type !== "flag") return true;
  return spec.where.every((cond) =>
    [cond.field, ...(cond.valueFrom ? [cond.valueFrom.field] : [])].every((name) => {
      const target = declaredField(schema.fields, name);
      return target !== undefined && !COMPUTED_TYPES.has(target.type);
    }),
  );
}

// ---------------------------------------------------------------------------
// Field pointers
// ---------------------------------------------------------------------------

/** `displayField`, like `completionField`, must name a real top-level field —
 *  a typo would silently fall back to the primaryKey forever. */
export function displayFieldIsDeclared(schema: Schema): boolean {
  return schema.displayField === undefined || declaredField(schema.fields, schema.displayField) !== undefined;
}

/** A field's `when.field` gates its visibility against a sibling's value, so it
 *  must name a real top-level field — a typo would silently keep the field
 *  hidden forever (the gate never matches). */
export function fieldVisibilityGatesNameDeclaredFields(schema: Schema): boolean {
  return Object.values(schema.fields).every((field) => field.when === undefined || declaredField(schema.fields, field.when.field) !== undefined);
}

/** A flag's `where` reads sibling fields (both `cond.field` and a same-record
 *  `valueFrom.field`), so each must name a real top-level field — a typo would
 *  silently pin the flag false forever (`ne`: true forever). */
export function flagConditionsNameDeclaredFields(schema: Schema): boolean {
  return Object.values(schema.fields).every(
    (field) =>
      field.type !== "flag" ||
      field.where.every(
        (cond) =>
          declaredField(schema.fields, cond.field) !== undefined &&
          (cond.valueFrom === undefined || declaredField(schema.fields, cond.valueFrom.field) !== undefined),
      ),
  );
}

/** An `embed`'s `idField` resolves the target record id from a sibling's value,
 *  so it must name a real top-level field — and one whose stored value is a
 *  plain id string. Only `ref` / `string` qualify: the editor writes the picked
 *  id into that field, so a non-persisted or composite type would either not
 *  round-trip on save or hold no usable id. */
export function embedIdFieldsNameIdBearingFields(schema: Schema): boolean {
  return Object.values(schema.fields).every((field) => {
    if (field.type !== "embed" || field.idField === undefined) return true;
    const target = declaredField(schema.fields, field.idField);
    return target !== undefined && (target.type === "ref" || target.type === "string");
  });
}

/** The sync writes each mapped value into a declared field, and puts the Google
 *  event id in the primary field — so a map key that names no field (or names
 *  the primary) would silently drop data or fight the id. */
export function googleCalendarMapNamesStoredFields(schema: Schema): boolean {
  if (schema.googleCalendar === undefined) return true;
  return Object.keys(schema.googleCalendar.map).every((key) => namesStoredField(schema.fields, key, schema.primaryKey));
}

// ---------------------------------------------------------------------------
// Toggle projection
// ---------------------------------------------------------------------------

/** A `toggle` field projects an `enum` field: its `field` must name a real
 *  top-level enum, and `onValue` / `offValue` must be members of that enum's
 *  `values` — otherwise toggling would write a value outside the closed set
 *  (and never appear "checked"). */
export function togglesProjectValidEnums(schema: Schema): boolean {
  const { fields } = schema;
  for (const spec of Object.values(fields)) {
    if (spec.type !== "toggle") continue;
    const target = declaredField(fields, spec.field);
    if (!target || target.type !== "enum") return false;
    const allowed = new Set(target.values);
    if (!allowed.has(spec.onValue) || !allowed.has(spec.offValue)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

/** `triggerField` requires the completion pair: the time gate only suppresses
 *  the *completion* bell until the date, and the bell still clears via
 *  `completionDoneValues`. Without completion there is no bell to gate. */
export function triggerFieldRequiresCompletion(schema: Schema): boolean {
  return schema.triggerField === undefined || schema.completionField !== undefined;
}

/** `triggerField` must name a real `date` field — the gate parses its value as
 *  `YYYY-MM-DD`; any other type can't be compared to the clock. */
export function triggerFieldIsADateField(schema: Schema): boolean {
  return schema.triggerField === undefined || declaredField(schema.fields, schema.triggerField)?.type === "date";
}

/** `triggerLeadDays` only means something relative to a trigger date. */
export function triggerLeadDaysRequiresTriggerField(schema: Schema): boolean {
  return schema.triggerLeadDays === undefined || schema.triggerField !== undefined;
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

/** `spawn` advances `triggerField` to compute the successor's trigger date, so
 *  the schema must declare one. */
export function spawnRequiresTriggerField(schema: Schema): boolean {
  return schema.spawn === undefined || schema.triggerField !== undefined;
}

/** `spawn.when.field` must name a real top-level field — a typo would silently
 *  never match. */
export function spawnWhenFieldIsDeclared(schema: Schema): boolean {
  return schema.spawn?.when === undefined || declaredField(schema.fields, schema.spawn.when.field) !== undefined;
}

/** Every `spawn.carry` entry must name a real top-level field — a typo would
 *  silently never copy. */
export function spawnCarryEntriesAreDeclared(schema: Schema): boolean {
  return (schema.spawn?.carry ?? []).every((name) => declaredField(schema.fields, name) !== undefined);
}

/** A successor must NOT be born already matching its own spawn predicate — it
 *  would re-spawn on its first reconcile, fanning out into an unbounded chain
 *  of records. The predicate field/values are `spawn.when` when given, else the
 *  completion-done pair. The successor's value for that field is `set[field]`
 *  if set, else the carried source value (which matched, by definition, when
 *  the spawn fired) if carried, else absent (safe). */
export function spawnSuccessorStartsInert(schema: Schema): boolean {
  const { spawn } = schema;
  if (!spawn) return true;
  const field = spawn.when?.field ?? schema.completionField;
  const values = spawn.when?.in ?? schema.completionDoneValues;
  if (!field || !values) return true; // predicate not evaluable — other rules cover this
  if (spawn.set && Object.prototype.hasOwnProperty.call(spawn.set, field)) {
    return !values.includes(String(spawn.set[field])); // `set` wins over `carry`
  }
  return !(spawn.carry ?? []).includes(field); // carried ⇒ inherits the matching value
}

/** `spawnSuccessorStartsInert` cannot see through a flag's `where` (the
 *  predicate would need full record evaluation against `set`/`carry`). So a
 *  schema whose completion is flag-form may only spawn with an explicit
 *  `spawn.when` — which that check CAN evaluate. */
export function flagCompletionSpawnDeclaresWhen(schema: Schema): boolean {
  return schema.spawn === undefined || schema.spawn.when !== undefined || declaredField(schema.fields, schema.completionField ?? "")?.type !== "flag";
}

// Resolve the field-driven arm of `spawn.every`, or null when spawn is absent
// or its `every` is the literal arm. Lets each rule below short-circuit
// (return valid) without re-checking the discriminant.
function fieldDrivenSpawnEvery(schema: Schema) {
  const every = schema.spawn?.every;
  if (!every || !("fromField" in every)) return null;
  return every;
}

/** §4.1 — `fromField` must name a real top-level `enum` field. The `map` keys
 *  are only meaningful against a closed value set, and the field renders as a
 *  form `<select>`; a non-enum target has no finite values to validate. */
export function fieldDrivenFromFieldIsEnum(schema: Schema): boolean {
  const driven = fieldDrivenSpawnEvery(schema);
  if (!driven) return true;
  return declaredField(schema.fields, driven.fromField)?.type === "enum";
}

/** §4.2 — `map` keys must EXACTLY cover the enum's `values` (no missing keys —
 *  a record could pick an unmapped frequency and silently stall; no extra keys
 *  — a stale map outliving an enum edit). */
export function fieldDrivenMapCoversValues(schema: Schema): boolean {
  const driven = fieldDrivenSpawnEvery(schema);
  if (!driven) return true;
  const target = declaredField(schema.fields, driven.fromField);
  if (target?.type !== "enum") return true; // §4.1 reports the type error
  const values = new Set<string>(target.values);
  const keys = Object.keys(driven.map);
  return keys.length === values.size && keys.every((key) => values.has(key));
}

/** §4.5 — `fromField` must reach the successor (via `carry` or `set`);
 *  otherwise the successor loses its frequency and the NEXT spawn along the
 *  chain can't resolve an interval, silently halting the recurrence.
 *
 *  `set` writes a FIXED value, so it must itself be a key of `map` (else the
 *  successor is born with an unresolvable driver and `resolveEvery` skips it —
 *  the exact silent-halt §4.5 exists to prevent). `carry` copies the source's
 *  own value, which — for a record that matched the spawn — is one of the
 *  enum's values, all of which `map` covers by §4.2; so a carried driver is
 *  always resolvable and needs no value check here. */
export function fieldDrivenFromFieldCarried(schema: Schema): boolean {
  const driven = fieldDrivenSpawnEvery(schema);
  if (!driven) return true;
  const { carry, set } = schema.spawn ?? {};
  if (set && Object.prototype.hasOwnProperty.call(set, driven.fromField)) {
    const raw = set[driven.fromField];
    if (raw === undefined || raw === null || raw === "") return false;
    const key = fieldTextOrNull(raw);
    return key !== null && Object.prototype.hasOwnProperty.call(driven.map, key);
  }
  return (carry ?? []).includes(driven.fromField);
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

/** `calendarField` must name a real `date`/`datetime` field — the calendar view
 *  parses its value to place records on the month grid (a `datetime` anchor
 *  also carries the clock for the day view). */
export function calendarFieldIsDateLike(schema: Schema): boolean {
  return schema.calendarField === undefined || isDateLike(declaredField(schema.fields, schema.calendarField)?.type);
}

/** `calendarEndField` marks the end of a multi-day span, so it only means
 *  something alongside a start anchor. */
export function calendarEndFieldRequiresCalendarField(schema: Schema): boolean {
  return schema.calendarEndField === undefined || schema.calendarField !== undefined;
}

/** `calendarEndField` must also name a real `date`/`datetime` field — same parse. */
export function calendarEndFieldIsDateLike(schema: Schema): boolean {
  return schema.calendarEndField === undefined || isDateLike(declaredField(schema.fields, schema.calendarEndField)?.type);
}

/** `calendarTimeField` places records on the day view, so it only means
 *  something alongside a start anchor. */
export function calendarTimeFieldRequiresCalendarField(schema: Schema): boolean {
  return schema.calendarTimeField === undefined || schema.calendarField !== undefined;
}

/** `calendarTimeField` must name a real top-level field (a free-form time
 *  string the day view parses). */
export function calendarTimeFieldIsDeclared(schema: Schema): boolean {
  return schema.calendarTimeField === undefined || declaredField(schema.fields, schema.calendarTimeField) !== undefined;
}

/** …and that field must be string-backed — the day view parses its value as a
 *  time string, so a number/enum/date column can't drive it. */
export function calendarTimeFieldIsStringBacked(schema: Schema): boolean {
  return schema.calendarTimeField === undefined || isTimeStringField(declaredField(schema.fields, schema.calendarTimeField)?.type);
}

/** `kanbanField` must name a real `enum` field — the board groups records into
 *  one column per declared enum value; any other type has no closed set of
 *  columns to group by. */
export function kanbanFieldIsAnEnum(schema: Schema): boolean {
  return schema.kanbanField === undefined || declaredField(schema.fields, schema.kanbanField)?.type === "enum";
}

// ---------------------------------------------------------------------------
// notifyWhen, custom views
// ---------------------------------------------------------------------------

/** `notifyWhen` narrows the completion bell, so it only means something with
 *  completion tracking. */
export function notifyWhenRequiresCompletion(schema: Schema): boolean {
  return schema.notifyWhen === undefined || schema.completionField !== undefined;
}

/** `notifyWhen.field` must name a real top-level field. */
export function notifyWhenFieldIsDeclared(schema: Schema): boolean {
  return schema.notifyWhen === undefined || declaredField(schema.fields, schema.notifyWhen.field) !== undefined;
}

/** Every custom view `id` must be a valid slug — it doubles as the view-mode
 *  selector key (`custom:<id>`) and the capability-token clamp key, both of
 *  which expect a path-safe token. */
export function viewIdsAreSlugs(schema: Schema): boolean {
  return schema.views === undefined || schema.views.every((view) => isSafeSlug(view.id));
}

/** Custom view ids must be unique so the selector + token clamp resolve
 *  unambiguously. */
export function viewIdsAreUnique(schema: Schema): boolean {
  return hasUniqueIds(schema.views);
}
