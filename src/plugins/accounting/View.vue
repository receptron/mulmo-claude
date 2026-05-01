<template>
  <!-- Full <AccountingApp> mounted via the openApp tool result.
       Talks to /api/accounting directly for browse / form ops; only
       the entry gate (this mount) runs through the LLM. Pub/sub
       refetches keep multi-tab / sibling-window views in sync. -->
  <div class="h-full bg-white flex flex-col" data-testid="accounting-app">
    <header class="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
      <div class="flex items-center gap-2 min-w-0">
        <span class="material-icons text-gray-600">account_balance</span>
        <h2 class="text-lg font-semibold text-gray-800">{{ t("pluginAccounting.title") }}</h2>
      </div>
      <BookSwitcher v-if="!loadingBooks" :model-value="activeBookId ?? ''" :books="books" @update:model-value="onBookSelected" @books-changed="refetchBooks" />
    </header>
    <nav class="flex items-center gap-0.5 px-3 py-1.5 border-b border-gray-100 shrink-0 overflow-x-auto" data-testid="accounting-tabs">
      <button
        v-for="tab in TABS"
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
        />
        <JournalEntryForm
          v-else-if="currentTab === 'newEntry'"
          :book-id="activeBookId"
          :accounts="accounts"
          :currency="activeCurrency"
          @submitted="onEntrySubmitted"
        />
        <OpeningBalancesForm
          v-else-if="currentTab === 'opening'"
          :book-id="activeBookId"
          :accounts="accounts"
          :currency="activeCurrency"
          :version="bookVersion"
          @submitted="onEntrySubmitted"
        />
        <Ledger v-else-if="currentTab === 'ledger'" :book-id="activeBookId" :accounts="accounts" :currency="activeCurrency" :version="bookVersion" />
        <BalanceSheet v-else-if="currentTab === 'balanceSheet'" :book-id="activeBookId" :currency="activeCurrency" :version="bookVersion" />
        <ProfitLoss v-else-if="currentTab === 'profitLoss'" :book-id="activeBookId" :currency="activeCurrency" :version="bookVersion" />
        <BookSettings
          v-else-if="currentTab === 'settings'"
          :book-id="activeBookId"
          :book-name="activeBookName"
          :is-last-book="books.length <= 1"
          @deleted="onBookDeleted"
          @books-changed="refetchBooks"
        />
      </template>
    </main>
    <NewBookForm v-if="showFirstRunForm" first-run cancelable @cancel="showFirstRunForm = false" @created="onFirstBookCreated" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import BookSwitcher from "./components/BookSwitcher.vue";
import NewBookForm from "./components/NewBookForm.vue";
import JournalList from "./components/JournalList.vue";
import JournalEntryForm from "./components/JournalEntryForm.vue";
import OpeningBalancesForm from "./components/OpeningBalancesForm.vue";
import Ledger from "./components/Ledger.vue";
import BalanceSheet from "./components/BalanceSheet.vue";
import ProfitLoss from "./components/ProfitLoss.vue";
import BookSettings from "./components/BookSettings.vue";
import { listAccounts, listBooks, type Account, type BookSummary } from "./api";
import { useAccountingChannel, useAccountingBooksChannel } from "../../composables/useAccountingChannel";

const { t } = useI18n();

interface AccountingAppPayload {
  kind?: string;
  bookId?: string;
  initialTab?: string;
}

const props = defineProps<{ data?: AccountingAppPayload; jsonData?: AccountingAppPayload }>();

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

const initialPayload = computed<AccountingAppPayload>(() => props.data ?? props.jsonData ?? {});
const initialTab = computed<TabKey>(() => (isTabKey(initialPayload.value.initialTab) ? initialPayload.value.initialTab : "journal"));

const currentTab = ref<TabKey>(initialTab.value);
const books = ref<BookSummary[]>([]);
const activeBookId = ref<string | null>(null);
const accounts = ref<Account[]>([]);
const loadingBooks = ref(true);
// First-run flow: when the user opens the app on a fresh workspace
// (zero books), we auto-show the New Book modal so they have to
// pick a name + currency before proceeding. The modal is the same
// one used by BookSwitcher's "+ New book" button — extracted to
// NewBookForm.vue so both call sites share it.
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

function pickActiveBookId(serverActiveBookId: string | null): string | null {
  // Only ever point activeBookId at a book that actually exists on
  // disk. Empty workspace returns null; the View renders its empty
  // state and the auto-opening NewBookForm prompts for creation.
  if (books.value.length === 0) return null;
  const requested = initialPayload.value.bookId;
  if (requested && books.value.some((book) => book.id === requested)) return requested;
  if (serverActiveBookId && books.value.some((book) => book.id === serverActiveBookId)) return serverActiveBookId;
  return books.value[0].id;
}

async function refetchBooks(): Promise<void> {
  loadingBooks.value = true;
  bookLoadError.value = null;
  try {
    const result = await listBooks();
    if (!result.ok) {
      // Surface load failures as a distinct error state so the user
      // doesn't see "No books yet" (and the auto-open modal) when
      // the real cause is a transport / server problem.
      bookLoadError.value = result.error;
      return;
    }
    books.value = result.data.books;
    const stillExists = activeBookId.value !== null && books.value.some((book) => book.id === activeBookId.value);
    if (!stillExists) activeBookId.value = pickActiveBookId(result.data.activeBookId);
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
  const result = await listAccounts(activeBookId.value);
  if (!result.ok) return;
  accounts.value = result.data.accounts;
}

function onBookSelected(bookId: string): void {
  activeBookId.value = bookId;
}

function onEntrySubmitted(): void {
  bumpLocalVersion();
  // After posting an opening or a normal entry, switch to the
  // journal so the user immediately sees what they booked.
  if (currentTab.value === "newEntry" || currentTab.value === "opening") {
    currentTab.value = "journal";
  }
}

async function onBookDeleted(): Promise<void> {
  await refetchBooks();
  currentTab.value = "journal";
}

watch(activeBookId, (next) => {
  if (next) void refetchAccounts();
});

void refetchBooks();
</script>
