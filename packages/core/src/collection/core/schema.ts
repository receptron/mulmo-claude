// Schema-driven collection types. A "collection" is a skill (under
// .claude/skills/<slug>/) that also ships a sibling `schema.json`.
// The host's <CollectionView> reads the schema + records and renders
// a table/form; Claude reads SKILL.md and CRUDs the records as JSON
// files.
//
// SINGLE SOURCE OF TRUTH: every type describing the schema.json contract is
// derived (`z.infer`) from the zod definitions in `./schemaZ` — the shapes,
// their doc comments, and the validation rules live THERE; this module only
// re-derives the TypeScript names consumers import. The imports from
// `./schemaZ` are type-only, so zod never reaches the browser bundle through
// the isomorphic barrel; at runtime the dependency points the other way
// (schemaZ imports this module's consts).
//
// Field specs are a DISCRIMINATED UNION on `type`: narrow with
// `field.type === "enum"` (etc.) before reading a variant key like `values`,
// `to`, `formula`, or `of`.

import { fieldText } from "./fieldText";
import type { z } from "zod";
import type {
  ActionSpecZ,
  CollectionSchemaZ,
  CustomViewZ,
  DataSourceZ,
  DynamicIconRuleZ,
  DynamicIconSourceZ,
  DynamicIconSpecZ,
  EveryFieldDrivenZ,
  EveryLiteralZ,
  EveryZ,
  FieldSpecZ,
  IngestZ,
  SpawnZ,
  StorageZ,
  SubFieldSpecZ,
  WhenZ,
} from "./schemaZ";

/** Minimal "this collection is a feed" descriptor carried on the schema.
 *  Deliberately narrow — the canonical collection contract stays
 *  independent of the host's feeds subsystem. The host's richer retrieval
 *  spec (`IngestSpec` in `feeds/ingestTypes.ts`) is a subtype, so feed code
 *  reads the extra fields by typing feed schemas with that subtype;
 *  collection rendering only needs these three + the presence check. */
export interface CollectionIngest {
  kind: string;
  schedule: string;
  /** Optional time-of-day anchor for `schedule: "daily"` — the hour (0–23) to
   *  refresh around (the host ticks hourly, so the run lands within that hour).
   *  Ignored for non-daily schedules. Absent ⇒ elapsed-based daily ("≥24 h since
   *  the last run"). NOTE: **UTC**, not local — compared via `getUTCHours()` for
   *  an unambiguous, DST-free check (matching the rest of the scheduler), so
   *  convert local times before writing (e.g. 07:00 JST → `atHour: 22`). */
  atHour?: number;
  /** Declarative retrievers (`rss`/`atom`/`http-json`) only — the host fetches
   *  this URL on the schedule. Absent for `kind: "agent"`, where the agent owns
   *  retrieval. */
  url?: string;
  /** `kind: "agent"` only: role id the scheduled hidden worker runs in. */
  role?: string;
  /** `kind: "agent"` only: skill-relative template path (under `templates/`)
   *  whose prose tells the worker how to refresh the records. */
  template?: string;
}

/** Declarative retriever kinds a Feed's `ingest.kind` may declare. The host's
 *  feeds engine dispatches on these; they live here (with the schema contract)
 *  so the schema validator can enforce them. The host re-exports these from
 *  `server/workspace/feeds/ingestTypes.ts`. */
export const INGEST_KINDS = ["rss", "atom", "http-json"] as const;
export type IngestKind = (typeof INGEST_KINDS)[number];

/** The agent-performed ingest kind. Instead of a declarative fetch, the host
 *  dispatches a hidden background chat (origin `system`) in `ingest.role`,
 *  seeded with `ingest.template` + a summary of every record, on the
 *  `ingest.schedule` cadence; the worker edits records via the collections io
 *  layer. Kept separate from {@link INGEST_KINDS} (which the declarative
 *  retriever registry keys on) so the schema validator can model `ingest` as a
 *  discriminated union without the feeds engine gaining an "agent" retriever. */
export const AGENT_INGEST_KIND = "agent" as const;
export type AgentIngestKind = typeof AGENT_INGEST_KIND;

/** Refresh cadences a Feed's `ingest.schedule` may declare. */
export const FEED_SCHEDULES = ["hourly", "daily", "weekly", "on-demand"] as const;
export type FeedSchedule = (typeof FEED_SCHEDULES)[number];

// "feed" collections live in the non-skill `<workspace>/feeds/` registry
// and carry an `ingest` block; they reuse the same storage + rendering
// as skill-backed collections but are never loaded into the agent prompt.
export type CollectionSource = "user" | "project" | "feed";

/** One field of a record — a discriminated union on `type`; see the variant
 *  docs in `./schemaZ` (`FieldSpecZ`). */
export type CollectionFieldSpec = z.infer<typeof FieldSpecZ>;

/** A `table` field's row sub-schema entry — the field union minus `table` /
 *  `derived` / display-only types (see `SubFieldSpecZ`). */
export type CollectionSubFieldSpec = z.infer<typeof SubFieldSpecZ>;

export type CollectionFieldType = CollectionFieldSpec["type"];

/** The computed-boolean variant — a `where` predicate bound to a field
 *  name; see `FlagFieldZ`. */
export type CollectionFlagField = Extract<CollectionFieldSpec, { type: "flag" }>;

/** derived/embed/backlinks/rollup/toggle/flag are host-computed or
 *  projected — never written to the record JSON, so required / value
 *  checks and edit-draft slots must not apply to them. THE single source
 *  for "computed" — lives here (zod-free at runtime) so browser code
 *  (`./draft`) and the zod record compiler (`./recordZ`, which re-exports
 *  it) share one set instead of drifting copies. */
export const COMPUTED_TYPES: ReadonlySet<CollectionFieldType> = new Set<CollectionFieldType>(["derived", "embed", "backlinks", "rollup", "toggle", "flag"]);

/** Optional visibility predicate: the target (an action button or a
 *  field) renders only when the open record's `field` (stringified) is
 *  one of `in`. Generic and domain-free — the host evaluates it against
 *  the record with no knowledge of what the field means. Absent ⇒
 *  always shown. */
export type CollectionWhen = z.infer<typeof WhenZ>;

/** @deprecated Name retained for back-compat; use {@link CollectionWhen}.
 *  Both actions and fields share the same predicate shape. No in-repo
 *  consumers, but the package is public API (MulmoTerminal). */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- deliberate deprecated back-compat export
export type CollectionActionWhen = CollectionWhen;

/** A schema-declared, per-record action rendered as a button in the
 *  read-only detail view. Pure UI/behaviour directive — never stored,
 *  never validated against record data. All domain specifics (label,
 *  role, template — or the declarative `set`) live in the schema / skill
 *  folder, so the host stays generic. A discriminated union on `kind`;
 *  see `ActionSpecZ`. */
export type CollectionAction = z.infer<typeof ActionSpecZ>;

/** The kind of work an action kicks off: `"chat"` (visible LLM chat),
 *  `"agent"` (hidden LLM worker), or `"mutate"` (declarative host write,
 *  no LLM). */
export type CollectionActionKind = CollectionAction["kind"];

/** The LLM-seeded action variants (`role` + `template`). */
export type CollectionSeededAction = Extract<CollectionAction, { kind: "chat" | "agent" }>;

/** The declarative host-write variant (`set` + optional `require`/`params`). */
export type CollectionMutateAction = Extract<CollectionAction, { kind: "mutate" }>;

/** A custom (LLM-authored) HTML view for a collection. The host renders
 *  `file` in a sandboxed iframe over the collection's records; the view
 *  reaches its data only through a slug- and capability-scoped token (see
 *  `server/api/auth/viewToken.ts`). Pure data — the host holds no
 *  view-specific code; meaning lives in the HTML file + this registration.
 *  See `CustomViewZ` for the per-key contracts. */
export type CollectionCustomView = z.infer<typeof CustomViewZ>;

/** What a custom view's capability token is allowed to do against the
 *  collection's data endpoint. `read` returns enriched records (getItems
 *  semantics); `write` validates-and-stores rows (putItems semantics).
 *  There is deliberately no `delete` — a view can never do more than the
 *  agent's own `manageCollection` tool. */
export type CollectionViewCapability = NonNullable<CollectionCustomView["capabilities"]>[number];

/** How a `spawn` advances the source item's `triggerField` date to
 *  produce the successor's. All arithmetic is done on the civil
 *  (year, month, day) triple — never by adding milliseconds — so month
 *  lengths and leap years are handled correctly. */
export type CollectionEvery = z.infer<typeof EveryLiteralZ>;

/** Recurrence unit for a `spawn.every` advance. */
export type CollectionRecurUnit = CollectionEvery["unit"];

/** Field-driven recurrence: the advance interval is selected PER RECORD by
 *  the value of an `enum` field (`fromField`), looked up in `map`. See
 *  `EveryFieldDrivenZ`. */
export type CollectionEveryFieldDriven = z.infer<typeof EveryFieldDrivenZ>;

/** The `every` of a `spawn`: either a single literal interval applied to
 *  every record, or a per-record interval selected by an `enum` field. The
 *  literal arm is what `advanceTriggerDate` consumes — the field-driven arm
 *  is resolved down to one of its `map` values before the date math runs. */
export type CollectionSpawnEvery = z.infer<typeof EveryZ>;

/** Narrowing guard: true when `every` is the field-driven arm. */
export function isFieldDrivenEvery(every: CollectionSpawnEvery): every is CollectionEveryFieldDriven {
  return "fromField" in every;
}

/** Host-driven recurrence. See `SpawnZ`. */
export type CollectionSpawn = z.infer<typeof SpawnZ>;

/** One rule in a `dynamicIcon.rules` list: when the resolved source
 *  record matches `where` (an AND of typed conditions, see `./where`),
 *  the collection's effective launcher icon becomes `icon`. Evaluated top
 *  to bottom — the first match wins. */
export type DynamicIconRule = z.infer<typeof DynamicIconRuleZ>;

/** Where a {@link DynamicIconSpec}'s source record comes from: a (possibly
 *  cross-collection) pool of records, optionally narrowed by `where` and
 *  reduced to a single record by `from`. */
export type DynamicIconSource = z.infer<typeof DynamicIconSourceZ>;

/** Declarative "data state → icon" mapping for a collection's launcher
 *  shortcut icon (see `CollectionSchema.dynamicIcon`). When absent, the
 *  launcher icon is the static `schema.icon`. */
export type DynamicIconSpec = z.infer<typeof DynamicIconSpecZ>;

/** The `ingest` block as the schema validator accepts it — a discriminated
 *  union on `kind` (declarative retrievers | agent worker). The feeds
 *  subsystem's `IngestSpec` is the same union under its historical name. */
export type CollectionIngestSpec = z.infer<typeof IngestZ>;

/** The `dataSource` block: this collection's records are the rows of an
 *  external read-only data file (v1: CSV). See `DataSourceZ`. */
export type CollectionDataSource = z.infer<typeof DataSourceZ>;

/** The `storage` block: an alternative WRITABLE record backend (v1:
 *  sqlite). See `StorageZ`. */
export type CollectionStorage = z.infer<typeof StorageZ>;

/** Every storage backend a schema can select. `file` is the implicit
 *  default (`dataPath`); `csv` is implied by `dataSource`; other kinds are
 *  named explicitly via `storage.type`. The server's store factory registry
 *  (`server/store.ts`) is keyed by this. */
export type CollectionStorageKind = "file" | "csv" | "sqlite" | "firestore";

/** Which storage backend serves this schema's records. Derived, not stored:
 *  existing schemas carry no `storage` key and must keep resolving exactly
 *  as before (`dataSource` ⇒ csv, else file). */
export function storageKindFor(schema: Pick<CollectionSchema, "dataSource" | "storage">): CollectionStorageKind {
  if (schema.dataSource !== undefined) return "csv";
  return schema.storage?.type ?? "file";
}

/** The whole `schema.json` contract. Key-level docs live on
 *  `CollectionSchemaZ` in `./schemaZ`. */
export type CollectionSchema = z.infer<typeof CollectionSchemaZ>;

/** True when `schema` declares an external `dataSource` — i.e. the
 *  collection is READ-ONLY through every UI/tool write path (updates
 *  happen by editing/replacing the data file itself). Isomorphic: both
 *  the server write guards and the client's control hiding key off this
 *  one predicate. */
export function isReadOnlySchema(schema: Pick<CollectionSchema, "dataSource">): boolean {
  return schema.dataSource !== undefined;
}

export interface CollectionSummary {
  slug: string;
  title: string;
  icon: string;
  source: CollectionSource;
  /** Present (true) when the collection is backed by an external
   *  `dataSource` and therefore read-only in every UI/tool write path.
   *  Absent-when-writable, matching the other optional summary flags. */
  readonly?: true;
  /** Slugs of the source collection(s) a `dynamicIcon` icon was computed
   *  from — present only when `schema.dynamicIcon` is set. Lets a client
   *  know which collection change-channel(s) to watch for a live icon
   *  update (see `useDynamicShortcutIcons`). */
  iconSources?: string[];
}

export interface CollectionDetail extends CollectionSummary {
  schema: CollectionSchema;
}

export type CollectionItem = Record<string, unknown>;

/** Resolve an `embed` field's target record id: the fixed `id`, or the value
 *  of the sibling `idField` on this record (empty string when neither applies
 *  — the caller renders that as "no record"). Pure + isomorphic so the server
 *  projection (`derive.ts`) and the client preview (`useCollectionRendering`)
 *  resolve embeds identically. Non-`embed` fields resolve to "no record". */
export function embedTargetId(field: CollectionFieldSpec, record: CollectionItem | null): string {
  if (field.type !== "embed") return "";
  if (field.id) return field.id;
  if (field.idField && record) return fieldText(record[field.idField]);
  return "";
}
