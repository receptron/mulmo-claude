<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-end gap-2">
      <label class="text-xs text-gray-500 flex flex-col gap-1">
        {{ t("pluginAccounting.journalList.fromLabel") }}
        <input v-model="from" type="date" class="h-8 px-2 rounded border border-gray-300 text-sm" data-testid="accounting-journal-from" />
      </label>
      <label class="text-xs text-gray-500 flex flex-col gap-1">
        {{ t("pluginAccounting.journalList.toLabel") }}
        <input v-model="toDate" type="date" class="h-8 px-2 rounded border border-gray-300 text-sm" data-testid="accounting-journal-to" />
      </label>
      <label class="text-xs text-gray-500 flex flex-col gap-1">
        {{ t("pluginAccounting.journalList.accountLabel") }}
        <select v-model="accountCode" class="h-8 px-2 rounded border border-gray-300 text-sm bg-white" data-testid="accounting-journal-account">
          <option value="">{{ t("pluginAccounting.journalList.allAccounts") }}</option>
          <option v-for="account in accounts" :key="account.code" :value="account.code">{{ formatAccountLabel(account) }}</option>
        </select>
      </label>
      <button class="h-8 px-2.5 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50" @click="refresh">
        <span class="material-icons text-base align-middle">refresh</span>
      </button>
    </div>
    <p v-if="loading" class="text-xs text-gray-400">{{ t("pluginAccounting.common.loading") }}</p>
    <p v-else-if="error" class="text-xs text-red-500">{{ t("pluginAccounting.common.error", { error }) }}</p>
    <p v-else-if="filteredEntries.length === 0" class="text-xs text-gray-400">{{ t("pluginAccounting.common.empty") }}</p>
    <table v-else class="w-full text-sm" data-testid="accounting-journal-table">
      <thead>
        <tr class="text-xs text-gray-500 border-b border-gray-200">
          <th class="text-left py-1 px-2">{{ t("pluginAccounting.journalList.columns.date") }}</th>
          <th class="text-left py-1 px-2">{{ t("pluginAccounting.journalList.columns.kind") }}</th>
          <th class="text-left py-1 px-2">{{ t("pluginAccounting.journalList.columns.memo") }}</th>
          <th class="text-left py-1 px-2">{{ t("pluginAccounting.journalList.columns.lines") }}</th>
          <th class="py-1 px-2"></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="entry in filteredEntries"
          :key="entry.id"
          :class="voidedEntryIds.has(entry.id) ? 'text-gray-400 line-through' : ''"
          :data-testid="voidedEntryIds.has(entry.id) ? `accounting-journal-row-voided-${entry.id}` : `accounting-journal-row-${entry.id}`"
          class="border-b border-gray-100 align-top"
        >
          <td class="py-1 px-2 whitespace-nowrap">{{ entry.date }}</td>
          <td class="py-1 px-2 text-xs">{{ kindLabel(entry.kind) }}</td>
          <td class="py-1 px-2">
            <span v-if="entry.memo">{{ entry.memo }}</span>
          </td>
          <td class="py-1 px-2">
            <div v-for="(line, idx) in entry.lines" :key="idx" class="text-xs flex gap-2">
              <span class="font-mono">{{ line.accountCode }}</span>
              <span v-if="line.debit">{{ formatDebit(line.debit) }}</span>
              <span v-if="line.credit">{{ formatCredit(line.credit) }}</span>
            </div>
          </td>
          <td class="py-1 px-2 text-right">
            <button
              v-if="entry.kind === 'normal' && !voidedEntryIds.has(entry.id)"
              class="text-xs text-red-500 hover:underline"
              :data-testid="`accounting-void-${entry.id}`"
              @click="onVoid(entry)"
            >
              {{ t("pluginAccounting.journalList.void") }}
            </button>
            <button
              v-else-if="entry.kind === 'opening' && !voidedEntryIds.has(entry.id)"
              class="text-xs text-blue-600 hover:underline"
              :data-testid="`accounting-edit-opening-${entry.id}`"
              @click="emit('editOpening')"
            >
              {{ t("pluginAccounting.journalList.edit") }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getJournalEntries, voidEntry, type Account, type JournalEntry, type JournalEntryKind } from "../api";
import { formatAmount } from "../currencies";
import { useLatestRequest } from "./useLatestRequest";

const { t } = useI18n();

const props = defineProps<{ bookId: string; accounts: Account[]; currency: string; version: number }>();
const emit = defineEmits<{ changed: []; editOpening: [] }>();

const from = ref("");
const toDate = ref("");
const accountCode = ref("");
const entries = ref<JournalEntry[]>([]);
const serverVoidedIds = ref<string[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const { begin: beginRequest, isCurrent } = useLatestRequest();

function kindLabel(kind: JournalEntryKind): string {
  if (kind === "opening") return t("pluginAccounting.journalList.kind.opening");
  if (kind === "void") return t("pluginAccounting.journalList.kind.void");
  if (kind === "void-marker") return t("pluginAccounting.journalList.kind.voidMarker");
  return t("pluginAccounting.journalList.kind.normal");
}

function formatDebit(value: number): string {
  return `DR ${formatAmount(value, props.currency)}`;
}
function formatCredit(value: number): string {
  return `CR ${formatAmount(value, props.currency)}`;
}
function formatAccountLabel(account: Account): string {
  return `${account.code} — ${account.name}`;
}

async function refresh(): Promise<void> {
  const token = beginRequest();
  loading.value = true;
  error.value = null;
  try {
    const result = await getJournalEntries({
      bookId: props.bookId,
      from: from.value || undefined,
      to: toDate.value || undefined,
      accountCode: accountCode.value || undefined,
    });
    if (!isCurrent(token)) return;
    if (!result.ok) {
      error.value = result.error;
      entries.value = [];
      serverVoidedIds.value = [];
      return;
    }
    entries.value = result.data.entries;
    serverVoidedIds.value = result.data.voidedEntryIds;
  } finally {
    if (isCurrent(token)) loading.value = false;
  }
}

const filteredEntries = computed(() => entries.value);

// Set of original entry ids that have been voided. The server
// computes this from the *unfiltered* journal (so an account-filtered
// query — which drops void-marker rows because they have no lines —
// still strikes out the cancelled original). Source of truth on the
// server is `voidedIdSet()` in journal.ts.
const voidedEntryIds = computed(() => new Set(serverVoidedIds.value));

async function onVoid(entry: JournalEntry): Promise<void> {
  // Single dialog: the prompt is the confirmation. Cancelling
  // (returning null) cancels the void; entering empty text or a
  // reason proceeds.
  const reason = window.prompt(t("pluginAccounting.journalList.voidReason"));
  if (reason === null) return;
  try {
    const result = await voidEntry({ entryId: entry.id, reason: reason || undefined, bookId: props.bookId });
    if (!result.ok) {
      error.value = result.error;
      return;
    }
    emit("changed");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

watch(() => [props.bookId, props.version, from.value, toDate.value, accountCode.value], refresh, { immediate: true });
</script>
