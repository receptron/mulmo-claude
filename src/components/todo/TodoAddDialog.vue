<template>
  <div class="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" @click="emit('cancel')">
    <div
      class="bg-white rounded-lg shadow-xl w-96 max-w-[90vw] p-5 space-y-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="todo-add-dialog-title"
      @click.stop
    >
      <h3 id="todo-add-dialog-title" class="text-base font-semibold text-gray-800">{{ t("todoDialogs.addTitle") }}</h3>
      <label class="block text-xs text-gray-600">
        {{ t("todoDialogs.fieldText") }}
        <input
          ref="textInput"
          v-model="text"
          type="text"
          :placeholder="t('todoDialogs.textPlaceholder')"
          class="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          @keydown.enter="submit"
        />
      </label>
      <label class="block text-xs text-gray-600">
        {{ t("todoDialogs.fieldNote") }}
        <textarea
          v-model="note"
          rows="2"
          class="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 rounded resize-y focus:outline-none focus:border-blue-400"
        />
      </label>
      <div class="grid grid-cols-2 gap-3">
        <label class="block text-xs text-gray-600">
          {{ t("todoDialogs.fieldStatus") }}
          <select v-model="status" class="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400">
            <option v-for="col in columns" :key="col.id" :value="col.id">
              {{ col.label }}
            </option>
          </select>
        </label>
        <label class="block text-xs text-gray-600">
          {{ t("todoDialogs.fieldPriority") }}
          <select v-model="priority" class="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400">
            <option value="">{{ t("todoDialogs.noneOption") }}</option>
            <option v-for="p in PRIORITIES" :key="p" :value="p">
              {{ PRIORITY_LABELS[p] }}
            </option>
          </select>
        </label>
        <label class="block text-xs text-gray-600">
          {{ t("todoDialogs.fieldDueDate") }}
          <input
            v-model="dueDate"
            type="date"
            class="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          />
        </label>
        <label class="block text-xs text-gray-600">
          {{ t("todoDialogs.fieldLabels") }}
          <input
            v-model="labelsText"
            type="text"
            :placeholder="t('todoDialogs.labelsPlaceholder')"
            class="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          />
        </label>
      </div>
      <div class="flex justify-end gap-2 pt-1">
        <button class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50" @click="emit('cancel')">
          {{ t("common.cancel") }}
        </button>
        <button class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600" @click="submit">{{ t("common.add") }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { StatusColumn } from "../../plugins/todo/index";
import { PRIORITIES, PRIORITY_LABELS } from "../../plugins/todo/priority";
import type { CreateItemInput } from "../../plugins/todo/composables/useTodos";

const { t } = useI18n();

const props = defineProps<{
  columns: StatusColumn[];
  defaultStatus?: string;
}>();

const emit = defineEmits<{
  cancel: [];
  create: [input: CreateItemInput];
}>();

const text = ref("");
const note = ref("");
const status = ref<string>(props.defaultStatus ?? props.columns[0]?.id ?? "");
const priority = ref<string>("");
const dueDate = ref("");
const labelsText = ref("");

const textInput = ref<HTMLInputElement | null>(null);

// Escape closes the dialog. Bound at the document level rather than
// on the modal div so it works no matter where focus is — Vue's
// `@keydown.esc` only fires when the modal owns focus, which it
// loses as soon as the user tabs into one of the form inputs.
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("cancel");
}

onMounted(() => {
  textInput.value?.focus();
  document.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  document.removeEventListener("keydown", onKeydown);
});

function submit(): void {
  const trimmed = text.value.trim();
  if (trimmed.length === 0) return;
  const input: CreateItemInput = { text: trimmed };
  if (note.value !== "") input.note = note.value;
  if (status.value !== "") input.status = status.value;
  if (priority.value !== "") input.priority = priority.value;
  if (dueDate.value !== "") input.dueDate = dueDate.value;
  const labels = labelsText.value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (labels.length > 0) input.labels = labels;
  emit("create", input);
}
</script>
