// Collection view-state / response types — used by the View components, the
// record panel, the rendering composable, and the draft helper. Pure types
// (no Vue, no Node); kept in the core so both the host and MulmoTerminal share
// them. The host's src/components/collectionTypes.ts re-exports these.

import type { CollectionDetail, CollectionItem, CollectionSchema, CollectionSummary } from "./schema";
import type { CollectionOntologyEntry } from "./ontologyGraph";

/** A record file the server couldn't load or that violates the schema —
 *  silently skipped at read time (mirror of the server `RecordIssue`). */
export interface CollectionRecordIssue {
  /** Record filename, e.g. `lesson-003.json`. */
  file: string;
  /** Human-readable problem, written to be actionable by the LLM. */
  problem: string;
}

export interface CollectionDetailResponse {
  collection: CollectionDetail;
  items: CollectionItem[];
  /** Record files that failed validation; drives the in-view Repair prompt. */
  issues?: CollectionRecordIssue[];
  /** In-flight `kind: "agent"` action run keys (`collection/<actionId>` /
   *  `item/<itemId>/<actionId>`) — drives the button spinners. Absent when
   *  nothing is running (same absent-when-clean contract as `issues`). */
  runningActions?: string[];
}

export interface ItemMutationResponse {
  itemId: string;
  item: CollectionItem;
}

/** One row of a `table`-typed field, in draft form. */
export interface TableRowDraft {
  text: Record<string, string>;
  bool: Record<string, boolean>;
  boolOriginallyPresent: Record<string, boolean>;
  boolTouched: Record<string, boolean>;
}

export interface EditState {
  mode: "create" | "edit";
  text: Record<string, string>;
  bool: Record<string, boolean>;
  boolOriginallyPresent: Record<string, boolean>;
  boolTouched: Record<string, boolean>;
  table: Record<string, TableRowDraft[]>;
  /** For edit mode: the original item id pinned to the URL. */
  originalId: string | null;
}

/** Per-target-collection cache: an item's primary-key slug → display label. */
export type RefDisplayMap = Record<string, string>;
export type RefCache = Record<string, RefDisplayMap>;

/** Per-target-collection cache of full referenced records, for `<field>.<col>`
 *  derefs in derived formulas. */
export type RefRecordMap = Record<string, CollectionItem>;
export type RefRecordCache = Record<string, RefRecordMap>;

/** Per-target cache for `embed` fields: the target collection's schema + items. */
export interface EmbedTargetData {
  schema: CollectionSchema;
  items: CollectionItem[];
}
export type EmbedCache = Record<string, EmbedTargetData>;

/** Option shown in a `ref` field's `<select>` dropdown. */
export interface RefOption {
  slug: string;
  display: string;
}

// ── embed view-model (a fixed record from another collection, rendered
//    read-only) — shared by the rendering composable and the embed view ──

export interface EmbedRow {
  /** Sub-field key (used for `:key` + testids). */
  key: string;
  label: string;
  /** Sub-field type — the renderer branches on "boolean" / "markdown". */
  type: string;
  /** Raw value, used only for the boolean check / em-dash. */
  value: unknown;
  /** Pre-formatted string for every non-boolean render path. */
  display: string;
}

export interface EmbedView {
  /** False when the target collection has no record with the embed's `id`
   *  (or the target couldn't be loaded) — the renderer shows a "missing"
   *  message + a link to create it. */
  found: boolean;
  rows: EmbedRow[];
  /** Target collection slug, for the "create it" link + message. */
  targetSlug: string;
  /** The fixed record id the embed points at, for the message. */
  recordId: string;
}

// ── backlinks view-model (the records in another collection whose `via`
//    ref points at the open record, rendered as a read-only sub-table) ──

/** One column of the backlinks sub-table: a `display` key, labelled from
 *  the SOURCE schema (raw key when the source doesn't declare it). */
export interface BacklinksColumn {
  key: string;
  label: string;
}

/** One matching source record: its id (the row links to
 *  `/collections/<from>?selected=<id>`) + a pre-formatted cell per column. */
export interface BacklinksRow {
  id: string;
  /** Cell display strings, aligned with the view's `columns`. */
  cells: string[];
}

export interface BacklinksView {
  /** False when the source collection couldn't be loaded — the renderer
   *  fails soft to the same empty-state as "no matching rows". */
  found: boolean;
  columns: BacklinksColumn[];
  rows: BacklinksRow[];
  /** Source collection slug (the field's `from`), for the row links. */
  fromSlug: string;
}

/** Active-notification severity for a record, used to accent flagged cards
 *  (kanban left-stripe, etc.). The host computes these from its notifier and
 *  passes them in; this is the structural type the view layer accepts. The host's
 *  own `NotifierSeverity` is the identical union, so its maps pass through. */
export type CollectionNotifySeverity = "info" | "nudge" | "urgent";

// ── index-page response types (the browsable /collections + /feeds lists) ──

/** Response of the collections list endpoint (`API_ROUTES.collections.list`). */
export interface CollectionsListResponse {
  collections: CollectionSummary[];
}

/** Response of the workspace-ontology endpoint
 *  (`API_ROUTES.collections.ontology`) — the raw entries the Map tab
 *  feeds to `buildOntologyGraph` client-side. */
export interface CollectionOntologyResponse {
  entries: CollectionOntologyEntry[];
}

/** A row in the feeds index — a data-source collection from the workspace's
 *  `feeds/` registry. */
export interface FeedSummary {
  slug: string;
  title: string;
  icon: string;
  kind: string;
  schedule: string;
  lastFetchedAt: string | null;
}

/** Response of the feeds list endpoint (`API_ROUTES.feeds.list`). */
export interface FeedsListResponse {
  feeds: FeedSummary[];
}

/** The `{slug,title,icon}` triple the index pages reconcile pinned shortcuts
 *  against (prune dead slugs, refresh stale labels). */
export interface CollectionShortcutInfo {
  slug: string;
  title: string;
  icon: string;
}
