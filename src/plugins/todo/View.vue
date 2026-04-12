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

    <!-- Filter bar: only shown when at least one label is in use. -->
    <div
      v-if="labelInventory.length > 0"
      class="flex flex-wrap items-center gap-1.5 px-6 py-2 border-b border-gray-100 bg-gray-50"
    >
      <span class="text-xs text-gray-500 mr-1">Filter:</span>
      <button
        v-for="entry in labelInventory"
        :key="entry.label"
        class="px-2 py-0.5 rounded-full text-xs font-medium transition-all"
        :class="
          activeFilters.has(entry.label.toLowerCase())
            ? 'ring-2 ring-blue-400 ' + colorForLabel(entry.label)
            : colorForLabel(entry.label) + ' opacity-70 hover:opacity-100'
        "
        @click="toggleFilter(entry.label)"
      >
        {{ entry.label }}
        <span class="opacity-60">{{ entry.count }}</span>
      </button>
      <button
        v-if="activeFilters.size > 0"
        class="ml-auto text-xs text-gray-500 hover:text-gray-700"
        title="Clear all filters"
        @click="clearFilters"
      >
        Clear ✕
      </button>
    </div>

    <div
      v-if="items.length === 0"
      class="flex-1 flex items-center justify-center text-gray-400"
    >
      No todo items yet
    </div>

    <div
      v-else-if="filteredItems.length === 0"
      class="flex-1 flex items-center justify-center text-gray-400 text-sm"
    >
      No items match the active filter
    </div>

    <ul v-else class="flex-1 overflow-y-auto p-4 space-y-2">
      <li
        v-for="item in filteredItems"
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
            <div class="flex items-center gap-2 flex-wrap">
              <span
                class="text-sm"
                :class="
                  item.completed
                    ? 'line-through text-gray-400'
                    : 'text-gray-800'
                "
                >{{ item.text }}</span
              >
              <span
                v-for="label in item.labels ?? []"
                :key="label"
                class="px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0"
                :class="colorForLabel(label)"
                >{{ label }}</span
              >
            </div>
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
import { useFreshPluginData } from "../../composables/useFreshPluginData";
import {
  colorForLabel,
  filterByLabels,
  listLabelsWithCount,
  subtractLabels,
} from "./labels";

const props = defineProps<{
  selectedResult: ToolResultComplete<TodoData>;
}>();
const emit = defineEmits<{ updateResult: [result: ToolResultComplete] }>();

const items = ref<TodoItem[]>(props.selectedResult.data?.items ?? []);

const { refresh } = useFreshPluginData<TodoItem[]>({
  endpoint: () => "/api/todos",
  extract: (json) => {
    const v = (json as { data?: { items?: TodoItem[] } }).data?.items;
    return Array.isArray(v) ? v : null;
  },
  apply: (data) => {
    items.value = data;
  },
});

// Re-fetch when the caller swaps in a different tool result.
// Watch the uuid (not data?.items) so the trigger fires even when
// the old and new results both have `undefined` items — e.g.
// toggling between two empty results — per CodeRabbit V2's
// "watch key miss" finding.
watch(
  () => props.selectedResult.uuid,
  () => {
    items.value = props.selectedResult.data?.items ?? [];
    void refresh();
  },
);
const completedCount = computed(
  () => items.value.filter((i) => i.completed).length,
);
const hasCompleted = computed(() => items.value.some((i) => i.completed));

// ── Label filter state ──────────────────────────────────────────────────────
// Filters are local to this View instance — intentional, so that
// switching sessions or reopening a tool result doesn't drag state
// across contexts. Active filters are stored lowercased to match
// `filterByLabels`' case-insensitive semantics.

const activeFilters = ref<Set<string>>(new Set());

const labelInventory = computed(() => listLabelsWithCount(items.value));

const filteredItems = computed(() =>
  filterByLabels(items.value, [...activeFilters.value]),
);

function toggleFilter(label: string): void {
  const key = label.toLowerCase();
  const next = new Set(activeFilters.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  activeFilters.value = next;
}

function clearFilters(): void {
  activeFilters.value = new Set();
}

// ── YAML helpers ─────────────────────────────────────────────────────────────

function yamlStringValue(v: string): string {
  const needsQuotes =
    v === "" ||
    /[:#[\]{},&*?|<>=!%@`]/.test(v) ||
    /^\s|\s$/.test(v) ||
    /^(true|false|null|~)$/i.test(v) ||
    /^\d/.test(v);
  if (needsQuotes) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return v;
}

function serializeYaml(item: TodoItem): string {
  const labels = item.labels ?? [];
  const labelsLine =
    labels.length > 0
      ? `labels: [${labels.map(yamlStringValue).join(", ")}]`
      : "labels: []";
  return [
    `text: ${yamlStringValue(item.text)}`,
    `note: ${item.note ? yamlStringValue(item.note) : ""}`,
    labelsLine,
  ].join("\n");
}

// Parse a YAML flow sequence `[a, "b", c]` into an array of strings.
// Handles quoted and unquoted entries. Whitespace-only input → empty.
function parseFlowSequence(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[]") return [];
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  const inner = trimmed.slice(1, -1);
  // Split on commas that are NOT inside double quotes. Cheap scan;
  // fine for our label use case where items don't contain commas
  // (stored labels are normalised strings without commas).
  const result: string[] = [];
  let buffer = "";
  let inQuotes = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"' && inner[i - 1] !== "\\") {
      inQuotes = !inQuotes;
      buffer += ch;
      continue;
    }
    if (ch === "," && !inQuotes) {
      const piece = parseYamlValue(buffer.trim());
      if (piece) result.push(piece);
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  const last = parseYamlValue(buffer.trim());
  if (last) result.push(last);
  return result;
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

function parseYaml(
  text: string,
): { text: string; note: string; labels: string[] } | null {
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
    // `labels:` is a flow sequence (`[a, b]`) — parse it as a list
    // instead of running it through `parseYamlValue` which strips
    // brackets as if they were quotes.
    const key = line.slice(0, colonIdx).trim();
    const raw = line.slice(colonIdx + 2).trim();
    if (key === "labels") {
      result[key] = raw;
      continue;
    }
    result[key] = parseYamlValue(raw);
  }
  if (typeof result["text"] !== "string" || !result["text"]) return null;
  const labels = parseFlowSequence(result["labels"] ?? "[]");
  return {
    text: result["text"],
    note: result["note"] ?? "",
    labels,
  };
}

// ── Item selection & YAML edit ────────────────────────────────────────────────

const selectedId = ref<string | null>(null);
const selectedOriginalText = ref<string>("");
const selectedOriginalLabels = ref<string[]>([]);
const yamlText = ref("");
const yamlError = ref("");

function selectItem(item: TodoItem) {
  if (selectedId.value === item.id) {
    selectedId.value = null;
    return;
  }
  selectedId.value = item.id;
  selectedOriginalText.value = item.text;
  selectedOriginalLabels.value = [...(item.labels ?? [])];
  yamlText.value = serializeYaml(item);
  yamlError.value = "";
}

watch(items, () => {
  if (selectedId.value) {
    const item = items.value.find((i) => i.id === selectedId.value);
    if (item) {
      yamlText.value = serializeYaml(item);
      selectedOriginalText.value = item.text;
      selectedOriginalLabels.value = [...(item.labels ?? [])];
    } else {
      selectedId.value = null;
    }
  }
});

async function applyItemEdit() {
  yamlError.value = "";
  const parsed = parseYaml(yamlText.value);
  if (!parsed) {
    yamlError.value = "Could not parse YAML — 'text' field is required";
    return;
  }
  // 1. text / note go through `update` (label-agnostic on the server).
  const ok = await callApi({
    action: "update",
    text: selectedOriginalText.value,
    newText: parsed.text,
    note: parsed.note,
  });
  if (!ok) return;
  // 2. labels are diffed against the prior state and applied as
  //    `add_label` / `remove_label` calls. `update` deliberately
  //    does not touch labels — this keeps each LLM action
  //    single-purpose and matches the add_label/remove_label
  //    semantics the LLM uses.
  const originalLabels = selectedOriginalLabels.value;
  const removed = subtractLabels(originalLabels, parsed.labels);
  const added = subtractLabels(parsed.labels, originalLabels);
  // Use the already-renamed `parsed.text` to match the updated item.
  if (removed.length > 0) {
    await callApi({
      action: "remove_label",
      text: parsed.text,
      labels: removed,
    });
  }
  if (added.length > 0) {
    await callApi({
      action: "add_label",
      text: parsed.text,
      labels: added,
    });
  }
  selectedId.value = null;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function callApi(body: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return false;
    const result = await response.json();
    items.value = result.data?.items ?? [];
    emit("updateResult", {
      ...props.selectedResult,
      ...result,
      uuid: props.selectedResult.uuid,
    });
    return true;
  } catch {
    return false;
  }
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
