// Collection watchers — thin host binding over
// @mulmoclaude/core/collection-watchers. The fs.watch plumbing lives in the
// shared package; this file just ensures the host's notification adapter
// is configured (the `./notifications.js` side-effect import) and
// re-exports the watcher surface existing callers + tests import from
// `./watcher.js`.
//
// `server/index.ts` calls `startCollectionWatchers` at boot; the adapter
// must be configured first, which the import below guarantees.
import "./notifications.js";

export {
  startCollectionWatchers,
  stopCollectionWatchers,
  _syncWatchersForTesting,
  _tickTimeTriggersForTesting,
  _scheduleItemReconcileForTesting,
  _scheduleCollectionReconcileForTesting,
  _handleStoreChangeForTesting,
  type CollectionWatcherOptions,
} from "@mulmoclaude/core/collection-watchers";
