// Host-injected configuration for the collection-completion watchers.
// The reconciler logic + watcher plumbing are host-agnostic; the
// notification TAXONOMY (which plugin namespace, how a record priority
// maps to a bell severity) and the in-app ROUTING (the deep-link a bell
// row navigates to) are host-specific, so the host supplies them via an
// adapter. MulmoClaude wires its legacy notification machinery; a future
// MulmoTerminal wires its own routes + pluginData shape.

import type { MinimalLogger } from "@mulmoclaude/common";
import type { NotifierSeverity } from "../notifier";

/** Two-level urgency a pending record can carry, derived from the
 *  schema's `notifyWhen` spec. The host maps this onto its own severity
 *  scale via `priorityToSeverity`. */
export type CompletionPriority = "normal" | "high";

export type CollectionWatcherLogger = Pick<MinimalLogger, "info" | "warn">;

/** The host-specific notification surface the reconciler binds to. The
 *  reconciler owns the internal `legacyId` key (it encodes slug+itemId
 *  and round-trips it through `pluginData`); the adapter only wraps /
 *  unwraps it into whatever shape the host's bell expects. */
export interface CollectionNotificationAdapter {
  /** Plugin namespace these bell entries publish under (MulmoClaude: "todo"). */
  pluginPkg: string;
  /** Map a record's completion priority onto the host's bell severity. */
  priorityToSeverity: (priority: CompletionPriority) => NotifierSeverity;
  /** Build the in-app deep-link the bell row routes to on click. */
  buildNavigateTarget: (slug: string, itemId: string) => string;
  /** Wrap the reconciler's internal key + priority into the host's
   *  `pluginData` shape. Stored verbatim on the entry; recovered via
   *  `readEntry`. */
  buildPluginData: (input: { legacyId: string; slug: string; itemId: string; priority: CompletionPriority; navigateTarget: string }) => unknown;
  /** Recognise a bell entry produced by this reconciler and recover its
   *  internal key + stored priority. Returns null for entries that didn't
   *  originate here, so `listAll()` scans skip foreign entries. */
  readEntry: (pluginData: unknown) => { legacyId: string; priority: CompletionPriority } | null;
}

const NOOP_LOG: CollectionWatcherLogger = { info: () => {}, warn: () => {} };

let adapter: CollectionNotificationAdapter | null = null;
let activeLogger: CollectionWatcherLogger = NOOP_LOG;

/** Wire the host adapter + logger. Call once at startup, before
 *  `startCollectionWatchers` or any direct reconcile call. */
export function configureCollectionWatchers(config: { adapter: CollectionNotificationAdapter; log?: CollectionWatcherLogger }): void {
  ({ adapter } = config);
  activeLogger = config.log ?? NOOP_LOG;
}

export function requireAdapter(): CollectionNotificationAdapter {
  if (!adapter) throw new Error("collection-watchers: configureCollectionWatchers() not called");
  return adapter;
}

export function log(): CollectionWatcherLogger {
  return activeLogger;
}

/** Test-only: clear the host wiring. */
export function resetCollectionWatchersConfig(): void {
  adapter = null;
  activeLogger = NOOP_LOG;
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
