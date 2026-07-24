// @mulmoclaude/core/collection-watchers — the collection-completion bell
// subsystem shared by MulmoClaude and MulmoTerminal. fs.watch plumbing
// (watcher.ts) + the convergent reconciler (reconciler.ts) live here; the
// host injects its notification taxonomy + in-app routing via a
// CollectionNotificationAdapter (config.ts). Depends directly on the
// shared ../notifier singleton and ../collection.
export {
  configureCollectionWatchers,
  resetCollectionWatchersConfig,
  type CollectionNotificationAdapter,
  type CollectionWatcherLogger,
  type CompletionPriority,
} from "./config.js";
export {
  reconcileItem,
  reconcileAllItems,
  sweepStaleActiveEntries,
  clearItemNotification,
  resolveDisplayLabel,
  itemIsDone,
  _resetReconcilerLocksForTesting,
} from "./reconciler.js";
export { evalNow } from "./clock.js";
export {
  startCollectionWatchers,
  stopCollectionWatchers,
  _syncWatchersForTesting,
  _tickTimeTriggersForTesting,
  _scheduleItemReconcileForTesting,
  _scheduleCollectionReconcileForTesting,
  _handleStoreChangeForTesting,
  type CollectionWatcherOptions,
} from "./watcher.js";
