<template>
  <!-- Manage-accounts modal. Opened from JournalEntryForm and
       OpeningBalancesForm. Lists the current chart of accounts
       grouped by type, with inline add / edit. Stays open across
       saves so the user can fix several accounts in a row. -->
  <div
    class="fixed inset-0 z-50 bg-black/20 flex items-center justify-center"
    role="dialog"
    aria-modal="true"
    aria-labelledby="accounting-accounts-modal-title"
    data-testid="accounting-accounts-modal"
    @click.self="onBackdropClick"
    @keydown.esc="emit('close')"
  >
    <div class="bg-white rounded shadow-lg w-[32rem] max-h-[80vh] flex flex-col">
      <header class="flex items-center justify-between px-4 py-2 border-b border-gray-200 shrink-0">
        <h3 id="accounting-accounts-modal-title" class="text-base font-semibold">{{ t("pluginAccounting.accounts.modalTitle") }}</h3>
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
        <p v-if="toggleError" class="text-xs text-red-500" data-testid="accounting-accounts-toggle-error">{{ toggleError }}</p>
        <section v-for="group in groups" :key="group.type" class="flex flex-col gap-1">
          <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ t(`pluginAccounting.accounts.sectionTitle.${group.type}`) }}</h4>
          <div v-if="group.accounts.length === 0" class="text-xs text-gray-400 italic px-1">{{ t("pluginAccounting.common.empty") }}</div>
          <template v-for="account in group.accounts" :key="account.code">
            <AccountRow v-if="editingCode !== account.code" :account="account" @edit="onEdit(account)" @toggle-active="onToggleActive(account)" />
            <AccountEditor v-else :draft="draft" :is-new="false" :busy="saving" :error="error" @save="onSave" @cancel="onCancelEditor" />
          </template>
          <div v-if="addingNew && draft.type === group.type" :ref="(node) => bindNewEditor(node, group.type)">
            <AccountEditor :draft="draft" is-new :busy="saving" :error="error" @save="onSave" @cancel="onCancelEditor" />
          </div>
          <button
            v-else
            type="button"
            class="self-start h-8 px-2.5 flex items-center gap-1 rounded text-xs text-gray-600 hover:bg-gray-100"
            :data-testid="`accounting-accounts-add-${group.type}`"
            @click="onAdd(group.type)"
          >
            <span class="material-icons text-sm">add</span>
            <span>{{ t("pluginAccounting.accounts.addToCategory", { type: t(`pluginAccounting.accounts.typeOption.${group.type}`) }) }}</span>
          </button>
        </section>
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
import { validateAccountDraft, type AccountValidationError } from "./accountValidation";
import { suggestNextCode } from "./accountNumbering";

const { t } = useI18n();

const props = defineProps<{ bookId: string; accounts: Account[] }>();
const emit = defineEmits<{ close: []; changed: [] }>();

// Order matches conventional financial-statement layout (B/S then
// P/L). Section titles are pulled from i18n via the literal type
// keys, so this array drives both ordering and visibility.
const ACCOUNT_TYPES: readonly AccountType[] = ["asset", "liability", "equity", "income", "expense"];
const SUCCESS_FADE_MS = 2500;

const VALIDATION_MESSAGE_KEYS: Record<AccountValidationError, string> = {
  emptyCode: "pluginAccounting.accounts.errorEmptyCode",
  reservedCode: "pluginAccounting.accounts.errorReservedCode",
  invalidCodeFormat: "pluginAccounting.accounts.errorInvalidCodeFormat",
  codeTypeMismatch: "pluginAccounting.accounts.errorCodeTypeMismatch",
  emptyName: "pluginAccounting.accounts.errorEmptyName",
  duplicateCode: "pluginAccounting.accounts.errorDuplicateCode",
};

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
const draft = ref<AccountDraft>(emptyDraft("asset"));
const saving = ref(false);
const error = ref<string | null>(null);
// Toggle (Deactivate / Reactivate) keeps its own state. Sharing
// `saving` / `error` with the editor would (a) hide a toggle
// failure when no editor is mounted to render `:error`, and (b)
// blank out an in-progress editor's validation message and
// freeze its Save button when the user fires a toggle on a
// different row.
const toggleSaving = ref(false);
const toggleError = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const newEditorWrapper = ref<HTMLDivElement | null>(null);
let successTimer: ReturnType<typeof setTimeout> | null = null;

function emptyDraft(type: AccountType): AccountDraft {
  return { code: "", name: "", type, note: "" };
}

function draftForNew(type: AccountType): AccountDraft {
  return { code: suggestNextCode(type, props.accounts), name: "", type, note: "" };
}

// Vue's `:ref` on a v-for-style element gives us back either the
// node or null (on unmount). We only want to capture the editor
// belonging to the section that owns the current draft, so the
// section type is checked here rather than relying on the order
// in which Vue invokes the function refs.
function bindNewEditor(node: Element | object | null, sectionType: AccountType): void {
  if (sectionType !== draft.value.type) return;
  newEditorWrapper.value = (node as HTMLDivElement | null) ?? null;
}

function onEdit(account: Account): void {
  // Collapse any other editor first so only one is open at a time.
  addingNew.value = false;
  error.value = null;
  draft.value = { code: account.code, name: account.name, type: account.type, note: account.note ?? "" };
  editingCode.value = account.code;
}

function onAdd(type: AccountType): void {
  editingCode.value = null;
  error.value = null;
  draft.value = draftForNew(type);
  addingNew.value = true;
  // Scroll the new in-place editor into view in case the section
  // sits below the visible viewport — opening the editor without
  // scrolling would leave the user staring at unchanged content
  // above the fold.
  void nextTick(() => {
    newEditorWrapper.value?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function onCancelEditor(): void {
  editingCode.value = null;
  addingNew.value = false;
  error.value = null;
  draft.value = emptyDraft("asset");
}

function validateDraft(next: AccountDraft, isNew: boolean): string | null {
  const code = validateAccountDraft(next, props.accounts, isNew);
  return code === null ? null : t(VALIDATION_MESSAGE_KEYS[code]);
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
    // Preserve the existing active flag on edit — the editor
    // doesn't surface the field, so reading from props.accounts
    // is the only place the truth lives.
    if (!isNew) {
      const existing = props.accounts.find((entry) => entry.code === account.code);
      if (existing?.active === false) account.active = false;
    }
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

async function onToggleActive(account: Account): Promise<void> {
  // No confirm dialog: deactivation hides the account from the
  // entry/ledger dropdowns but is fully reversible via Reactivate
  // on the same row, and historical entries are unaffected. A
  // confirm prompt was over-protective for an action that's a
  // single click to undo.
  //
  // Toggle uses its own `toggleSaving` / `toggleError` refs rather
  // than the AccountEditor's shared `saving` / `error` so that:
  //   1. a toggle while an editor is open doesn't clear the
  //      editor's validation message or pin its Save button to
  //      "Saving…", and
  //   2. a toggle failure still surfaces (via the toggle banner)
  //      when no editor is mounted to render `:error`.
  if (toggleSaving.value) return;
  const willDeactivate = account.active !== false;
  toggleSaving.value = true;
  toggleError.value = null;
  try {
    const next: Account = {
      code: account.code,
      name: account.name,
      type: account.type,
    };
    if (account.note !== undefined && account.note.length > 0) next.note = account.note;
    // Send the active flag explicitly so the server can tell
    // "user wants to (de)activate" apart from "user is editing
    // and didn't mention active" — the latter inherits the
    // existing flag and would otherwise turn Reactivate into a
    // no-op.
    next.active = !willDeactivate;
    const result = await upsertAccount(next, props.bookId);
    if (!result.ok) {
      toggleError.value = result.error;
      return;
    }
    showSuccess(t("pluginAccounting.accounts.success"));
    emit("changed");
  } catch (err) {
    toggleError.value = err instanceof Error ? err.message : String(err);
  } finally {
    toggleSaving.value = false;
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
