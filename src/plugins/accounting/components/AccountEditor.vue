<template>
  <!-- Inline editor used by AccountsModal both for "Edit" on an
       existing row and per-section "+ Add" buttons. The parent
       owns the open/closed state and the draft instance — this
       component is dumb. -->
  <form
    class="flex flex-col gap-2 p-2 border border-blue-200 bg-blue-50/40 rounded text-sm"
    :data-testid="isNew ? 'accounting-accounts-form-new' : `accounting-accounts-form-edit-${draft.code}`"
    @submit.prevent="onSubmit"
  >
    <div class="flex flex-wrap gap-2">
      <label class="text-xs text-gray-500 flex flex-col gap-1 w-24">
        {{ t("pluginAccounting.accounts.columnCode") }}
        <input
          v-model="local.code"
          type="text"
          class="h-8 px-2 rounded border border-gray-300 text-sm font-mono disabled:bg-gray-100 disabled:text-gray-500"
          :disabled="!isNew"
          data-testid="accounting-accounts-form-code"
        />
      </label>
      <label class="text-xs text-gray-500 flex flex-col gap-1 grow min-w-[10rem]">
        {{ t("pluginAccounting.accounts.columnName") }}
        <input
          ref="nameInput"
          v-model="local.name"
          type="text"
          required
          class="h-8 px-2 rounded border border-gray-300 text-sm"
          data-testid="accounting-accounts-form-name"
        />
      </label>
      <label class="text-xs text-gray-500 flex flex-col gap-1 w-32">
        {{ t("pluginAccounting.accounts.columnType") }}
        <!-- Type is locked for new accounts: the per-category
             "+ Add" button already chose it (and the suggested
             code is keyed off it). Allowing the user to flip the
             type here would invalidate both the suggestion and
             the editor's section placement. Existing-account
             edits keep the select enabled — type changes there
             are intentional and the server invalidates snapshots
             when they happen. -->
        <select
          v-model="local.type"
          class="h-8 px-2 rounded border border-gray-300 text-sm bg-white disabled:bg-gray-100 disabled:text-gray-500"
          :disabled="isNew"
          data-testid="accounting-accounts-form-type"
        >
          <option v-for="option in TYPE_OPTIONS" :key="option" :value="option">
            {{ t(`pluginAccounting.accounts.typeOption.${option}`) }}
          </option>
        </select>
      </label>
    </div>
    <label class="text-xs text-gray-500 flex flex-col gap-1">
      {{ t("pluginAccounting.accounts.columnNote") }} <span class="text-gray-400">{{ t("pluginAccounting.accounts.noteOptional") }}</span>
      <input v-model="local.note" type="text" class="h-8 px-2 rounded border border-gray-300 text-sm" data-testid="accounting-accounts-form-note" />
    </label>
    <p v-if="!isNew" class="text-xs text-gray-400">{{ t("pluginAccounting.accounts.codeReadOnlyHint") }}</p>
    <p v-if="error" class="text-xs text-red-500" data-testid="accounting-accounts-form-error">{{ error }}</p>
    <div class="flex justify-end gap-2">
      <button
        type="button"
        class="h-8 px-2.5 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
        data-testid="accounting-accounts-form-cancel"
        @click="emit('cancel')"
      >
        {{ t("pluginAccounting.accounts.cancel") }}
      </button>
      <button
        type="submit"
        class="h-8 px-2.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50"
        :disabled="busy"
        data-testid="accounting-accounts-form-save"
      >
        {{ busy ? t("pluginAccounting.accounts.saving") : t("pluginAccounting.accounts.save") }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { nextTick, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { AccountType } from "../api";
import type { AccountDraft } from "./accountDraft";

const { t } = useI18n();

const props = defineProps<{ draft: AccountDraft; isNew: boolean; busy: boolean; error: string | null }>();
const emit = defineEmits<{ save: [draft: AccountDraft]; cancel: [] }>();

const TYPE_OPTIONS: readonly AccountType[] = ["asset", "liability", "equity", "income", "expense"];

// Local copy so the parent's `draft` ref stays untouched until the
// user clicks Save. Cancelling reverts cleanly because the parent
// just discards its draft.
const local = reactive<AccountDraft>({ ...props.draft });
const nameInput = ref<HTMLInputElement | null>(null);

// Re-sync when the parent swaps which account is being edited
// (e.g. user clicks Edit on a different row without first
// cancelling). Single watcher rather than per-field copy to keep
// behaviour boringly predictable.
watch(
  () => props.draft,
  (next) => {
    local.code = next.code;
    local.name = next.name;
    local.type = next.type;
    local.note = next.note;
  },
);

onMounted(() => {
  // Land the cursor in the field the user actually has to fill in:
  //   - new accounts: code is suggested and type is locked, so
  //     Name is the only non-decorative input.
  //   - edits: code is disabled, type is rarely the reason for
  //     editing — Name is still the most likely target. Keeping
  //     focus consistent across new/edit avoids surprise.
  void nextTick(() => nameInput.value?.focus());
});

function onSubmit(): void {
  emit("save", { code: local.code, name: local.name, type: local.type, note: local.note });
}
</script>
