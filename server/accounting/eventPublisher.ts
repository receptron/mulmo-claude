// Pub/sub publisher for the accounting plugin. Mirror of
// `server/events/file-change.ts`: module singleton + init function +
// fire-and-forget publish helpers. The init wiring lives in
// `server/index.ts` next to `initFileChangePublisher`.
//
// Channel names + payload shapes are imported from
// `src/config/pubsubChannels.ts` so the publisher cannot drift from
// the View-side subscribers.

import { accountingBookChannel, PUBSUB_CHANNELS, type AccountingBookChannelPayload } from "../../src/config/pubsubChannels.js";
import { log } from "../system/logger/index.js";
import type { IPubSub } from "../events/pub-sub/index.js";

let pubsub: IPubSub | null = null;

export function initAccountingEventPublisher(instance: IPubSub): void {
  pubsub = instance;
}

function safePublish(channel: string, payload: unknown): void {
  if (!pubsub) return;
  try {
    pubsub.publish(channel, payload);
  } catch (err) {
    // Same fire-and-forget rationale as the file-change publisher:
    // dropping one event is better than crashing the server.
    log.warn("accounting", "publish failed; subscribers will miss this event", {
      channel,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Per-book change notification. `period` should be the entry's
 *  YYYY-MM bucket (or the earliest invalidated month for snapshot
 *  events). */
export function publishBookChange(bookId: string, payload: AccountingBookChannelPayload): void {
  safePublish(accountingBookChannel(bookId), payload);
}

/** Fired when the *list* of books changes (createBook, deleteBook,
 *  setActiveBook). Payload is intentionally empty — subscribers
 *  refetch from /api/accounting. */
export function publishBooksChanged(): void {
  safePublish(PUBSUB_CHANNELS.accountingBooks, {});
}

/** Test-only — drop the module singleton so each test starts clean. */
export function _resetAccountingEventPublisherForTesting(): void {
  pubsub = null;
}
