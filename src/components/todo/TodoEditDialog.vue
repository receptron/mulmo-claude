<template>
  <div class="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" @click="emit('cancel')">
    <div
      class="bg-white rounded-lg shadow-xl w-[28rem] max-w-[92vw] overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="todo-edit-dialog-title"
      @click.stop
    >
      <div class="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <h3 id="todo-edit-dialog-title" class="text-base font-semibold text-gray-800">Edit Todo</h3>
        <button class="text-gray-400 hover:text-red-500 text-xs px-2 py-0.5" title="Delete this item" @click="emit('delete', item.id)">Delete</button>
      </div>
      <TodoEditPanel :item="item" :columns="columns" @save="(input) => emit('save', input)" @cancel="emit('cancel')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import type { StatusColumn, TodoItem } from "../../plugins/todo/index";
import type { PatchItemInput } from "../../plugins/todo/composables/useTodos";
import TodoEditPanel from "./TodoEditPanel.vue";

defineProps<{
  item: TodoItem;
  columns: StatusColumn[];
}>();

const emit = defineEmits<{
  save: [input: PatchItemInput];
  cancel: [];
  delete: [id: string];
}>();
// The parent (TodoExplorer) gates deletion behind a single confirm
// helper, so this dialog just emits the delete intent and lets the
// caller decide whether to actually remove the item.

// Escape closes the dialog. Document-level listener so it works even
// when focus is inside the form (Vue's @keydown.esc only fires on
// the element that owns focus).
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("cancel");
}
onMounted(() => document.addEventListener("keydown", onKeydown));
onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>
