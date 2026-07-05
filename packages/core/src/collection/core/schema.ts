// Schema-driven collection types. A "collection" is a skill (under
// .claude/skills/<slug>/) that also ships a sibling `schema.json`.
// The host's <CollectionView> reads the schema + records and renders
// a table/form; Claude reads SKILL.md and CRUDs the records as JSON
// files.
//
// Field types for v0 — keep this list narrow and grow it only when a
// real collection needs the new type. v0 supports flat records only;
// nested tables / cross-collection refs / derived fields / actions are
// deferred to follow-ups (see plans/done/feat-skill-driven-apps.md and
// plans/done/feat-skill-driven-apps-worklog.md — historical names predate
// the rename).

import type { Where } from "./where";

/** Minimal "this collection is a feed" descriptor carried on the schema.
 *  Deliberately narrow — the canonical collection contract stays
 *  independent of the host's feeds subsystem. The host's richer retrieval
 *  spec (`IngestSpec` in `server/workspace/feeds/ingestTypes.ts`)
 *  `extends CollectionIngest`, so feed code reads the extra fields by
 *  typing feed schemas with that subtype; collection rendering only needs
 *  these three + the presence check. */
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

export type CollectionFieldType =
  | "string"
  | "text"
  | "email"
  | "number"
  | "date"
  | "datetime"
  | "boolean"
  | "markdown"
  | "ref"
  | "money"
  | "enum"
  | "table"
  | "derived"
  | "embed"
  // Holds a workspace-relative image path (e.g. a `data/attachments/...`
  // upload); rendered as an <img> in the detail view (not the list table —
  // a per-row fetch is too expensive at scale). Stored and edited as a
  // plain string.
  | "image"
  // Holds a workspace-relative file path as a plain string (e.g. an
  // `artifacts/html/<name>.html` app). Rendered as a clickable link in
  // both the list table and the detail view: HTML / SVG artifacts open
  // their rendered form in a new tab; any other path opens in the File
  // Explorer. Stored and edited as a plain string, like `image`.
  | "file"
  // A checkbox that is a pure PROJECTION of an `enum` field — it stores
  // nothing of its own. Checked when the enum equals `onValue`; toggling
  // writes `onValue` / `offValue` back to that enum field. Lets a "done"
  // checkbox front a kanban `status` field with the enum as the single
  // source of truth (no separate stored boolean to keep in sync).
  | "toggle";

// "feed" collections live in the non-skill `<workspace>/feeds/` registry
// and carry an `ingest` block; they reuse the same storage + rendering
// as skill-backed collections but are never loaded into the agent prompt.
export type CollectionSource = "user" | "project" | "feed";

/** Recurrence unit for a `spawn.every` advance. */
export type CollectionRecurUnit = "day" | "week" | "month" | "year";

/** How a `spawn` advances the source item's `triggerField` date to
 *  produce the successor's. All arithmetic is done on the civil
 *  (year, month, day) triple — never by adding milliseconds — so month
 *  lengths and leap years are handled correctly. */
export interface CollectionEvery {
  unit: CollectionRecurUnit;
  /** Number of `unit`s to advance (≥ 1). `interval: 3` + `unit: "month"`
   *  = quarterly; `interval: 1` + `unit: "year"` = annual. */
  interval: number;
  /** Day-of-month anchor for `month`/`year` units. The CANONICAL day —
   *  read from the rule, never re-derived from the prior concrete date,
   *  so "31st of every month" yields 31 → 28/29 → 31 → 30 … with no
   *  drift (it is clamped per-month at compute time, not stored
   *  clamped). `"last"` always means the last day of the target month.
   *  Omitted ⇒ preserve the source date's day (safe for days ≤ 28).
   *  Ignored for `day`/`week` units. */
  dayOfMonth?: number | "last";
}

/** Field-driven recurrence: the advance interval is selected PER RECORD by
 *  the value of an `enum` field (`fromField`), looked up in `map`. Lets one
 *  collection mix daily / weekly / monthly obligations in a single list — the
 *  host reads `record[fromField]`, finds the matching `CollectionEvery`, and
 *  advances by it. `fromField` must point at a top-level `enum` field whose
 *  `values` the `map` keys exactly cover (validated at discovery), and must
 *  itself be carried/`set` onto the successor so the chain keeps recurring. */
export interface CollectionEveryFieldDriven {
  /** Top-level `enum` field whose value selects the interval. */
  fromField: string;
  /** Interval per enum value. Keys exactly cover `fromField`'s `values`;
   *  each value is a literal {@link CollectionEvery}. */
  map: Record<string, CollectionEvery>;
}

/** The `every` of a `spawn`: either a single literal interval applied to
 *  every record, or a per-record interval selected by an `enum` field. The
 *  literal arm is what `advanceTriggerDate` consumes — the field-driven arm
 *  is resolved down to one of its `map` values before the date math runs. */
export type CollectionSpawnEvery = CollectionEvery | CollectionEveryFieldDriven;

/** Narrowing guard: true when `every` is the field-driven arm. */
export function isFieldDrivenEvery(every: CollectionSpawnEvery): every is CollectionEveryFieldDriven {
  return "fromField" in every;
}

/** Host-driven recurrence: when a record satisfies `when`, the host
 *  creates the next record with a forward-advanced `triggerField` date.
 *  The successor's id and contents are a pure function of (source
 *  record, this rule); creation is create-if-absent, so the mechanism
 *  stays convergent — observing the predicate N times writes one
 *  successor. Requires the schema to declare `triggerField`. */
export interface CollectionSpawn {
  /** Predicate that fires the spawn (a `CollectionWhen`). Defaults to
   *  "`completionField` value ∈ `completionDoneValues`" (i.e. spawn the
   *  next instance when this one is done). */
  when?: CollectionWhen;
  /** How to advance `triggerField` from the source to the successor —
   *  either a single literal interval or a per-record, field-driven map. */
  every: CollectionSpawnEvery;
  /** Record fields copied verbatim onto the successor. Fields not listed
   *  here, not in `set`, and not the trigger / primary keys start
   *  blank. */
  carry?: string[];
  /** Fields forced to fixed values on the successor (typically resetting
   *  the status field to its pending value). */
  set?: Record<string, unknown>;
}

/** The kind of work an action kicks off. v1 ships only `"chat"` —
 *  start a new chat in a role with a templated seed prompt. The enum
 *  reserves room for a future `"mutate"` (status transitions) without
 *  another schema-shape change. */
export type CollectionActionKind = "chat";

/** Optional visibility predicate: the target (an action button or a
 *  field) renders only when the open record's `field` (stringified) is
 *  one of `in`. Generic and domain-free — the host evaluates it against
 *  the record with no knowledge of what the field means. Absent ⇒
 *  always shown. */
export interface CollectionWhen {
  /** Top-level record field key whose value gates visibility. */
  field: string;
  /** Allowed values; the target shows when `String(record[field])` is
   *  one of these. Non-empty. */
  in: string[];
}

/** @deprecated Name retained for back-compat; use {@link CollectionWhen}.
 *  Both actions and fields share the same predicate shape. */
export type CollectionActionWhen = CollectionWhen;

/** What a custom view's capability token is allowed to do against the
 *  collection's data endpoint. `read` returns enriched records (getItems
 *  semantics); `write` validates-and-stores rows (putItems semantics).
 *  There is deliberately no `delete` — a view can never do more than the
 *  agent's own `manageCollection` tool. */
export type CollectionViewCapability = "read" | "write";

/** A custom (LLM-authored) HTML view for a collection. The host renders
 *  `file` in a sandboxed iframe over the collection's records; the view
 *  reaches its data only through a slug- and capability-scoped token (see
 *  `server/api/auth/viewToken.ts`). Pure data — the host holds no
 *  view-specific code; meaning lives in the HTML file + this registration. */
export interface CollectionCustomView {
  /** Stable id; the view-mode selector key (`custom:<id>`) and the
   *  capability-token clamp key. Must be a valid slug. */
  id: string;
  /** Button label in the view-mode selector (author-authored, like field
   *  labels — not run through i18n). */
  label: string;
  /** Optional Material-icon name for the selector button. */
  icon?: string;
  /** Skill-relative path to the HTML file under `views/` (e.g.
   *  `views/year.html`). Path-safe, must end in `.html`. */
  file: string;
  /** Optional skill-relative path to a JSON translation dictionary co-located
   *  with the view (e.g. `views/year.i18n.json`). Shape mirrors **vue-i18n
   *  locale messages** so an author can lift their app's locale JSON
   *  verbatim:
   *
   *  ```json
   *  { "en": { "next": "Next", "hello": "Hello, {name}" },
   *    "ja": { "next": "次へ", "hello": "{name} さん、こんにちは" } }
   *  ```
   *
   *  The host picks the block matching the active app locale (fallback
   *  `"en"`, else `{}`) and injects ONLY that flat string map into
   *  `window.__MC_VIEW.dict`. The iframe-side helper
   *  `__MC_VIEW.t(key, named?)` mirrors vue-i18n's `t('msg', { name: 'x' })`
   *  signature — named-interpolation only (no pluralization / linked
   *  messages in v1; shipping vue-i18n's full runtime into every sandboxed
   *  iframe would dominate page weight). The view never sees other locales'
   *  strings. Constrained to `views/*.i18n.json` so authors keep the
   *  translation file next to the HTML it translates. Absent ⇒ host-side
   *  no-op (an i18n-less view keeps working; `t(key)` echoes the key). */
  i18n?: string;
  /** What the view may do with the data endpoint. Defaults to `["read"]`
   *  (least privilege); declare `["read","write"]` only for views that
   *  edit records. The mint endpoint clamps any requested caps to this. */
  capabilities?: CollectionViewCapability[];
  /** Where the view runs. Absent ⇒ `"desktop"` (this token/dataUrl contract).
   *  `"mobile"` ⇒ a remote view for the phone client: served through the
   *  command channel's `getRemoteView` over the postMessage contract
   *  (`@mulmoclaude/core/remote-view` — no token, `connect-src 'none'`) and
   *  previewed on desktop inside a phone-sized frame. */
  target?: "desktop" | "mobile";
  /** **Mobile-only** (ignored for desktop views, which use token-scoped
   *  `capabilities`). The whitelist of field names a `target: "mobile"` view
   *  may patch via `__MC_VIEW.updateItem(id, patch)`. Default-deny: absent or
   *  empty ⇒ updates are refused host-side. Never include the primary key.
   *  See plans/feat-remote-writable-view.md. */
  editableFields?: string[];
  /** **Mobile-only.** When `true`, a `target: "mobile"` view may remove a
   *  record via `__MC_VIEW.deleteItem(id)`. Absent/`false` ⇒ deletes refused. */
  allowDelete?: boolean;
  /** **Mobile-only.** `image`-type fields whose workspace path the host inlines
   *  as a downscaled `data:` URL thumbnail in `getItems` pages, so they render
   *  on the phone (which can't reach the host's localhost). Opt-in (absent ⇒
   *  none); the host projects `fields` first and only inlines the declared
   *  fields that survive, within a per-page byte budget. Ignored for desktop
   *  views (they resolve via `/api/files/raw`). See plans/feat-remote-view-images.md. */
  imageFields?: string[];
  /** **Mobile-only.** Longest-edge (px) an inlined `imageFields` thumbnail is
   *  downscaled to. Absent ⇒ 512, clamped to `[64, 1024]`. */
  imageMaxEdge?: number;
}

/** A schema-declared, per-record action rendered as a button in the
 *  read-only detail view. Pure UI/behaviour directive — never stored,
 *  never validated against record data. All domain specifics (label,
 *  role, template) live here in the schema / skill folder, so the host
 *  stays generic. */
export interface CollectionAction {
  /** Stable id (used in the dispatch route + testids). */
  id: string;
  /** Button text (English, like field labels). */
  label: string;
  /** Material-icon name shown on the button. */
  icon?: string;
  /** What the action does. v1: `"chat"`. */
  kind: CollectionActionKind;
  /** `kind: "chat"`: the role id the new chat runs in. */
  role: string;
  /** `kind: "chat"`: skill-relative path to the template file whose
   *  text becomes the seed prompt body (e.g. `templates/invoice.md`). */
  template: string;
  /** Optional visibility predicate; the button renders only when the
   *  open record matches (see CollectionWhen). Absent ⇒ always
   *  shown. */
  when?: CollectionWhen;
}

/** One rule in a `dynamicIcon.rules` list: when the resolved source
 *  record matches `where` (an AND of typed conditions, see {@link Where}),
 *  the collection's effective launcher icon becomes `icon`. Evaluated top
 *  to bottom — the first match wins. */
export interface DynamicIconRule {
  where: Where;
  icon: string;
}

/** Where a {@link DynamicIconSpec}'s source record comes from: a (possibly
 *  cross-collection) pool of records, optionally narrowed by `where` and
 *  reduced to a single record by `from`. */
export interface DynamicIconSource {
  /** Slug of the collection to read records from — the collection itself
   *  (self-reference) or another one (cross-collection). Required. */
  collection: string;
  /** How to reduce the (optionally `where`-filtered) pool to one record.
   *  `"latest"` (default): the record with the greatest `orderBy` value.
   *  `"first"` / `"when"`: the first record in the pool (storage order). */
  from?: "latest" | "first" | "when";
  /** Field compared for `from: "latest"`. Defaults to the source schema's
   *  first `date`/`datetime` field (declaration order); when the source
   *  has none, `"latest"` falls back to the last pool record. */
  orderBy?: string;
  /** Optional predicate (AND of typed conditions) narrowing the pool
   *  before `from` reduces it to one record (e.g. restrict a shared
   *  weather collection to one region). */
  where?: Where;
}

/** Declarative "data state → icon" mapping for a collection's launcher
 *  shortcut icon (see `CollectionSchema.dynamicIcon`). When absent, the
 *  launcher icon is the static `schema.icon`, unchanged from before this
 *  field existed. */
export interface DynamicIconSpec {
  /** The record the `rules` are evaluated against. Required. */
  source: DynamicIconSource;
  /** First-match-wins list of "resolved record matches `where` → `icon`"
   *  rules. */
  rules: DynamicIconRule[];
  /** Icon used when no source record resolves or no rule matches.
   *  Defaults to the collection's own static `schema.icon`. */
  fallback?: string;
}

export interface CollectionFieldSpec {
  type: CollectionFieldType;
  label: string;
  /** True for the field whose value is the record's filename (no
   *  separate auto-id). Exactly one field per schema may set this. */
  primary?: boolean;
  required?: boolean;
  /** When `type === "ref"` or `type === "embed"`: the slug of the
   *  target collection. For `ref` the record stores the target
   *  item's primary-key slug and the host renders a clickable link
   *  + dropdown picker. For `embed` the host pulls a *fixed* record
   *  (see `id`) from the target and renders its fields read-only in
   *  the detail view. Required for both; ignored on every other
   *  type. */
  to?: string;
  /** When `type === "embed"`: the primary-key value of the fixed
   *  record to pull from the `to` collection (e.g. `me` for the
   *  singleton mc-profile). Nothing is stored on this record — the
   *  embed is a display-only directive resolved at render time, so
   *  it never appears in the list table or the edit form. Supply
   *  either this (a fixed target, same for every record) or
   *  `idField` (a per-record target) — exactly one. Ignored on every
   *  other type. */
  id?: string;
  /** When `type === "embed"`: the name of a sibling top-level field
   *  whose value names the target record's primary key — letting the
   *  embed point at a *different* record per row (e.g. an invoice's
   *  `issuerId` ref selects which `profile` to embed as the
   *  bill-from block). The renderer reads `record[idField]` at render
   *  time; an absent/empty value resolves to "no record" (the same
   *  fail-soft as a missing fixed `id`). Mutually exclusive with `id`
   *  — an embed must declare exactly one. Ignored on every other type. */
  idField?: string;
  /** When `type === "money"` (or `type === "derived"` with
   *  `display: "money"`): a literal ISO 4217 currency code passed to
   *  `Intl.NumberFormat` for display — fixed for every record. The
   *  stored value is always a plain decimal number; currency is
   *  presentation only. Mutually substitutable with `currencyField`:
   *  a money field must declare at least one of the two. */
  currency?: string;
  /** When `type === "money"` (or `type === "derived"` with
   *  `display: "money"`): the name of a sibling record field whose
   *  value holds the ISO 4217 code, letting currency vary per record
   *  (e.g. an invoice's `currency` enum). The renderer reads
   *  `record[currencyField]` and falls back to the literal `currency`
   *  (then "USD") when the field is absent or empty. Resolved against
   *  the top-level record even for money sub-fields inside a table. */
  currencyField?: string;
  /** When `type === "enum"`: the closed set of allowed string
   *  values. The form renders a `<select>` populated from this
   *  list; storage is a plain string. Required when type is
   *  `enum`; ignored on every other type. */
  values?: readonly string[];
  /** When `type === "table"`: the sub-schema for each row (a flat
   *  record of non-table / non-derived field specs). Required when
   *  type is `table`. v0 disallows nested tables and derived
   *  columns to keep the editor + evaluator simple. */
  of?: Record<string, CollectionFieldSpec>;
  /** When `type === "derived"`: a tiny expression evaluated against
   *  the record. Supports `+ - * /`, parens, identifier refs to
   *  top-level fields, `sum(tableField[].col)`, and
   *  `sum(tableField[].col * tableField[].col)`. See
   *  `src/utils/collections/derivedFormula.ts`. Required when type
   *  is `derived`. */
  formula?: string;
  /** When `type === "derived"`: an inner field type the computed
   *  value should be rendered as (e.g. `"money"` so $1,234.56 is
   *  formatted). Defaults to `"number"`. */
  display?: CollectionFieldType;
  /** Optional visibility predicate: this field renders only when the
   *  record matches (e.g. hide a `rating` field until `visited` is
   *  `true` via `{ field: "visited", in: ["true"] }`). Applies to the
   *  list cell (blank when hidden), the edit form (hidden live as the
   *  gating field changes), and the detail view. Purely presentational
   *  — a hidden field's stored value is never cleared. `when.field`
   *  must name another top-level field. Absent ⇒ always shown. Only
   *  honoured on top-level fields, not inside a `table`'s `of`. */
  when?: CollectionWhen;
  /** When `type === "toggle"`: the name of the top-level `enum` field this
   *  checkbox projects. The toggle stores nothing itself — it reads and
   *  writes this field. Required when type is `toggle`; ignored otherwise.
   *  Must name a real `enum` field. */
  field?: string;
  /** When `type === "toggle"`: the enum value that means "checked". The
   *  box is checked when the projected `field` equals this; checking writes
   *  it. Required when type is `toggle`; must be one of the enum's `values`. */
  onValue?: string;
  /** When `type === "toggle"`: the enum value written when the box is
   *  unchecked. Required when type is `toggle`; must be one of the enum's
   *  `values`. */
  offValue?: string;
}

export interface CollectionSchema {
  /** Human-facing collection name (sidebar, header). */
  title: string;
  /** Material-icon name shown next to the title. */
  icon: string;
  /** Workspace-relative folder holding one-JSON-per-record. Validated
   *  to live under the workspace root at load time. */
  dataPath: string;
  /** Field name whose value doubles as the record's filename. */
  primaryKey: string;
  /** When set, the collection is a singleton: at most one record,
   *  whose primary key is fixed to this value (e.g. `me` for the
   *  business profile). The host pre-fills + locks the create form's
   *  primary key and hides Add once the record exists. */
  singleton?: string;
  /** Ordered map: insertion order = column order in the table view. */
  fields: Record<string, CollectionFieldSpec>;
  /** Optional per-record actions rendered as buttons in the detail
   *  view (e.g. "Generate PDF"). Order = button order. */
  actions?: CollectionAction[];
  /** Optional collection-level actions rendered as buttons in the
   *  collection header (e.g. "Extend the course"). Unlike `actions`,
   *  these carry no record context: the seed prompt injects a compact
   *  progress summary of every record instead. The `when` predicate is
   *  not evaluated (there is no record to gate on). Order = button order. */
  collectionActions?: CollectionAction[];
  /** Name of the field whose value marks an item as "done". When set,
   *  a notification fires on item create (unless the item is born done)
   *  and clears when the field's value transitions into
   *  `completionDoneValues`. Must name a real field in `fields`. */
  completionField?: string;
  /** The set of values for `completionField` that count as "done"
   *  (e.g. `["Done"]` for a todo status field, `["paid"]` for an
   *  invoice). Non-empty. Compared as strings. */
  completionDoneValues?: readonly string[];
  /** Name of the field whose value is shown as the human-readable
   *  label in a completion notification's title (e.g. a `name` field,
   *  so the bell reads `Contacts: Jane Doe` instead of the opaque
   *  primaryKey). Must name a real field in `fields`. When unset — or
   *  when the record's value for it is empty — the title falls back to
   *  the record's primaryKey value. Display-only; never stored. */
  displayField?: string;
  /** Name of a `date` field that gates this item's completion
   *  notification: the bell is suppressed until the clock reaches that
   *  date (compared at day-granularity in the server's local timezone),
   *  instead of firing on create. Requires `completionField` /
   *  `completionDoneValues` (the bell still clears via the done value).
   *  Must name a real `date` field. Absent ⇒ fire on create, as before. */
  triggerField?: string;
  /** Lead time in whole days: fire the bell this many days BEFORE
   *  `triggerField` (so `10` shows the reminder 10 days early). The lead
   *  is applied at fire time, not stored, so it composes with `spawn` —
   *  every recurred cycle fires the same number of days before its own
   *  trigger. Non-negative integer; requires `triggerField`. Default 0
   *  (fire on the trigger date). */
  triggerLeadDays?: number;
  /** Host-driven recurrence. When set, requires `triggerField`. See
   *  {@link CollectionSpawn}. */
  spawn?: CollectionSpawn;
  /** Name of a `date` field that anchors the optional calendar view: a
   *  month grid where each record lands on the day cell matching this
   *  field's value. When unset, the calendar toggle still appears if the
   *  schema has any `date` field (the first one, in declaration order, is
   *  used by default and is switchable in-view). Set this to pin a specific
   *  anchor. Must name a real `date` field. */
  calendarField?: string;
  /** Name of a second `date` field marking the END of a multi-day span on
   *  the calendar: the record renders from `calendarField` through this
   *  date inclusive. Requires `calendarField`. Must name a real `date`
   *  field. Absent ⇒ single-day placement. */
  calendarEndField?: string;
  /** Name of a string field holding a free-form time or time-range
   *  (e.g. "14:00-17:00", "17:00-", "16:30") that places records on the
   *  calendar's day (time-allocation) view. Consulted only when the calendar
   *  date fields are date-only. Requires `calendarField`. */
  calendarTimeField?: string;
  /** Name of an `enum` field that groups records into columns on the
   *  optional Kanban board: each record lands in the column matching its
   *  value, with empty/unknown values collected in an "Uncategorized"
   *  column. When unset, the Kanban toggle still appears if the schema has
   *  any `enum` field (the first one, in declaration order, is used by
   *  default and is switchable in-view). Set this to pin a specific group
   *  field. Must name a real `enum` field. */
  kanbanField?: string;
  /** Optional custom (LLM-authored) HTML views, each rendered in a
   *  sandboxed iframe over the records. Absent ⇒ only the built-in
   *  field-derived views (table / calendar / kanban / dashboard). See
   *  {@link CollectionCustomView}. */
  views?: CollectionCustomView[];
  /** Optional predicate that gates the completion bell: when set, the bell
   *  fires only for records whose `String(record[notifyWhen.field])` is one
   *  of `notifyWhen.in` (e.g. notify only `high`/`urgent` priority todos).
   *  Reuses the `when` predicate shape. Requires `completionField` — it
   *  narrows that bell rather than introducing a second one. The bell still
   *  clears on done / delete / when the predicate stops matching. Absent ⇒
   *  notify for every open record (the prior behaviour). `notifyWhen.field`
   *  must name a real top-level field. */
  notifyWhen?: CollectionWhen;
  /** Optional scheduled-retrieval config. When present, the host refreshes
   *  this collection on `ingest.schedule`. Two flavours: a declarative Feed
   *  (`kind: rss/atom/http-json`) periodically fetches `ingest.url`, maps the
   *  response into records, and upserts them by `primaryKey` — only feeds
   *  discovered from the `<workspace>/feeds/` registry carry this. Or
   *  `kind: "agent"`, valid on any (incl. skill-backed) collection: the host
   *  dispatches a hidden background worker in `ingest.role` seeded with
   *  `ingest.template`, and the worker edits the records itself. The host's
   *  feeds subsystem narrows this to its richer `IngestSpec`. */
  ingest?: CollectionIngest;
  /** Optional data-driven override for the launcher shortcut icon: when
   *  set, the host resolves a record from `dynamicIcon.source` and maps
   *  it through `dynamicIcon.rules` to compute `CollectionSummary.icon`
   *  instead of using this static `icon`. Absent ⇒ unchanged static-icon
   *  behaviour. See `computeCollectionIcon` (server) and
   *  `selectDynamicRecord`/`resolveIcon` (pure resolver). */
  dynamicIcon?: DynamicIconSpec;
  /** Optional default column sort for the table view, applied only when the
   *  user has no stored (localStorage) sort of their own for this collection.
   *  `field` must name a top-level SORTABLE field (not markdown / table /
   *  image / file / embed). Absent ⇒ source order. Any sort the user sets
   *  in-view overrides it and persists per browser. */
  defaultSort?: { field: string; direction: "asc" | "desc" };
}

export interface CollectionSummary {
  slug: string;
  title: string;
  icon: string;
  source: CollectionSource;
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
 *  resolve embeds identically. */
export function embedTargetId(field: CollectionFieldSpec, record: CollectionItem | null): string {
  if (field.id) return field.id;
  if (field.idField && record) return String(record[field.idField] ?? "");
  return "";
}
