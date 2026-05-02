<template>
  <form class="flex flex-col gap-3" data-testid="accounting-entry-form" @submit.prevent="onSubmit">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-base font-semibold">{{ t("pluginAccounting.entryForm.title") }}</h3>
      <button
        type="button"
        class="h-8 px-2.5 flex items-center gap-1 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
        data-testid="accounting-entry-manage-accounts"
        @click="showAccountsModal = true"
      >
        <span class="material-icons text-base">tune</span>
        <span>{{ t("pluginAccounting.accounts.manageButton") }}</span>
      </button>
    </div>
    <div class="flex flex-wrap gap-3">
      <label class="text-xs text-gray-500 flex flex-col gap-1">
        {{ t("pluginAccounting.entryForm.dateLabel") }}
        <input v-model="date" type="date" required class="h-8 px-2 rounded border border-gray-300 text-sm" data-testid="accounting-entry-date" />
      </label>
      <label class="text-xs text-gray-500 flex flex-col gap-1 grow min-w-0">
        {{ t("pluginAccounting.entryForm.memoLabel") }}
        <input v-model="memo" type="text" class="h-8 px-2 rounded border border-gray-300 text-sm" data-testid="accounting-entry-memo" />
      </label>
    </div>
    <table class="w-full text-sm">
      <thead>
        <tr class="text-xs text-gray-500 border-b border-gray-200">
          <th class="text-left py-1 px-2">{{ t("pluginAccounting.entryForm.accountLabel") }}</th>
          <th class="text-right py-1 px-2 w-32">{{ t("pluginAccounting.entryForm.debitLabel") }}</th>
          <th class="text-right py-1 px-2 w-32">{{ t("pluginAccounting.entryForm.creditLabel") }}</th>
          <th class="py-1 px-2"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(line, idx) in lines" :key="idx" class="border-b border-gray-100">
          <td class="py-1 px-2">
            <select
              v-model="line.accountCode"
              class="h-8 px-2 w-full rounded border border-gray-300 text-sm bg-white"
              :data-testid="`accounting-entry-line-account-${idx}`"
            >
              <option value="">{{ DASH }}</option>
              <option v-for="account in selectableAccounts" :key="account.code" :value="account.code">{{ formatAccountLabel(account) }}</option>
            </select>
          </td>
          <td class="py-1 px-2">
            <input
              v-model.number="line.debit"
              type="number"
              :step="step"
              min="0"
              class="h-8 px-2 w-full rounded border border-gray-300 text-sm text-right"
              :data-testid="`accounting-entry-line-debit-${idx}`"
              @input="onDebitInput(line)"
            />
          </td>
          <td class="py-1 px-2">
            <input
              v-model.number="line.credit"
              type="number"
              :step="step"
              min="0"
              class="h-8 px-2 w-full rounded border border-gray-300 text-sm text-right"
              :data-testid="`accounting-entry-line-credit-${idx}`"
              @input="onCreditInput(line)"
            />
          </td>
          <td class="py-1 px-2 text-right">
            <button v-if="lines.length > 2" type="button" class="text-xs text-red-500 hover:underline" @click="lines.splice(idx, 1)">
              {{ t("pluginAccounting.entryForm.removeLine") }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="flex items-center justify-between">
      <button
        type="button"
        class="h-8 px-2.5 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
        data-testid="accounting-entry-add-line"
        @click="addLine"
      >
        <span class="material-icons text-base align-middle">add</span>{{ t("pluginAccounting.entryForm.addLine") }}
      </button>
      <span :class="balanced ? 'text-green-600' : 'text-red-500'" class="text-xs" data-testid="accounting-entry-balance">
        {{ balanced ? t("pluginAccounting.entryForm.balanced") : t("pluginAccounting.entryForm.imbalance", { amount: imbalanceText }) }}
      </span>
    </div>
    <p v-if="error" class="text-xs text-red-500" data-testid="accounting-entry-error">{{ error }}</p>
    <p v-if="successMessage" class="text-xs text-green-600" data-testid="accounting-entry-success">{{ successMessage }}</p>
    <div class="flex justify-end">
      <button
        type="submit"
        class="h-8 px-3 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50"
        :disabled="!balanced || submitting"
        data-testid="accounting-entry-submit"
      >
        {{ submitting ? t("pluginAccounting.entryForm.submitting") : t("pluginAccounting.entryForm.submit") }}
      </button>
    </div>
  </form>
  <!-- Sibling of the parent <form> on purpose: the modal renders
       its own <form @submit.prevent> for the inline editor, and
       nesting <form>s is invalid HTML that breaks Enter-key submit
       routing in some browsers. Vue 3 multi-root templates let us
       keep the markup flat with no wrapper div. -->
  <AccountsModal v-if="showAccountsModal" :book-id="bookId" :accounts="accounts" @close="showAccountsModal = false" @changed="emit('accountsChanged')" />
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { addEntry, type Account, type JournalLine } from "../api";
import { formatAmount, inputStepFor } from "../currencies";
import { localDateString } from "../dates";
import AccountsModal from "./AccountsModal.vue";

const { t } = useI18n();

const props = defineProps<{ bookId: string; accounts: Account[]; currency: string }>();
const emit = defineEmits<{ submitted: []; accountsChanged: [] }>();

const showAccountsModal = ref(false);

const DASH = "—";

function formatAccountLabel(account: Account): string {
  // Name first so type-to-search in the <select> matches the
  // human-meaningful word; the code goes in trailing parens.
  return `${account.name} (${account.code})`;
}

// Hide deactivated accounts from the entry dropdown — accounting
// integrity requires keeping them in the chart of accounts (any
// historical journal line still references the code), but new
// entries should not be able to land on a soft-deleted account.
const selectableAccounts = computed<Account[]>(() => props.accounts.filter((account) => account.active !== false));
const selectableAccountCodes = computed<Set<string>>(() => new Set(selectableAccounts.value.map((account) => account.code)));

interface FormLine {
  accountCode: string;
  debit: number | null;
  credit: number | null;
}

function blankLine(): FormLine {
  return { accountCode: "", debit: null, credit: null };
}

const date = ref(localDateString());
const memo = ref("");
const lines = ref<FormLine[]>([blankLine(), blankLine()]);
const submitting = ref(false);
const error = ref<string | null>(null);
const successMessage = ref<string | null>(null);

function addLine(): void {
  lines.value.push(blankLine());
}

// Toggling ensures a single line never has both sides set — the
// server validates this too, but doing it on input prevents a
// confusing UX where the running total goes negative as the user
// types.
function onDebitInput(line: FormLine): void {
  if (line.debit !== null && line.debit !== 0) line.credit = null;
}
function onCreditInput(line: FormLine): void {
  if (line.credit !== null && line.credit !== 0) line.debit = null;
}

// Imbalance is computed off lines that are *postable* (have an
// accountCode + a positive amount). Without that filter,
// `balanced` could be `true` even when `toApiLines()` would drop a
// row, and the user would hit a confusing "needs ≥ 2 lines" error
// from the server on submit.
const imbalance = computed<number>(() => {
  let sum = 0;
  for (const line of lines.value) {
    if (!isPostable(line)) continue;
    if (isPositiveAmount(line.debit)) sum += line.debit;
    if (isPositiveAmount(line.credit)) sum -= line.credit;
  }
  return sum;
});
const hasAtLeastTwoPostableLines = computed(() => {
  let count = 0;
  for (const line of lines.value) {
    if (!isPostable(line)) continue;
    count += 1;
    if (count >= 2) return true;
  }
  return false;
});
const balanced = computed(() => Math.abs(imbalance.value) <= 0.005 && hasAtLeastTwoPostableLines.value);
const imbalanceText = computed(() => formatAmount(imbalance.value, props.currency));
const step = computed(() => inputStepFor(props.currency));

function isPositiveAmount(value: unknown): value is number {
  // Robust against the empty string `v-model.number` produces when
  // the user clears a previously-typed field — `"" ?? 0 === 0` is
  // false so a naive truthy check would let the empty input through
  // as a phantom zero amount.
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPostable(line: FormLine): boolean {
  if (!line.accountCode) return false;
  // Defence-in-depth against a code that was selectable when the
  // user picked it but got deactivated mid-edit. Hiding the
  // option from the dropdown alone isn't enough — the form's
  // `accountCode` value is sticky, so a stale selection would
  // still be POSTed if the user just hits submit. Gating
  // postability here also flows through to `balanced` and
  // `hasAtLeastTwoPostableLines`, so the submit button disables
  // and the user gets immediate feedback.
  if (!selectableAccountCodes.value.has(line.accountCode)) return false;
  return isPositiveAmount(line.debit) || isPositiveAmount(line.credit);
}

function toApiLines(): JournalLine[] {
  const out: JournalLine[] = [];
  for (const line of lines.value) {
    if (!isPostable(line)) continue;
    const apiLine: JournalLine = { accountCode: line.accountCode };
    if (isPositiveAmount(line.debit)) apiLine.debit = line.debit;
    if (isPositiveAmount(line.credit)) apiLine.credit = line.credit;
    out.push(apiLine);
  }
  return out;
}

async function onSubmit(): Promise<void> {
  if (submitting.value || !balanced.value) return;
  submitting.value = true;
  error.value = null;
  successMessage.value = null;
  try {
    const result = await addEntry({
      bookId: props.bookId,
      date: date.value,
      memo: memo.value.trim() || undefined,
      lines: toApiLines(),
    });
    if (!result.ok) {
      error.value = result.error;
      return;
    }
    successMessage.value = t("pluginAccounting.entryForm.success");
    lines.value = [blankLine(), blankLine()];
    memo.value = "";
    emit("submitted");
  } catch (err) {
    // apiPost normally folds network / HTTP failures into
    // `result.ok = false`, so this branch should be rare. It's a
    // belt-and-braces guard against a runtime failure leaving the
    // submit button stuck — the user gets a visible error
    // instead of an unhandled rejection.
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    submitting.value = false;
  }
}

// Reset the entire draft when bookId switches under us (rare but
// possible via BookSwitcher while the form is open). Carrying the
// previous book's lines and account codes into the new book is
// the worst kind of silent failure — the new book might not even
// have the same chart of accounts.
watch(
  () => props.bookId,
  () => {
    lines.value = [blankLine(), blankLine()];
    memo.value = "";
    date.value = localDateString();
    error.value = null;
    successMessage.value = null;
  },
);

// If an account the user already picked gets deactivated mid-edit
// (e.g. via the Manage Accounts modal in this form, or from
// another tab via pubsub), clear the line's accountCode so the
// <select> visibly resets to "—". Without this, the option is
// gone but the form's bound value still holds the stale code,
// which (a) leaves the user staring at a blank-looking select and
// (b) used to slip through to submit before the isPostable guard
// landed. Belt + suspenders.
watch(selectableAccountCodes, (codes) => {
  for (const line of lines.value) {
    if (line.accountCode && !codes.has(line.accountCode)) line.accountCode = "";
  }
});
</script>

<style scoped>
/* Hide the WebKit / Firefox spin buttons on amount inputs. The
   step attribute still controls validation; this is purely UI.
   Accounting amount fields don't benefit from a spinner — users
   type the number and the up/down arrows just clutter the row. */
input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type="number"] {
  -moz-appearance: textfield;
  appearance: textfield;
}
</style>
