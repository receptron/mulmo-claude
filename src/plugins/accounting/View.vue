<template>
  <!-- Full <AccountingApp> mounted via the openBook tool result.
       Talks to /api/accounting directly for browse / form ops; only
       the entry gate (this mount) runs through the LLM. Pub/sub
       refetches keep multi-tab / sibling-window views in sync. -->
  <div class="h-full bg-white flex flex-col" data-testid="accounting-app">
    <NewBookForm v-if="showFirstRunForm" first-run full-page @created="onFirstBookCreated" />
    <template v-else>
      <header class="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
        <div class="flex items-center gap-2 min-w-0">
          <span class="material-icons text-gray-600">account_balance</span>
          <h2 class="text-lg font-semibold text-gray-800">{{ t("pluginAccounting.title") }}</h2>
        </div>
        <BookSwitcher
          v-if="!loadingBooks"
          :model-value="activeBookId ?? ''"
          :books="books"
          @update:model-value="onBookSelected"
          @books-changed="refetchBooks"
        />
      </header>
      <nav class="flex items-center gap-0.5 px-3 py-1.5 border-b border-gray-100 shrink-0 overflow-x-auto" data-testid="accounting-tabs">
        <button
          v-for="tab in visibleTabs"
          :key="tab.key"
          :class="[
            'h-8 px-2.5 flex items-center gap-1 rounded text-sm whitespace-nowrap',
            currentTab === tab.key ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-50',
          ]"
          :data-testid="`accounting-tab-${tab.key}`"
          @click="currentTab = tab.key"
        >
          <span class="material-icons text-base">{{ tab.icon }}</span>
          <span>{{ t(tab.labelKey) }}</span>
        </button>
      </nav>
      <main class="flex-1 overflow-auto p-4">
        <p v-if="loadingBooks" class="text-sm text-gray-400">{{ t("pluginAccounting.common.loading") }}</p>
        <p v-else-if="bookLoadError" class="text-sm text-red-500" data-testid="accounting-load-error">
          {{ t("pluginAccounting.common.error", { error: bookLoadError }) }}
        </p>
        <p v-else-if="!activeBookId" class="text-sm text-gray-500" data-testid="accounting-no-book">{{ t("pluginAccounting.noBook") }}</p>
        <template v-else-if="activeBookId">
          <JournalList
            v-if="currentTab === 'journal'"
            :book-id="activeBookId"
            :accounts="accounts"
            :currency="activeCurrency"
            :version="bookVersion"
            @changed="bumpLocalVersion"
            @edit-opening="currentTab = 'opening'"
          />
          <JournalEntryForm
            v-else-if="currentTab === 'newEntry'"
            :book-id="activeBookId"
            :accounts="accounts"
            :currency="activeCurrency"
            @submitted="onEntrySubmitted"
            @accounts-changed="bumpLocalVersion"
          />
          <OpeningBalancesForm
            v-else-if="currentTab === 'opening'"
            :book-id="activeBookId"
            :accounts="accounts"
            :currency="activeCurrency"
            :version="bookVersion"
            @submitted="onEntrySubmitted"
            @accounts-changed="bumpLocalVersion"
          />
          <Ledger v-else-if="currentTab === 'ledger'" :book-id="activeBookId" :accounts="accounts" :currency="activeCurrency" :version="bookVersion" />
          <BalanceSheet v-else-if="currentTab === 'balanceSheet'" :book-id="activeBookId" :currency="activeCurrency" :version="bookVersion" />
          <ProfitLoss v-else-if="currentTab === 'profitLoss'" :book-id="activeBookId" :currency="activeCurrency" :version="bookVersion" />
          <BookSettings
            v-else-if="currentTab === 'settings'"
            :book-id="activeBookId"
            :book-name="activeBookName"
            @deleted="onBookDeleted"
            @books-changed="refetchBooks"
          />
        </template>
      </main>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import BookSwitcher from "./components/BookSwitcher.vue";
import NewBookForm from "./components/NewBookForm.vue";
import JournalList from "./components/JournalList.vue";
import JournalEntryForm from "./components/JournalEntryForm.vue";
import OpeningBalancesForm from "./components/OpeningBalancesForm.vue";
import Ledger from "./components/Ledger.vue";
import BalanceSheet from "./components/BalanceSheet.vue";
import ProfitLoss from "./components/ProfitLoss.vue";
import BookSettings from "./components/BookSettings.vue";
import { getOpeningBalances, getAccounts, getBooks, type Account, type BookSummary } from "./api";
import { useAccountingChannel, useAccountingBooksChannel } from "../../composables/useAccountingChannel";

const { t } = useI18n();

interface AccountingAppPayload {
  kind?: string;
  bookId?: string;
  initialTab?: string;
}

const props = defineProps<{ selectedResult?: ToolResultComplete<AccountingAppPayload, AccountingAppPayload> }>();

const TAB_KEYS = ["journal", "newEntry", "opening", "ledger", "balanceSheet", "profitLoss", "settings"] as const;
type TabKey = (typeof TAB_KEYS)[number];

interface TabDef {
  key: TabKey;
  icon: string;
  labelKey: string;
}

const TABS: readonly TabDef[] = [
  { key: "journal", icon: "list", labelKey: "pluginAccounting.tabs.journal" },
  { key: "newEntry", icon: "add", labelKey: "pluginAccounting.tabs.newEntry" },
  { key: "opening", icon: "play_arrow", labelKey: "pluginAccounting.tabs.opening" },
  { key: "ledger", icon: "menu_book", labelKey: "pluginAccounting.tabs.ledger" },
  { key: "balanceSheet", icon: "balance", labelKey: "pluginAccounting.tabs.balanceSheet" },
  { key: "profitLoss", icon: "trending_up", labelKey: "pluginAccounting.tabs.profitLoss" },
  { key: "settings", icon: "settings", labelKey: "pluginAccounting.tabs.settings" },
];

function isTabKey(value: string | undefined): value is TabKey {
  return typeof value === "string" && (TAB_KEYS as readonly string[]).includes(value);
}

const initialPayload = computed<AccountingAppPayload>(() => props.selectedResult?.data ?? props.selectedResult?.jsonData ?? {});
const initialTab = computed<TabKey>(() => (isTabKey(initialPayload.value.initialTab) ? initialPayload.value.initialTab : "journal"));

const currentTab = ref<TabKey>(initialTab.value);
const books = ref<BookSummary[]>([]);
const activeBookId = ref<string | null>(null);
const accounts = ref<Account[]>([]);
const loadingBooks = ref(true);
// First-run flow: when the user opens the app on a fresh
// workspace (zero books), we render NewBookForm in full-page
// mode in place of the regular chrome (header + tabs + main),
// so the user MUST pick a name + currency before proceeding —
// no popup, no dismiss. Distinct from the modal opened via
// BookSwitcher's "+ New book" sentinel option, which reuses the
// same component but with the overlay layout.
const showFirstRunForm = ref(false);
const firstRunHandled = ref(false);
// Distinct from "books is empty" so we don't show the "+ New
// book" CTA when the real problem is a transport / server failure
// fetching the list.
const bookLoadError = ref<string | null>(null);
// Local version bump that combines the pub/sub bump and explicit
// child-driven refetches (e.g. after a void / submit). Used as the
// `version` prop for sub-components so they `watch` and refetch
// uniformly.
const localVersion = ref(0);
// Tracks whether the active book has an opening entry on file.
// `null` = unknown / loading; the gate only activates on an
// explicit `false` so we don't disable tabs during the cold load
// while the first getOpeningBalances request is still in flight.
const hasOpening = ref<boolean | null>(null);

const activeBook = computed(() => books.value.find((book) => book.id === activeBookId.value) ?? null);
const activeBookName = computed(() => activeBook.value?.name ?? "");
const activeCurrency = computed(() => activeBook.value?.currency ?? "USD");

const { version: pubsubVersion } = useAccountingChannel(activeBookId);
useAccountingBooksChannel(() => void refetchBooks());

// `bookVersion` already aggregates `pubsubVersion` so any pub/sub
// event reactively re-fires every child component's `watch` on
// the version prop. A separate `watch(pubsubVersion, …)` that
// bumps `localVersion` would refire every dependant a second time
// in the same tick — pure busywork.
const bookVersion = computed(() => pubsubVersion.value + localVersion.value);

function bumpLocalVersion(): void {
  localVersion.value += 1;
}

function pickInitialBookId(): string | null {
  // Priority: explicit `initialPayload.bookId` (carried in the
  // tool-result envelope by openBook / createBook / addEntry / …) →
  // first book in the list → null (empty workspace). The candidate
  // is validated against the live book list so a stale id from a
  // deleted book doesn't poison the View.
  if (books.value.length === 0) return null;
  const requested = initialPayload.value.bookId;
  if (requested && books.value.some((book) => book.id === requested)) return requested;
  return books.value[0].id;
}

async function refetchBooks(): Promise<void> {
  loadingBooks.value = true;
  bookLoadError.value = null;
  try {
    const result = await getBooks();
    if (!result.ok) {
      // Surface load failures as a distinct error state so the user
      // doesn't see "No books yet" (and the auto-open modal) when
      // the real cause is a transport / server problem.
      bookLoadError.value = result.error;
      return;
    }
    books.value = result.data.books;
    const stillExists = activeBookId.value !== null && books.value.some((book) => book.id === activeBookId.value);
    if (!stillExists) activeBookId.value = pickInitialBookId();
    // Auto-open the New Book modal exactly once on first arrival
    // when the workspace is empty. After that, the user can still
    // open it manually via the "+ New book" button.
    if (!firstRunHandled.value && books.value.length === 0) {
      firstRunHandled.value = true;
      showFirstRunForm.value = true;
    }
  } catch (err) {
    bookLoadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loadingBooks.value = false;
  }
}

async function onFirstBookCreated(book: BookSummary): Promise<void> {
  showFirstRunForm.value = false;
  await refetchBooks();
  activeBookId.value = book.id;
}

async function refetchAccounts(): Promise<void> {
  if (!activeBookId.value) {
    accounts.value = [];
    return;
  }
  const result = await getAccounts(activeBookId.value);
  if (!result.ok) return;
  accounts.value = result.data.accounts;
}

async function refetchOpening(): Promise<void> {
  if (!activeBookId.value) {
    hasOpening.value = null;
    return;
  }
  const result = await getOpeningBalances(activeBookId.value);
  if (!result.ok) return;
  hasOpening.value = result.data.opening !== null;
}

// A book without an opening on file is in "gated" mode: the user
// must save an opening (empty is fine — see OpeningBalancesForm)
// before journal / report tabs unlock. Settings stays accessible
// so the user can delete the book if they don't want to proceed.
const openingGateActive = computed(() => activeBookId.value !== null && hasOpening.value === false);

// Gated → only Opening + Settings render in the strip. Ungated →
// Opening hides itself; users reach the form via the Edit button
// on the active opening row in the journal, which transiently
// switches `currentTab` to "opening" (kept visible while there).
const visibleTabs = computed<readonly TabDef[]>(() => {
  if (openingGateActive.value) return TABS.filter((tab) => tab.key === "opening" || tab.key === "settings");
  return TABS.filter((tab) => tab.key !== "opening" || currentTab.value === "opening");
});

function onBookSelected(bookId: string): void {
  activeBookId.value = bookId;
}

function onEntrySubmitted(): void {
  bumpLocalVersion();
  // After posting an opening or a normal entry, switch to the
  // journal so the user immediately sees what they booked. The
  // bumpLocalVersion above triggers the bookVersion watcher which
  // refetches hasOpening, so the gate auto-lifts shortly after the
  // tab switch — no manual unlock needed here.
  if (currentTab.value === "newEntry" || currentTab.value === "opening") {
    currentTab.value = "journal";
  }
}

async function onBookDeleted(): Promise<void> {
  // Reset the tab BEFORE awaiting so a fast delete-then-create
  // can't race: if the new book's gate engages while we're still
  // awaiting refetchBooks, the gate watcher needs to see a
  // non-"settings" currentTab to route the user to Opening.
  currentTab.value = "journal";
  await refetchBooks();
}

// Refetch the chart of accounts whenever the active book changes
// or any pub/sub / child action bumps bookVersion (e.g. an
// upsertAccount from the Manage Accounts modal, or an LLM-driven
// upsert in another tab). The list is small JSON; the cost of
// over-fetching on entry / void / opening events is negligible
// against the staleness bug it removes.
watch(
  () => [activeBookId.value, bookVersion.value],
  () => {
    if (activeBookId.value) void refetchAccounts();
  },
  { immediate: true },
);

// Stash a target bookId that we want to land on but haven't been
// able to apply yet (book not in `books` at the moment the
// tool-result fired). Cleared as soon as the books list catches up.
const pendingTargetBookId = ref<string | null>(null);

function applyTargetBookId(target: string): void {
  if (books.value.some((book) => book.id === target)) {
    activeBookId.value = target;
    pendingTargetBookId.value = null;
    return;
  }
  pendingTargetBookId.value = target;
}

// When the selected tool-result changes (user clicks a different
// preview card in the sidebar), follow the new result's bookId so
// the canvas lands on the book that action just touched. Skipped
// when the new result has no bookId (silent reads / actions that
// don't carry one). When the target isn't in `books` yet — common
// race after a fresh `createBook → openBook(bookId)` handoff where
// the result envelope arrives before refetchBooks completes — the
// id is stashed and applied by the books watcher below as soon as
// the list catches up.
watch(
  () => initialPayload.value.bookId,
  (next) => {
    if (!next) return;
    applyTargetBookId(next);
  },
);

// Drains the pending target once `books` includes it (typically
// after a pub/sub-driven refetch resolves the createBook write).
// No-op when nothing is pending or the target is still missing.
watch(books, () => {
  const pending = pendingTargetBookId.value;
  if (pending) applyTargetBookId(pending);
});

// Refetch the opening status whenever the active book changes or
// any pub/sub / child action bumps bookVersion (e.g. an opening
// got saved or voided). Clears hasOpening when the book goes null
// so a stale "true" doesn't carry over between books.
watch(
  () => [activeBookId.value, bookVersion.value],
  () => void refetchOpening(),
  { immediate: true },
);

// Force-route to the Opening tab whenever the gate engages.
// Other tabs are hidden from the strip while gated, but this
// watcher handles the programmatic case where currentTab still
// points at a now-hidden tab (book switch, initial mount with a
// no-opening book, LLM-supplied initialTab pointing at a gated
// tab, or fresh-book creation right after deleting from the
// settings tab) — without it, `<main>` would render nothing or
// the user would be stranded on the prior book's settings view.
// We don't exempt "settings" here: the user can still click back
// to it from the (gated) tab strip if they want to delete the
// new book instead of setting it up.
watch(openingGateActive, (active) => {
  if (!active) return;
  if (currentTab.value === "opening") return;
  currentTab.value = "opening";
});

void refetchBooks();
</script>
