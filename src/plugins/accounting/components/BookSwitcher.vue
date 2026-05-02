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
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import NewBookForm from "./NewBookForm.vue";
import type { BookSummary } from "../api";

const { t } = useI18n();

const props = defineProps<{ modelValue: string; books: BookSummary[] }>();
const emit = defineEmits<{
  "update:modelValue": [bookId: string];
  "books-changed": [];
  "book-created": [book: BookSummary];
}>();

// Sentinel value for the "+ New book" option living inside the
// books <select>. Picking it opens the modal and reverts the
// select's displayed value to the current selection — the option
// must not collide with any real book id, which are nanoid-shaped.
const NEW_BOOK_SENTINEL = "__new__";

const showNewBook = ref(false);

function formatBookOption(book: BookSummary): string {
  return `${book.name} (${book.currency})`;
}

function onSelect(event: Event): void {
  const target = event.target as HTMLSelectElement;
  const bookId = target.value;
  if (bookId === NEW_BOOK_SENTINEL) {
    target.value = props.modelValue;
    showNewBook.value = true;
    return;
  }
  if (bookId === props.modelValue) return;
  // The View persists the new selection to localStorage; no server
  // round-trip needed since there's no shared "active book" state.
  emit("update:modelValue", bookId);
}

function onCreated(book: BookSummary): void {
  // Hand the new book to the parent in one event so it can await
  // its own refetch before setting the active selection. Splitting
  // this into separate `books-changed` + `update:modelValue` emits
  // races: the parent's async refetch runs concurrently with the
  // selection update, and the stillExists guard inside refetch can
  // snap the selection back to books[0] if the fetch happens to
  // resolve before the new book is in the list.
  showNewBook.value = false;
  emit("book-created", book);
}
</script>
