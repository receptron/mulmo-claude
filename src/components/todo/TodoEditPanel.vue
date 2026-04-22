<template>
  <div class="border-t border-blue-100 bg-blue-50 p-4 space-y-3 rounded-b-lg">
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="block text-xs text-gray-600 sm:col-span-2">
        {{ t("todoDialogs.fieldText") }}
        <input
          v-model="text"
          type="text"
          class="mt-1 w-full px-2 py-1.5 text-sm bg-white border border-blue-300 rounded focus:outline-none focus:border-blue-500"
        />
      </label>
      <label class="block text-xs text-gray-600 sm:col-span-2">
        {{ t("todoDialogs.fieldNote") }}
        <textarea
          v-model="note"
          rows="2"
          class="mt-1 w-full px-2 py-1.5 text-sm bg-white border border-blue-300 rounded resize-y focus:outline-none focus:border-blue-500"
        />
      </label>
      <label class="block text-xs text-gray-600">
        {{ t("todoDialogs.fieldStatus") }}
        <select v-model="status" class="mt-1 w-full px-2 py-1.5 text-sm bg-white border border-blue-300 rounded focus:outline-none focus:border-blue-500">
          <option v-for="col in columns" :key="col.id" :value="col.id">
            {{ col.label }}
          </option>
        </select>
      </label>
      <label class="block text-xs text-gray-600">
        {{ t("todoDialogs.fieldPriority") }}
        <select v-model="priority" class="mt-1 w-full px-2 py-1.5 text-sm bg-white border border-blue-300 rounded focus:outline-none focus:border-blue-500">
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
          class="mt-1 w-full px-2 py-1.5 text-sm bg-white border border-blue-300 rounded focus:outline-none focus:border-blue-500"
        />
      </label>
      <label class="block text-xs text-gray-600">
        {{ t("todoDialogs.fieldLabelsCommaSeparated") }}
        <input
          v-model="labelsText"
          type="text"
          :placeholder="t('todoDialogs.labelsPlaceholder')"
          class="mt-1 w-full px-2 py-1.5 text-sm bg-white border border-blue-300 rounded focus:outline-none focus:border-blue-500"
        />
      </label>
    </div>
    <div class="flex items-center gap-2 pt-1">
      <button class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600" @click="save">{{ t("common.save") }}</button>
      <button class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50" @click="emit('cancel')">
        {{ t("common.cancel") }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import type { StatusColumn, TodoItem, TodoPriority } from "../../plugins/todo/index";
import { PRIORITIES, PRIORITY_LABELS } from "../../plugins/todo/priority";
import type { PatchItemInput } from "../../plugins/todo/composables/useTodos";

const { t } = useI18n();

const props = defineProps<{
  item: TodoItem;
  columns: StatusColumn[];
}>();

const emit = defineEmits<{
  save: [input: PatchItemInput];
  cancel: [];
}>();

const text = ref(props.item.text);
const note = ref(props.item.note ?? "");
const status = ref<string>(props.item.status ?? props.columns[0]?.id ?? "");
const priority = ref<string>(props.item.priority ?? "");
const dueDate = ref(props.item.dueDate ?? "");
const labelsText = ref((props.item.labels ?? []).join(", "));

function parseLabels(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function save(): void {
  const input: PatchItemInput = {
    text: text.value,
    note: note.value === "" ? null : note.value,
    status: status.value,
    labels: parseLabels(labelsText.value),
  };
  // Priority: empty string clears, valid priority sets, anything else
  // is silently ignored (the dropdown ensures we never send garbage).
  if (priority.value === "") {
    input.priority = null;
  } else {
    input.priority = priority.value as TodoPriority;
  }
  if (dueDate.value === "") {
    input.dueDate = null;
  } else {
    input.dueDate = dueDate.value;
  }
  emit("save", input);
}
</script>
