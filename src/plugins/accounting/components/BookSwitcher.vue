<template>
  <div class="flex items-center gap-2">
    <label class="text-xs text-gray-500" for="accounting-book-select">{{ t("pluginAccounting.bookSwitcher.label") }}</label>
    <select
      id="accounting-book-select"
      :value="modelValue"
      class="h-8 px-2 rounded border border-gray-300 text-sm bg-white"
      data-testid="accounting-book-select"
      @change="onSelect"
    >
      <option v-for="book in books" :key="book.id" :value="book.id">{{ formatBookOption(book) }}</option>
    </select>
    <button
      class="h-8 px-2.5 flex items-center gap-1 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
      data-testid="accounting-new-book"
      @click="showNewBook = true"
    >
      <span class="material-icons text-base">add</span>{{ t("pluginAccounting.bookSwitcher.newBook") }}
    </button>
    <NewBookForm v-if="showNewBook" @cancel="showNewBook = false" @created="onCreated" />
    <p v-if="switchError" class="text-xs text-red-500">{{ switchError }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import NewBookForm from "./NewBookForm.vue";
import { setActiveBook, type BookSummary } from "../api";

const { t } = useI18n();

const props = defineProps<{ modelValue: string; books: BookSummary[] }>();
const emit = defineEmits<{
  "update:modelValue": [bookId: string];
  "books-changed": [];
}>();

const showNewBook = ref(false);
const switchError = ref<string | null>(null);

function formatBookOption(book: BookSummary): string {
  return `${book.name} (${book.currency})`;
}

async function onSelect(event: Event): Promise<void> {
  const target = event.target as HTMLSelectElement;
  const bookId = target.value;
  if (bookId === props.modelValue) return;
  const result = await setActiveBook(bookId);
  if (!result.ok) {
    target.value = props.modelValue;
    switchError.value = result.error;
    return;
  }
  switchError.value = null;
  emit("update:modelValue", bookId);
  emit("books-changed");
}

function onCreated(book: BookSummary): void {
  showNewBook.value = false;
  emit("books-changed");
  emit("update:modelValue", book.id);
}
</script>
