<template>
  <!-- Modal for creating a new book. Shared between BookSwitcher
       (the "+ New book" button) and View.vue (auto-opened on first
       run when the workspace has zero books). The submit calls
       createBook directly; on success it emits the new book and
       its id, leaving the parent to wire activeBookId / refetch. -->
  <div class="fixed inset-0 z-50 bg-black/20 flex items-center justify-center" data-testid="accounting-new-book-modal" @click.self="onCancel">
    <form class="bg-white p-4 rounded shadow-lg w-96 flex flex-col gap-3" data-testid="accounting-new-book-form" @submit.prevent="onSubmit">
      <h3 class="text-base font-semibold">{{ t("pluginAccounting.bookSwitcher.newBook") }}</h3>
      <p v-if="firstRun" class="text-xs text-gray-500" data-testid="accounting-new-book-firstrun">{{ t("pluginAccounting.bookSwitcher.firstRunHint") }}</p>
      <label class="text-sm flex flex-col gap-1">
        {{ t("pluginAccounting.bookSwitcher.nameLabel") }}
        <input v-model="name" required class="h-8 px-2 rounded border border-gray-300 text-sm" data-testid="accounting-new-book-name" />
      </label>
      <label class="text-sm flex flex-col gap-1">
        {{ t("pluginAccounting.bookSwitcher.currencyLabel") }}
        <select v-model="currency" class="h-8 px-2 rounded border border-gray-300 text-sm bg-white" data-testid="accounting-new-book-currency">
          <option v-for="opt in options" :key="opt.code" :value="opt.code">{{ opt.label }}</option>
        </select>
      </label>
      <p v-if="error" class="text-xs text-red-500" data-testid="accounting-new-book-error">{{ error }}</p>
      <div class="flex justify-end gap-2 mt-1">
        <button v-if="cancelable" type="button" class="h-8 px-2.5 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-50" @click="onCancel">
          {{ t("pluginAccounting.common.cancel") }}
        </button>
        <button
          type="submit"
          class="h-8 px-2.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm"
          :disabled="creating"
          data-testid="accounting-new-book-submit"
        >
          {{ creating ? t("pluginAccounting.common.loading") : t("pluginAccounting.bookSwitcher.create") }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { createBook, type BookSummary } from "../api";
import { SUPPORTED_CURRENCY_CODES, localizedCurrencyName } from "../currencies";

const { t, locale } = useI18n();

const props = withDefaults(
  defineProps<{
    firstRun?: boolean;
    cancelable?: boolean;
  }>(),
  { firstRun: false, cancelable: true },
);

const emit = defineEmits<{
  cancel: [];
  created: [book: BookSummary];
}>();

const name = ref("");
const currency = ref<string>("USD");
const creating = ref(false);
const error = ref<string | null>(null);

interface CurrencyOption {
  code: string;
  label: string;
}

const options = computed<CurrencyOption[]>(() =>
  SUPPORTED_CURRENCY_CODES.map((code) => ({
    code,
    label: `${code} — ${localizedCurrencyName(code, locale.value)}`,
  })),
);

function onCancel(): void {
  if (!props.cancelable) return;
  emit("cancel");
}

async function onSubmit(): Promise<void> {
  if (creating.value) return;
  creating.value = true;
  error.value = null;
  try {
    const result = await createBook({ name: name.value.trim(), currency: currency.value });
    if (!result.ok) {
      error.value = result.error;
      return;
    }
    emit("created", result.data.book);
  } finally {
    creating.value = false;
  }
}
</script>
