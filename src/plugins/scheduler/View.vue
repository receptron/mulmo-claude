<template>
  <div class="h-full bg-white flex flex-col">
    <!-- Header -->
    <div
      class="flex items-center justify-between px-6 py-4 border-b border-gray-100"
    >
      <h2 class="text-lg font-semibold text-gray-800">Scheduler</h2>
      <span class="text-sm text-gray-500"
        >{{ items.length }} item{{ items.length !== 1 ? "s" : "" }}</span
      >
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
          class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer group"
          :class="
            selectedId === item.id
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-200 hover:bg-gray-50'
          "
          @click="selectItem(item)"
        >
          <div class="flex-1 min-w-0">
            <div class="font-medium text-gray-800 text-sm">
              {{ item.title }}
            </div>
            <div
              v-if="Object.keys(item.props).length > 0"
              class="flex flex-wrap gap-1 mt-1"
            >
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
            @click.stop="remove(item)"
          >
            ✕
          </button>
        </li>
      </ul>
    </div>

    <!-- Item YAML editor -->
    <div v-if="selectedId" class="border-t border-blue-200 bg-blue-50 shrink-0">
      <div
        class="flex items-center justify-between px-4 py-2 text-sm font-medium text-blue-700"
      >
        <span>Edit item</span>
        <button
          class="text-blue-400 hover:text-blue-600 text-xs"
          @click="selectedId = null"
        >
          ✕
        </button>
      </div>
      <div class="px-3 pb-3">
        <textarea
          v-model="yamlText"
          class="w-full h-32 p-3 font-mono text-xs bg-white border border-blue-300 rounded resize-y focus:outline-none focus:border-blue-500"
          spellcheck="false"
        />
        <div class="flex items-center gap-2 mt-2">
          <button
            class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600"
            @click="applyItemEdit"
          >
            Update
          </button>
          <span v-if="yamlError" class="text-xs text-red-500">{{
            yamlError
          }}</span>
        </div>
      </div>
    </div>

    <!-- iCal sources -->
    <details class="border-t border-gray-200 bg-gray-50 shrink-0">
      <summary
        class="cursor-pointer select-none px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
        @click="onIcalToggle"
      >
        iCal Sources
        <span v-if="icalSources.length > 0" class="text-xs text-gray-400"
          >({{ icalSources.length }})</span
        >
      </summary>
      <div class="p-3 space-y-3">
        <!-- Source list -->
        <div
          v-for="source in icalSources"
          :key="source.id"
          class="flex items-center gap-2 text-sm"
        >
          <span class="flex-1 min-w-0 truncate text-gray-700">{{
            source.name
          }}</span>
          <button
            class="text-gray-400 hover:text-red-500 text-xs shrink-0"
            :disabled="icalLoading"
            @click="removeIcalSource(source.id)"
          >
            ✕
          </button>
        </div>
        <p v-if="icalSources.length === 0" class="text-xs text-gray-400">
          No iCal sources configured.
        </p>

        <!-- Add source form -->
        <div class="flex flex-col gap-2">
          <input
            v-model="newIcalName"
            type="text"
            placeholder="Calendar name"
            class="w-full px-2 py-1.5 text-xs bg-white border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          />
          <input
            v-model="newIcalUrl"
            type="url"
            placeholder="iCal URL (https://...)"
            class="w-full px-2 py-1.5 text-xs bg-white border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          />
          <div class="flex gap-2">
            <button
              :disabled="
                !newIcalName.trim() || !newIcalUrl.trim() || icalLoading
              "
              class="px-3 py-1.5 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
              @click="addIcalSource"
            >
              Add
            </button>
            <button
              :disabled="icalSources.length === 0 || icalLoading"
              class="px-3 py-1.5 text-xs rounded bg-green-500 text-white hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
              @click="syncIcal"
            >
              {{ icalLoading ? "Syncing..." : "Sync All" }}
            </button>
          </div>
        </div>
        <p
          v-if="icalMessage"
          class="text-xs"
          :class="icalError ? 'text-red-500' : 'text-green-600'"
        >
          {{ icalMessage }}
        </p>
      </div>
    </details>

    <!-- JSON source editor -->
    <details class="border-t border-gray-200 bg-gray-50 shrink-0">
      <summary
        class="cursor-pointer select-none px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
      >
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
          <span v-if="parseError" class="text-xs text-red-500">{{
            parseError
          }}</span>
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

// ── YAML helpers ────────────────────────────────────────────────────────────

function yamlStringValue(v: string): string {
  // Quote if the value contains special characters or could be misread
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

function serializeYaml(item: ScheduledItem): string {
  const lines: string[] = [`title: ${yamlStringValue(item.title)}`];
  for (const [k, v] of Object.entries(item.props)) {
    if (v === null) continue;
    if (typeof v === "string") {
      lines.push(`${k}: ${yamlStringValue(v)}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  return lines.join("\n");
}

function parseYamlValue(raw: string): string | number | boolean | null {
  if (raw === "null" || raw === "~") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1);
  }
  const num = Number(raw);
  if (raw !== "" && !isNaN(num)) return num;
  return raw;
}

function parseYaml(text: string): {
  title: string;
  props: Record<string, string | number | boolean | null>;
} | null {
  const result: Record<string, string | number | boolean | null> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = line.indexOf(": ");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 2).trim();
    result[key] = parseYamlValue(rawVal);
  }
  const title = result["title"];
  if (typeof title !== "string" || !title) return null;
  const itemProps = { ...result };
  delete itemProps["title"];
  return { title, props: itemProps };
}

// ── Item selection & YAML edit ───────────────────────────────────────────────

const selectedId = ref<string | null>(null);
const yamlText = ref("");
const yamlError = ref("");

function selectItem(item: ScheduledItem) {
  if (selectedId.value === item.id) {
    selectedId.value = null;
    return;
  }
  selectedId.value = item.id;
  yamlText.value = serializeYaml(item);
  yamlError.value = "";
}

// Re-serialize if the underlying data changes while the editor is open
watch(
  () => props.selectedResult.data,
  () => {
    if (selectedId.value) {
      const item = items.value.find((i) => i.id === selectedId.value);
      if (item) {
        yamlText.value = serializeYaml(item);
      } else {
        selectedId.value = null;
      }
    }
    editorText.value = toJson(items.value);
    parseError.value = "";
  },
);

async function applyItemEdit() {
  yamlError.value = "";
  const parsed = parseYaml(yamlText.value);
  if (!parsed) {
    yamlError.value = "Could not parse YAML — ensure 'title' is present";
    return;
  }
  await callApi({
    action: "update",
    id: selectedId.value,
    title: parsed.title,
    props: parsed.props,
  });
}

// ── iCal source management ──────────────────────────────────────────────────

interface IcalSource {
  id: string;
  name: string;
  url: string;
}

const icalSources = ref<IcalSource[]>([]);
const newIcalName = ref("");
const newIcalUrl = ref("");
const icalLoading = ref(false);
const icalMessage = ref("");
const icalError = ref(false);

async function callIcalApi(body: Record<string, unknown>) {
  const response = await fetch("/api/ical", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await response.json();
}

async function fetchIcalSources() {
  const result = await callIcalApi({ action: "list_sources" });
  icalSources.value = result.data?.sources ?? [];
}

function onIcalToggle() {
  // Fetch sources when opening the panel (click fires before <details> toggles)
  fetchIcalSources();
}

async function addIcalSource() {
  icalMessage.value = "";
  icalError.value = false;
  icalLoading.value = true;
  try {
    const result = await callIcalApi({
      action: "add_source",
      name: newIcalName.value.trim(),
      url: newIcalUrl.value.trim(),
    });
    icalSources.value = result.data?.sources ?? icalSources.value;
    icalMessage.value = result.message ?? "Source added";
    newIcalName.value = "";
    newIcalUrl.value = "";
  } catch (e) {
    icalError.value = true;
    icalMessage.value = e instanceof Error ? e.message : "Failed to add source";
  } finally {
    icalLoading.value = false;
  }
}

async function removeIcalSource(sourceId: string) {
  icalMessage.value = "";
  icalError.value = false;
  icalLoading.value = true;
  try {
    const result = await callIcalApi({ action: "remove_source", sourceId });
    icalSources.value = result.data?.sources ?? [];
    icalMessage.value = result.message ?? "Source removed";
    // Refresh scheduler items since imported events were removed
    await callApi({ action: "show" });
  } catch (e) {
    icalError.value = true;
    icalMessage.value =
      e instanceof Error ? e.message : "Failed to remove source";
  } finally {
    icalLoading.value = false;
  }
}

async function syncIcal() {
  icalMessage.value = "";
  icalError.value = false;
  icalLoading.value = true;
  try {
    const result = await callIcalApi({ action: "sync" });
    icalMessage.value = result.message ?? "Sync complete";
    icalError.value = (result.jsonData?.errors ?? 0) > 0;
    // Update the scheduler view with merged items
    if (result.data?.items) {
      emit("updateResult", {
        ...props.selectedResult,
        data: { items: result.data.items },
        uuid: props.selectedResult.uuid,
      });
    }
  } catch (e) {
    icalError.value = true;
    icalMessage.value = e instanceof Error ? e.message : "Sync failed";
  } finally {
    icalLoading.value = false;
  }
}

// ── JSON source editor ───────────────────────────────────────────────────────

function toJson(its: ScheduledItem[]) {
  return JSON.stringify(its, null, 2);
}

const editorText = ref(toJson(items.value));
const parseError = ref("");
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
  if (selectedId.value === item.id) selectedId.value = null;
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
