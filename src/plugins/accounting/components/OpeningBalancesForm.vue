<template>
  <form class="flex flex-col gap-3" data-testid="accounting-opening-form" @submit.prevent="onSubmit">
    <h3 class="text-base font-semibold">{{ t("pluginAccounting.openingForm.title") }}</h3>
    <p class="text-xs text-gray-500">{{ t("pluginAccounting.openingForm.explainer") }}</p>
    <div v-if="existing" class="text-xs text-gray-500" data-testid="accounting-opening-existing">
      {{ t("pluginAccounting.openingForm.setBy", { date: existing.date }) }}
      <span v-if="existing" class="text-amber-600 ml-2">{{ t("pluginAccounting.openingForm.replaceWarning") }}</span>
    </div>
    <p v-else class="text-xs text-gray-400" data-testid="accounting-opening-none">{{ t("pluginAccounting.openingForm.none") }}</p>
    <label class="text-xs text-gray-500 flex flex-col gap-1 w-fit">
      {{ t("pluginAccounting.openingForm.asOfLabel") }}
      <input v-model="asOfDate" type="date" required class="h-8 px-2 rounded border border-gray-300 text-sm" data-testid="accounting-opening-asof" />
    </label>
    <table class="w-full text-sm">
      <thead>
        <tr class="text-xs text-gray-500 border-b border-gray-200">
          <th class="text-left py-1 px-2">{{ t("pluginAccounting.entryForm.accountLabel") }}</th>
          <th class="text-right py-1 px-2 w-32">{{ t("pluginAccounting.entryForm.debitLabel") }}</th>
          <th class="text-right py-1 px-2 w-32">{{ t("pluginAccounting.entryForm.creditLabel") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="account in bsAccounts" :key="account.code" class="border-b border-gray-100">
          <td class="py-1 px-2">
            <span class="font-mono text-xs">{{ account.code }}</span>
            <span class="ml-2">{{ account.name }}</span>
            <span class="ml-2 text-xs text-gray-400">{{ account.type }}</span>
          </td>
          <td class="py-1 px-2">
            <input
              v-model.number="rows[account.code].debit"
              type="number"
              :step="step"
              min="0"
              class="h-8 px-2 w-full rounded border border-gray-300 text-sm text-right"
              :data-testid="`accounting-opening-debit-${account.code}`"
              @input="onDebitInput(account.code)"
            />
          </td>
          <td class="py-1 px-2">
            <input
              v-model.number="rows[account.code].credit"
              type="number"
              :step="step"
              min="0"
              class="h-8 px-2 w-full rounded border border-gray-300 text-sm text-right"
              :data-testid="`accounting-opening-credit-${account.code}`"
              @input="onCreditInput(account.code)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <div class="flex items-center justify-between">
      <span class="text-xs text-gray-400">{{ t("pluginAccounting.openingForm.explainer2") }}</span>
      <span :class="balanced ? 'text-green-600' : 'text-red-500'" class="text-xs" data-testid="accounting-opening-balance">
        {{ balanced ? t("pluginAccounting.entryForm.balanced") : t("pluginAccounting.entryForm.imbalance", { amount: imbalanceText }) }}
      </span>
    </div>
    <p v-if="error" class="text-xs text-red-500" data-testid="accounting-opening-error">{{ error }}</p>
    <p v-if="successMessage" class="text-xs text-green-600" data-testid="accounting-opening-success">{{ successMessage }}</p>
    <div class="flex justify-end">
      <button
        type="submit"
        class="h-8 px-3 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50"
        :disabled="!balanced || submitting"
        data-testid="accounting-opening-submit"
      >
        {{ submitting ? t("pluginAccounting.entryForm.submitting") : t("pluginAccounting.openingForm.submit") }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getOpeningBalances, setOpeningBalances, type Account, type JournalEntry, type JournalLine } from "../api";
import { formatAmount, inputStepFor } from "../currencies";

const { t } = useI18n();

const props = defineProps<{ bookId: string; accounts: Account[]; currency: string; version: number }>();
const emit = defineEmits<{ submitted: [] }>();

interface OpeningRow {
  debit: number | null;
  credit: number | null;
}

const asOfDate = ref(new Date().toISOString().slice(0, 10));
const rows = ref<Record<string, OpeningRow>>({});
const existing = ref<JournalEntry | null>(null);
const submitting = ref(false);
const error = ref<string | null>(null);
const successMessage = ref<string | null>(null);

const bsAccounts = computed(() => props.accounts.filter((account) => account.type === "asset" || account.type === "liability" || account.type === "equity"));

function ensureRows(): void {
  for (const account of bsAccounts.value) {
    if (!rows.value[account.code]) rows.value[account.code] = { debit: null, credit: null };
  }
}

function onDebitInput(code: string): void {
  const row = rows.value[code];
  if (row.debit !== null && row.debit !== 0) row.credit = null;
}
function onCreditInput(code: string): void {
  const row = rows.value[code];
  if (row.credit !== null && row.credit !== 0) row.debit = null;
}

const imbalance = computed<number>(() => {
  let sum = 0;
  for (const code of Object.keys(rows.value)) {
    const row = rows.value[code];
    if (typeof row.debit === "number") sum += row.debit;
    if (typeof row.credit === "number") sum -= row.credit;
  }
  return sum;
});
const hasAnyNonzero = computed(() => {
  for (const code of Object.keys(rows.value)) {
    const row = rows.value[code];
    if ((row.debit ?? 0) > 0 || (row.credit ?? 0) > 0) return true;
  }
  return false;
});
const balanced = computed(() => Math.abs(imbalance.value) <= 0.005 && hasAnyNonzero.value);
const imbalanceText = computed(() => formatAmount(imbalance.value, props.currency));
const step = computed(() => inputStepFor(props.currency));

function toApiLines(): JournalLine[] {
  const out: JournalLine[] = [];
  for (const code of Object.keys(rows.value)) {
    const row = rows.value[code];
    if ((row.debit ?? 0) === 0 && (row.credit ?? 0) === 0) continue;
    const line: JournalLine = { accountCode: code };
    if ((row.debit ?? 0) > 0) line.debit = row.debit ?? undefined;
    if ((row.credit ?? 0) > 0) line.credit = row.credit ?? undefined;
    out.push(line);
  }
  return out;
}

async function loadExisting(): Promise<void> {
  const result = await getOpeningBalances(props.bookId);
  if (!result.ok) {
    existing.value = null;
    return;
  }
  existing.value = result.data.opening;
  if (result.data.opening) {
    asOfDate.value = result.data.opening.date;
    const fresh: Record<string, OpeningRow> = {};
    for (const account of bsAccounts.value) fresh[account.code] = { debit: null, credit: null };
    for (const line of result.data.opening.lines) {
      fresh[line.accountCode] = { debit: line.debit ?? null, credit: line.credit ?? null };
    }
    rows.value = fresh;
  }
}

async function onSubmit(): Promise<void> {
  if (submitting.value || !balanced.value) return;
  submitting.value = true;
  error.value = null;
  successMessage.value = null;
  try {
    const result = await setOpeningBalances({ bookId: props.bookId, asOfDate: asOfDate.value, lines: toApiLines() });
    if (!result.ok) {
      error.value = result.error;
      return;
    }
    successMessage.value = t("pluginAccounting.openingForm.success");
    emit("submitted");
  } finally {
    submitting.value = false;
  }
}

watch(
  () => [props.bookId, props.version, props.accounts.length],
  () => {
    ensureRows();
    void loadExisting();
  },
  { immediate: true },
);
</script>
