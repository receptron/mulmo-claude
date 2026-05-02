<template>
  <!-- Manage-accounts modal. Opened from JournalEntryForm and
       OpeningBalancesForm. Lists the current chart of accounts
       grouped by type, with inline add / edit. Stays open across
       saves so the user can fix several accounts in a row. -->
  <div
    class="fixed inset-0 z-50 bg-black/20 flex items-center justify-center"
    role="dialog"
    aria-modal="true"
    data-testid="accounting-accounts-modal"
    @click.self="onBackdropClick"
    @keydown.esc="emit('close')"
  >
    <div class="bg-white rounded shadow-lg w-[32rem] max-h-[80vh] flex flex-col">
      <header class="flex items-center justify-between px-4 py-2 border-b border-gray-200 shrink-0">
        <h3 class="text-base font-semibold">{{ t("pluginAccounting.accounts.modalTitle") }}</h3>
        <button
          ref="closeButton"
          type="button"
          class="h-8 w-8 flex items-center justify-center rounded text-gray-500 hover:bg-gray-100"
          data-testid="accounting-accounts-close"
          :aria-label="t('pluginAccounting.common.cancel')"
          @click="emit('close')"
        >
          <span class="material-icons text-base">close</span>
        </button>
      </header>
      <div class="flex-1 overflow-auto px-4 py-3 flex flex-col gap-3">
        <p v-if="successMessage" class="text-xs text-green-600" data-testid="accounting-accounts-success">{{ successMessage }}</p>
        <section v-for="group in groups" :key="group.type" class="flex flex-col gap-1">
          <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ t(`pluginAccounting.accounts.sectionTitle.${group.type}`) }}</h4>
          <div v-if="group.accounts.length === 0" class="text-xs text-gray-400 italic px-1">{{ t("pluginAccounting.common.empty") }}</div>
          <template v-for="account in group.accounts" :key="account.code">
            <AccountRow v-if="editingCode !== account.code" :account="account" @edit="onEdit(account)" />
            <AccountEditor v-else :draft="draft" :is-new="false" :busy="saving" :error="error" @save="onSave" @cancel="onCancelEditor" />
          </template>
        </section>
        <div class="border-t border-gray-200 pt-3">
          <button
            v-if="!addingNew"
            type="button"
            class="h-8 px-2.5 flex items-center gap-1 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
            data-testid="accounting-accounts-add"
            @click="onAdd"
          >
            <span class="material-icons text-base">add</span>
            <span>{{ t("pluginAccounting.accounts.addAccount") }}</span>
          </button>
          <AccountEditor v-else :draft="draft" is-new :busy="saving" :error="error" @save="onSave" @cancel="onCancelEditor" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { upsertAccount, type Account, type AccountType } from "../api";
import AccountRow from "./AccountRow.vue";
import AccountEditor from "./AccountEditor.vue";
import type { AccountDraft } from "./accountDraft";

const { t } = useI18n();

const props = defineProps<{ bookId: string; accounts: Account[] }>();
const emit = defineEmits<{ close: []; changed: [] }>();

// Order matches conventional financial-statement layout (B/S then
// P/L). Section titles are pulled from i18n via the literal type
// keys, so this array drives both ordering and visibility.
const ACCOUNT_TYPES: readonly AccountType[] = ["asset", "liability", "equity", "income", "expense"];
const RESERVED_PREFIX = "_";
const SUCCESS_FADE_MS = 2500;

interface AccountGroup {
  type: AccountType;
  accounts: Account[];
}

const groups = computed<AccountGroup[]>(() =>
  ACCOUNT_TYPES.map((type) => ({
    type,
    accounts: props.accounts
      .filter((account) => account.type === type)
      .slice()
      .sort(byCode),
  })),
);

function byCode(left: Account, right: Account): number {
  return left.code.localeCompare(right.code);
}

const editingCode = ref<string | null>(null);
const addingNew = ref(false);
const draft = ref<AccountDraft>(emptyDraft());
const saving = ref(false);
const error = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
let successTimer: ReturnType<typeof setTimeout> | null = null;

function emptyDraft(): AccountDraft {
  return { code: "", name: "", type: "asset", note: "" };
}

function onEdit(account: Account): void {
  // Collapse any other editor first so only one is open at a time.
  addingNew.value = false;
  error.value = null;
  draft.value = { code: account.code, name: account.name, type: account.type, note: account.note ?? "" };
  editingCode.value = account.code;
}

function onAdd(): void {
  editingCode.value = null;
  error.value = null;
  draft.value = emptyDraft();
  addingNew.value = true;
}

function onCancelEditor(): void {
  editingCode.value = null;
  addingNew.value = false;
  error.value = null;
  draft.value = emptyDraft();
}

function validateDraft(next: AccountDraft, isNew: boolean): string | null {
  const trimmedCode = next.code.trim();
  const trimmedName = next.name.trim();
  if (trimmedCode.length === 0) return t("pluginAccounting.accounts.errorEmptyCode");
  if (trimmedCode.startsWith(RESERVED_PREFIX)) return t("pluginAccounting.accounts.errorReservedCode");
  if (trimmedName.length === 0) return t("pluginAccounting.accounts.errorEmptyName");
  // For a brand-new entry, the code must not collide with an
  // existing account. Without this guard, the server would silently
  // overwrite the existing account's name / type / note (the
  // "upsert" semantic), which is rarely what the user typing into
  // the "Add account" form intended.
  if (isNew && props.accounts.some((account) => account.code === trimmedCode)) {
    return t("pluginAccounting.accounts.errorDuplicateCode");
  }
  return null;
}

async function onSave(next: AccountDraft): Promise<void> {
  if (saving.value) return;
  const isNew = addingNew.value;
  const validation = validateDraft(next, isNew);
  if (validation !== null) {
    error.value = validation;
    return;
  }
  saving.value = true;
  error.value = null;
  try {
    const account: Account = {
      code: next.code.trim(),
      name: next.name.trim(),
      type: next.type,
    };
    const note = next.note.trim();
    if (note.length > 0) account.note = note;
    const result = await upsertAccount(account, props.bookId);
    if (!result.ok) {
      error.value = result.error;
      return;
    }
    onCancelEditor();
    showSuccess(t("pluginAccounting.accounts.success"));
    emit("changed");
  } catch (err) {
    // apiPost normally folds network / HTTP failures into
    // result.ok=false, so this is a belt-and-braces guard against
    // a runtime failure that would otherwise leave the Save button
    // stuck on "Saving…".
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

function showSuccess(message: string): void {
  successMessage.value = message;
  if (successTimer !== null) clearTimeout(successTimer);
  successTimer = setTimeout(() => {
    successMessage.value = null;
    successTimer = null;
  }, SUCCESS_FADE_MS);
}

function onBackdropClick(): void {
  emit("close");
}

onMounted(() => {
  // Initial focus on the close button so Esc / Tab work
  // immediately and the user isn't dropped into an editor field
  // they didn't ask for.
  void nextTick(() => closeButton.value?.focus());
});

onUnmounted(() => {
  if (successTimer !== null) clearTimeout(successTimer);
});
</script>
