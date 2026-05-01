<template>
  <div class="flex flex-col gap-3" data-testid="accounting-ledger">
    <div class="flex items-end gap-3">
      <label class="text-xs text-gray-500 flex flex-col gap-1">
        {{ t("pluginAccounting.ledger.selectAccount") }}
        <select v-model="accountCode" class="h-8 px-2 rounded border border-gray-300 text-sm bg-white" data-testid="accounting-ledger-account">
          <option value="">{{ DASH }}</option>
          <option v-for="account in accounts" :key="account.code" :value="account.code">{{ formatAccountLabel(account) }}</option>
        </select>
      </label>
      <button class="h-8 px-2.5 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50" @click="refresh">
        <span class="material-icons text-base align-middle">refresh</span>
      </button>
    </div>
    <p v-if="loading" class="text-xs text-gray-400">{{ t("pluginAccounting.common.loading") }}</p>
    <p v-else-if="error" class="text-xs text-red-500">{{ t("pluginAccounting.common.error", { error }) }}</p>
    <template v-else-if="ledger">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-xs text-gray-500 border-b border-gray-200">
            <th class="text-left py-1 px-2">{{ t("pluginAccounting.ledger.columns.date") }}</th>
            <th class="text-left py-1 px-2">{{ t("pluginAccounting.ledger.columns.memo") }}</th>
            <th class="text-right py-1 px-2 w-28">{{ t("pluginAccounting.ledger.columns.debit") }}</th>
            <th class="text-right py-1 px-2 w-28">{{ t("pluginAccounting.ledger.columns.credit") }}</th>
            <th class="text-right py-1 px-2 w-28">{{ t("pluginAccounting.ledger.columns.balance") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in ledger.rows"
            :key="`${row.entryId}-${row.date}`"
            :class="row.kind === 'void' || row.kind === 'void-marker' ? 'text-gray-400 line-through' : ''"
            class="border-b border-gray-100"
          >
            <td class="py-1 px-2 whitespace-nowrap">{{ row.date }}</td>
            <td class="py-1 px-2">
              <span v-if="row.memo">{{ row.memo }}</span>
            </td>
            <td class="py-1 px-2 text-right">
              <span v-if="row.debit">{{ formatAmount(row.debit) }}</span>
            </td>
            <td class="py-1 px-2 text-right">
              <span v-if="row.credit">{{ formatAmount(row.credit) }}</span>
            </td>
            <td class="py-1 px-2 text-right font-mono">{{ formatAmount(row.runningBalance) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="font-semibold border-t border-gray-300">
            <td colspan="4" class="py-1 px-2 text-right">{{ t("pluginAccounting.ledger.closingBalance") }}</td>
            <td class="py-1 px-2 text-right">{{ formatAmount(ledger.closingBalance) }}</td>
          </tr>
        </tfoot>
      </table>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getLedger, type Account, type Ledger } from "../api";
import { formatAmount as formatAmountWithCurrency } from "../currencies";
import { useLatestRequest } from "./useLatestRequest";

const { t } = useI18n();

const props = defineProps<{ bookId: string; accounts: Account[]; currency: string; version: number }>();

const DASH = "—";
const accountCode = ref("");
const ledger = ref<Ledger | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const { begin: beginRequest, isCurrent } = useLatestRequest();

function formatAmount(value: number): string {
  return formatAmountWithCurrency(value, props.currency);
}

function formatAccountLabel(account: Account): string {
  return `${account.code} — ${account.name}`;
}

async function refresh(): Promise<void> {
  const token = beginRequest();
  if (!accountCode.value) {
    ledger.value = null;
    error.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const result = await getLedger(accountCode.value, undefined, props.bookId);
    // Drop the result if a newer refresh started (bookId or
    // accountCode changed under us) — otherwise a slower earlier
    // request could overwrite the fresh ledger.
    if (!isCurrent(token)) return;
    if (!result.ok) {
      error.value = result.error;
      ledger.value = null;
      return;
    }
    ledger.value = result.data.ledger;
  } finally {
    if (isCurrent(token)) loading.value = false;
  }
}

watch(() => [props.bookId, props.version, accountCode.value], refresh, { immediate: true });
</script>
