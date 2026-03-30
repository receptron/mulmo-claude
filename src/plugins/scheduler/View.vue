<template>
  <div class="h-full bg-white flex flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
      <h2 class="text-lg font-semibold text-gray-800">Scheduler</h2>
      <span class="text-sm text-gray-500">{{ items.length }} item{{ items.length !== 1 ? 's' : '' }}</span>
    </div>

    <!-- Item list -->
    <div class="flex-1 overflow-y-auto min-h-0">
      <div
        v-if="items.length === 0"
        class="flex items-center justify-center h-full text-gray-400"
      >
        No scheduled items
      </div>

      <ul v-else class="p-4 space-y-2">
        <li
          v-for="item in items"
          :key="item.id"
          class="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 group"
        >
          <div class="flex-1 min-w-0">
            <div class="font-medium text-gray-800 text-sm">{{ item.title }}</div>
            <div v-if="Object.keys(item.props).length > 0" class="flex flex-wrap gap-1 mt-1">
              <span
                v-for="(val, key) in item.props"
                :key="key"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-xs text-gray-600"
              >
                <span class="text-gray-400">{{ key }}:</span>
                <span>{{ val }}</span>
              </span>
            </div>
          </div>
          <button
            class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs px-1 mt-0.5 shrink-0"
            @click="remove(item)"
          >
            ✕
          </button>
        </li>
      </ul>
    </div>

    <!-- JSON source editor -->
    <details class="border-t border-gray-200 bg-gray-50 shrink-0">
      <summary class="cursor-pointer select-none px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
        Edit Source
      </summary>
      <div class="p-3">
        <textarea
          v-model="editorText"
          class="w-full h-[40vh] p-3 font-mono text-xs bg-white border border-gray-300 rounded resize-y focus:outline-none focus:border-blue-400"
          spellcheck="false"
        />
        <div class="flex items-center gap-2 mt-2">
          <button
            :disabled="!isModified"
            class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
            @click="applyChanges"
          >
            Apply Changes
          </button>
          <span v-if="parseError" class="text-xs text-red-500">{{ parseError }}</span>
        </div>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { SchedulerData, ScheduledItem } from "./index";

const props = defineProps<{ selectedResult: ToolResultComplete }>();
const emit = defineEmits<{ updateResult: [result: ToolResultComplete] }>();

const items = computed(
  () => (props.selectedResult.data as SchedulerData)?.items ?? [],
);

function toJson(its: ScheduledItem[]) {
  return JSON.stringify(its, null, 2);
}

const editorText = ref(toJson(items.value));
const parseError = ref("");

watch(
  () => props.selectedResult.data,
  () => {
    editorText.value = toJson(items.value);
    parseError.value = "";
  },
);

const isModified = computed(() => editorText.value !== toJson(items.value));

async function callApi(body: Record<string, unknown>) {
  const response = await fetch("/api/scheduler", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  emit("updateResult", {
    ...props.selectedResult,
    ...result,
    uuid: props.selectedResult.uuid,
  });
}

function remove(item: ScheduledItem) {
  callApi({ action: "delete", id: item.id });
}

async function applyChanges() {
  parseError.value = "";
  let parsed: ScheduledItem[];
  try {
    parsed = JSON.parse(editorText.value);
    if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
  } catch (e) {
    parseError.value = e instanceof Error ? e.message : "Invalid JSON";
    return;
  }
  callApi({ action: "replace", items: parsed });
}
</script>
