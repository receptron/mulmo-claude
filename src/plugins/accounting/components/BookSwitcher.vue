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
      <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- decorative separator inside the books <select>, not user copy -->
      <option disabled>──────────</option>
      <option :value="NEW_BOOK_SENTINEL" data-testid="accounting-new-book-option">+ {{ t("pluginAccounting.bookSwitcher.newBook") }}</option>
    </select>
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

// Sentinel value for the "+ New book" option living inside the
// books <select>. Picking it opens the modal and reverts the
// select's displayed value to the active book — the option must
// not collide with any real book id, which are nanoid-shaped.
const NEW_BOOK_SENTINEL = "__new__";

const showNewBook = ref(false);
const switchError = ref<string | null>(null);

function formatBookOption(book: BookSummary): string {
  return `${book.name} (${book.currency})`;
}

async function onSelect(event: Event): Promise<void> {
  const target = event.target as HTMLSelectElement;
  const bookId = target.value;
  if (bookId === NEW_BOOK_SENTINEL) {
    target.value = props.modelValue;
    showNewBook.value = true;
    return;
  }
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
