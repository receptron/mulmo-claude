// Subscribe to per-book accounting events.
//
// Returns a `version` ref that bumps every time the server publishes a
// change for the given bookId — addEntry, voidEntry,
// setOpeningBalances, upsertAccount, snapshot rebuild completion. View
// components watch `version` to drive `refetch` calls.
//
// `bookId` is reactive: switching the active book in BookSwitcher
// flips it; the composable unsubscribes from the old channel and
// subscribes to the new one.
//
// `onPayload` is an optional fine-grained hook for callers that want to
// inspect the event kind (e.g. show a "rebuilding…" indicator on
// `kind: "snapshots-rebuilding"`).

import { ref, watch, onUnmounted, type Ref } from "vue";
import { usePubSub } from "./usePubSub";
import { accountingBookChannel, PUBSUB_CHANNELS, type AccountingBookChannelPayload } from "../config/pubsubChannels";

export interface UseAccountingChannelReturn {
  /** Bumps on every accountingBookChannel event for the current
   *  bookId. Resets to 0 when bookId changes. */
  version: Ref<number>;
}

export function useAccountingChannel(bookId: Ref<string | null>, onPayload?: (payload: AccountingBookChannelPayload) => void): UseAccountingChannelReturn {
  const version = ref(0);
  const { subscribe } = usePubSub();
  let unsubscribe: (() => void) | null = null;

  function bind(nextBookId: string | null): void {
    unsubscribe?.();
    unsubscribe = null;
    version.value = 0;
    if (!nextBookId) return;
    unsubscribe = subscribe(accountingBookChannel(nextBookId), (data) => {
      const event = data as AccountingBookChannelPayload;
      version.value += 1;
      onPayload?.(event);
    });
  }

  watch(bookId, bind, { immediate: true });
  onUnmounted(() => {
    unsubscribe?.();
    unsubscribe = null;
  });
  return { version };
}

/** Subscribe to "the list of books changed" events. Use in
 *  BookSwitcher.vue to refetch the dropdown contents when a sibling
 *  tab adds / deletes a book. */
export function useAccountingBooksChannel(onChange: () => void): void {
  const { subscribe } = usePubSub();
  const unsubscribe = subscribe(PUBSUB_CHANNELS.accountingBooks, onChange);
  onUnmounted(() => unsubscribe());
}
