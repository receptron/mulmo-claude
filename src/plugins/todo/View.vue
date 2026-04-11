<template>
  <div class="h-full bg-white flex flex-col">
    <div
      class="flex items-center justify-between px-6 py-4 border-b border-gray-100"
    >
      <h2 class="text-lg font-semibold text-gray-800">Todo List</h2>
      <span class="text-sm text-gray-500"
        >{{ completedCount }}/{{ items.length }} completed</span
      >
    </div>

    <div
      v-if="items.length === 0"
      class="flex-1 flex items-center justify-center text-gray-400"
    >
      No todo items yet
    </div>

    <ul v-else class="flex-1 overflow-y-auto p-4 space-y-2">
      <li
        v-for="item in items"
        :key="item.id"
        class="rounded-lg border"
        :class="selectedId === item.id ? 'border-blue-400' : 'border-gray-200'"
      >
        <!-- Item row -->
        <div
          class="flex items-center gap-3 p-3 cursor-pointer group hover:bg-gray-50 rounded-lg"
          :class="selectedId === item.id ? 'rounded-b-none' : ''"
          @click="selectItem(item)"
        >
          <input
            type="checkbox"
            :checked="item.completed"
            class="cursor-pointer shrink-0"
            @click.stop
            @change="toggle(item)"
          />
          <div class="flex-1 min-w-0">
            <span
              class="text-sm"
              :class="
                item.completed ? 'line-through text-gray-400' : 'text-gray-800'
              "
              >{{ item.text }}</span
            >
            <div v-if="item.note" class="text-xs text-gray-400 mt-0.5">
              {{ item.note }}
            </div>
          </div>
          <button
            class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs px-1 shrink-0"
            title="Delete item"
            @click.stop="remove(item)"
          >
            ✕
          </button>
          <span
            class="material-icons text-gray-400 text-sm"
            :title="selectedId === item.id ? 'Collapse' : 'Expand'"
          >
            {{ selectedId === item.id ? "expand_less" : "expand_more" }}
          </span>
        </div>

        <!-- Inline editor -->
        <div
          v-if="selectedId === item.id"
          class="border-t border-blue-100 bg-blue-50 p-4 space-y-3 rounded-b-lg"
        >
          <textarea
            v-model="yamlText"
            class="w-full h-24 p-3 font-mono text-xs bg-white border border-blue-300 rounded resize-y focus:outline-none focus:border-blue-500"
            spellcheck="false"
          />
          <div class="flex items-center gap-2">
            <button
              class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600"
              @click="applyItemEdit"
            >
              Update
            </button>
            <button
              class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
              @click="selectedId = null"
            >
              Cancel
            </button>
            <span v-if="yamlError" class="text-xs text-red-500">{{
              yamlError
            }}</span>
          </div>
        </div>
      </li>
    </ul>

    <button
      v-if="hasCompleted"
      class="mx-6 mb-2 text-sm text-gray-500 hover:text-gray-700 self-start"
      @click="clearCompleted"
    >
      Clear completed
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { TodoData, TodoItem } from "./index";

const props = defineProps<{
  selectedResult: ToolResultComplete<TodoData>;
}>();
const emit = defineEmits<{ updateResult: [result: ToolResultComplete] }>();

const items = computed(() => props.selectedResult.data?.items ?? []);
const completedCount = computed(
  () => items.value.filter((i) => i.completed).length,
);
const hasCompleted = computed(() => items.value.some((i) => i.completed));

// ── YAML helpers ─────────────────────────────────────────────────────────────

function yamlStringValue(v: string): string {
  const needsQuotes =
    v === "" ||
    /[:#\[\]{},&*?|<>=!%@`]/.test(v) ||
    /^\s|\s$/.test(v) ||
    /^(true|false|null|~)$/i.test(v) ||
    /^\d/.test(v);
  if (needsQuotes) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return v;
}

function serializeYaml(item: TodoItem): string {
  return [
    `text: ${yamlStringValue(item.text)}`,
    `note: ${item.note ? yamlStringValue(item.note) : ""}`,
  ].join("\n");
}

function parseYamlValue(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parseYaml(text: string): { text: string; note: string } | null {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = line.indexOf(": ");
    if (colonIdx === -1) {
      // "key:" with empty value
      const colonEnd = line.indexOf(":");
      if (colonEnd !== -1) result[line.slice(0, colonEnd).trim()] = "";
      continue;
    }
    result[line.slice(0, colonIdx).trim()] = parseYamlValue(
      line.slice(colonIdx + 2).trim(),
    );
  }
  if (typeof result["text"] !== "string" || !result["text"]) return null;
  return { text: result["text"], note: result["note"] ?? "" };
}

// ── Item selection & YAML edit ────────────────────────────────────────────────

const selectedId = ref<string | null>(null);
const selectedOriginalText = ref<string>("");
const yamlText = ref("");
const yamlError = ref("");

function selectItem(item: TodoItem) {
  if (selectedId.value === item.id) {
    selectedId.value = null;
    return;
  }
  selectedId.value = item.id;
  selectedOriginalText.value = item.text;
  yamlText.value = serializeYaml(item);
  yamlError.value = "";
}

watch(
  () => props.selectedResult.data,
  () => {
    if (selectedId.value) {
      const item = items.value.find((i) => i.id === selectedId.value);
      if (item) {
        yamlText.value = serializeYaml(item);
        selectedOriginalText.value = item.text;
      } else {
        selectedId.value = null;
      }
    }
  },
);

async function applyItemEdit() {
  yamlError.value = "";
  const parsed = parseYaml(yamlText.value);
  if (!parsed) {
    yamlError.value = "Could not parse YAML — 'text' field is required";
    return;
  }
  await callApi({
    action: "update",
    text: selectedOriginalText.value,
    newText: parsed.text,
    note: parsed.note,
  });
  selectedId.value = null;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function callApi(body: Record<string, unknown>) {
  const response = await fetch("/api/todos", {
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

function toggle(item: TodoItem) {
  callApi({ action: item.completed ? "uncheck" : "check", text: item.text });
}

function remove(item: TodoItem) {
  if (selectedId.value === item.id) selectedId.value = null;
  callApi({ action: "delete", text: item.text });
}

function clearCompleted() {
  callApi({ action: "clear_completed" });
}
</script>
