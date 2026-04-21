<template>
  <div class="h-full bg-white flex flex-col">
    <!-- API error banner — surfaces POST /api/scheduler failures so a
         delete/add/replace that silently no-ops becomes diagnosable. -->
    <div v-if="apiError" class="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700" role="alert" data-testid="scheduler-api-error">
      ⚠ Failed to update scheduler: {{ apiError }}
    </div>
    <!-- Top-level tab bar: Calendar / Tasks -->
    <div class="flex border-b border-gray-200 px-6">
      <button
        class="px-4 py-2 text-sm font-medium border-b-2 -mb-px"
        :class="activeTab === SCHEDULER_TAB.calendar ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'"
        data-testid="scheduler-tab-calendar"
        @click="activeTab = SCHEDULER_TAB.calendar"
      >
        Calendar
      </button>
      <button
        class="px-4 py-2 text-sm font-medium border-b-2 -mb-px"
        :class="activeTab === SCHEDULER_TAB.tasks ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'"
        data-testid="scheduler-tab-tasks"
        @click="activeTab = SCHEDULER_TAB.tasks"
      >
        Tasks
      </button>
    </div>

    <!-- Tasks tab -->
    <TasksTab v-if="activeTab === SCHEDULER_TAB.tasks" />

    <!-- Calendar tab (existing content) -->
    <template v-if="activeTab === SCHEDULER_TAB.calendar">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-3 border-b border-gray-100">
        <div class="flex items-center gap-3">
          <h2 class="text-lg font-semibold text-gray-800">Scheduler</h2>
          <span class="text-sm text-gray-500">{{ items.length }} item{{ items.length !== 1 ? "s" : "" }}</span>
        </div>
        <div class="flex items-center gap-2">
          <!-- Navigation (calendar modes only) -->
          <template v-if="viewMode !== SCHEDULER_VIEW.list">
            <button class="px-2 py-1 text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded" title="Previous" @click="goPrev">
              <span class="material-icons text-sm">chevron_left</span>
            </button>
            <button class="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded" title="Go to today" @click="goToday">Today</button>
            <button class="px-2 py-1 text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded" title="Next" @click="goNext">
              <span class="material-icons text-sm">chevron_right</span>
            </button>
            <span class="text-sm text-gray-600 min-w-[140px] text-center">{{ headerLabel }}</span>
          </template>
          <!-- View mode toggle -->
          <div class="flex border border-gray-300 rounded overflow-hidden text-xs">
            <button
              v-for="mode in VIEW_MODES"
              :key="mode.key"
              class="px-2.5 py-1"
              :class="viewMode === mode.key ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'"
              :title="mode.label"
              @click="viewMode = mode.key"
            >
              <span class="material-icons text-sm">{{ mode.icon }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- List view -->
      <div v-if="viewMode === SCHEDULER_VIEW.list" class="flex-1 overflow-y-auto min-h-0">
        <div v-if="items.length === 0" class="flex items-center justify-center h-full text-gray-400">No scheduled items</div>

        <ul v-else class="p-4 space-y-2">
          <li
            v-for="item in items"
            :key="item.id"
            class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer group"
            :class="selectedId === item.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'"
            @click="selectItem(item)"
          >
            <div class="flex-1 min-w-0">
              <div class="font-medium text-gray-800 text-sm">
                {{ item.title }}
              </div>
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
              title="Delete item"
              @click.stop="remove(item)"
            >
              ✕
            </button>
          </li>
        </ul>
      </div>

      <!-- Week view -->
      <div v-else-if="viewMode === SCHEDULER_VIEW.week" class="flex-1 overflow-y-auto min-h-0">
        <div class="grid grid-cols-7 border-b border-gray-200">
          <div v-for="day in weekDays" :key="day.toISOString()" class="border-r last:border-r-0 border-gray-200 min-h-[200px] flex flex-col">
            <!-- Day header -->
            <div class="px-2 py-1.5 text-center border-b border-gray-100 sticky top-0 bg-white" :class="isToday(day) ? 'bg-blue-50' : ''">
              <div class="text-xs text-gray-400">{{ dayLabel(day) }}</div>
              <div
                class="text-sm font-medium"
                :class="isToday(day) ? 'text-blue-600 bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center mx-auto' : 'text-gray-700'"
              >
                {{ day.getDate() }}
              </div>
            </div>
            <!-- Day items -->
            <div class="flex-1 p-1 space-y-0.5">
              <div
                v-for="item in itemsForDay(day)"
                :key="item.id"
                class="text-xs px-1.5 py-0.5 rounded cursor-pointer truncate"
                :class="selectedId === item.id ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200'"
                :title="item.title"
                @click="selectItem(item)"
              >
                <span v-if="itemTime(item)" class="font-medium">{{ itemTime(item) }} </span>{{ item.title }}
              </div>
            </div>
          </div>
        </div>
        <!-- Unscheduled -->
        <div v-if="unscheduledItems.length > 0" class="p-3 border-t border-gray-200">
          <div class="text-xs text-gray-400 mb-1.5">Unscheduled</div>
          <div class="flex flex-wrap gap-1">
            <div
              v-for="item in unscheduledItems"
              :key="item.id"
              class="text-xs px-2 py-1 rounded cursor-pointer"
              :class="selectedId === item.id ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
              @click="selectItem(item)"
            >
              {{ item.title }}
            </div>
          </div>
        </div>
      </div>

      <!-- Month view -->
      <div v-else class="flex-1 overflow-y-auto min-h-0">
        <!-- Weekday headers -->
        <div class="grid grid-cols-7 border-b border-gray-200 sticky top-0 bg-white z-10">
          <div v-for="label in WEEKDAY_LABELS" :key="label" class="text-xs text-center text-gray-400 py-1.5 border-r last:border-r-0 border-gray-100">
            {{ label }}
          </div>
        </div>
        <!-- Month grid -->
        <div v-for="(week, wi) in monthGrid" :key="wi" class="grid grid-cols-7 border-b border-gray-100">
          <div
            v-for="day in week"
            :key="day.toISOString()"
            class="border-r last:border-r-0 border-gray-100 min-h-[80px] p-1 flex flex-col"
            :class="isToday(day) ? 'bg-blue-50/50' : ''"
          >
            <div class="text-xs mb-0.5" :class="isCurrentMonth(day) ? (isToday(day) ? 'text-blue-600 font-bold' : 'text-gray-700') : 'text-gray-300'">
              {{ day.getDate() }}
            </div>
            <div class="space-y-0.5 flex-1">
              <div
                v-for="item in itemsForDay(day).slice(0, MAX_MONTH_ITEMS)"
                :key="item.id"
                class="text-[10px] leading-tight px-1 py-0.5 rounded cursor-pointer truncate"
                :class="selectedId === item.id ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200'"
                :title="item.title"
                @click="selectItem(item)"
              >
                {{ item.title }}
              </div>
              <div v-if="itemsForDay(day).length > MAX_MONTH_ITEMS" class="text-[10px] text-gray-400 px-1">
                +{{ itemsForDay(day).length - MAX_MONTH_ITEMS }} more
              </div>
            </div>
          </div>
        </div>
        <!-- Unscheduled -->
        <div v-if="unscheduledItems.length > 0" class="p-3 border-t border-gray-200">
          <div class="text-xs text-gray-400 mb-1.5">Unscheduled</div>
          <div class="flex flex-wrap gap-1">
            <div
              v-for="item in unscheduledItems"
              :key="item.id"
              class="text-xs px-2 py-1 rounded cursor-pointer"
              :class="selectedId === item.id ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
              @click="selectItem(item)"
            >
              {{ item.title }}
            </div>
          </div>
        </div>
      </div>

      <!-- Item YAML editor -->
      <div v-if="selectedId" class="border-t border-blue-200 bg-blue-50 shrink-0">
        <div class="flex items-center justify-between px-4 py-2 text-sm font-medium text-blue-700">
          <span>Edit item</span>
          <button class="text-blue-400 hover:text-blue-600 text-xs" title="Close editor" @click="selectedId = null">✕</button>
        </div>
        <div class="px-3 pb-3">
          <textarea
            v-model="yamlText"
            class="w-full h-32 p-3 font-mono text-xs bg-white border border-blue-300 rounded resize-y focus:outline-none focus:border-blue-500"
            spellcheck="false"
          />
          <div class="flex items-center gap-2 mt-2">
            <button class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600" @click="applyItemEdit">Update</button>
            <span v-if="yamlError" class="text-xs text-red-500">{{ yamlError }}</span>
          </div>
        </div>
      </div>

      <!-- JSON source editor -->
      <details class="border-t border-gray-200 bg-gray-50 shrink-0">
        <summary class="cursor-pointer select-none px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">Edit Source</summary>
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { SchedulerData, ScheduledItem } from "./index";
import { useFreshPluginData } from "../../composables/useFreshPluginData";
import { apiPost } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import TasksTab from "./TasksTab.vue";
import { isToday } from "../../utils/format/date";

type YamlScalar = string | number | boolean | null;

const props = defineProps<{
  selectedResult?: ToolResultComplete<SchedulerData>;
}>();
const emit = defineEmits<{ updateResult: [result: ToolResultComplete] }>();

function detectInitialTab(result?: ToolResultComplete<SchedulerData>): SchedulerTab {
  const data = result?.data as Record<string, unknown> | undefined;
  if (data && ("task" in data || "tasks" in data || "triggered" in data || "deleted" in data)) {
    return SCHEDULER_TAB.tasks;
  }
  return SCHEDULER_TAB.calendar;
}

const activeTab = ref<SchedulerTab>(detectInitialTab(props.selectedResult));
const items = ref<ScheduledItem[]>(props.selectedResult?.data?.items ?? []);

const { refresh } = useFreshPluginData<ScheduledItem[]>({
  endpoint: () => API_ROUTES.scheduler.base,
  extract: (json) => {
    const payload = (json as { data?: { items?: ScheduledItem[] } }).data?.items;
    return Array.isArray(payload) ? payload : null;
  },
  apply: (data) => {
    items.value = data;
  },
});

watch(
  () => props.selectedResult?.uuid,
  () => {
    activeTab.value = detectInitialTab(props.selectedResult);
    items.value = props.selectedResult?.data?.items ?? [];
    void refresh();
  },
);

// ── View mode ──────────────────────────────────────────────────────────────

import { SCHEDULER_VIEW, SCHEDULER_VIEW_MODES as VIEW_MODES, SCHEDULER_TAB, type SchedulerViewMode as ViewMode, type SchedulerTab } from "./viewModes";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_MONTH_ITEMS = 3;

const viewMode = ref<ViewMode>(SCHEDULER_VIEW.month);
const currentDate = ref(new Date());

// ── Calendar utilities ─────────────────────────────────────────────────────

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function getWeekDays(date: Date): Date[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (__unused, i) => {
    const next = new Date(start);
    next.setDate(start.getDate() + i);
    return next;
  });
}

function getMonthGrid(year: number, month: number): Date[][] {
  const firstDay = new Date(year, month, 1);
  const start = startOfWeek(firstDay);
  const weeks: Date[][] = [];
  const WEEK_COUNT = 6;
  for (let weekIdx = 0; weekIdx < WEEK_COUNT; weekIdx++) {
    const week: Date[] = [];
    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const date = new Date(start);
      date.setDate(start.getDate() + weekIdx * 7 + dayIdx);
      week.push(date);
    }
    weeks.push(week);
  }
  return weeks;
}

function isCurrentMonth(date: Date): boolean {
  return date.getMonth() === currentDate.value.getMonth() && date.getFullYear() === currentDate.value.getFullYear();
}

function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function itemsForDay(day: Date): ScheduledItem[] {
  const dateStr = toDateString(day);
  return items.value.filter((item) => String(item.props.date) === dateStr);
}

const unscheduledItems = computed(() => items.value.filter((item) => !item.props.date));

function itemTime(item: ScheduledItem): string {
  const time = item.props.time;
  return typeof time === "string" ? time : "";
}

function dayLabel(date: Date): string {
  return WEEKDAY_LABELS[date.getDay() === 0 ? 6 : date.getDay() - 1];
}

// ── Navigation ─────────────────────────────────────────────────────────────

const weekDays = computed(() => getWeekDays(currentDate.value));

const monthGrid = computed(() => getMonthGrid(currentDate.value.getFullYear(), currentDate.value.getMonth()));

const headerLabel = computed(() => {
  if (viewMode.value === "week") {
    const days = weekDays.value;
    const fmt = (date: Date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${fmt(days[0])} – ${fmt(days[6])}, ${days[0].getFullYear()}`;
  }
  return currentDate.value.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
});

function goToday() {
  currentDate.value = new Date();
}

function goPrev() {
  const next = new Date(currentDate.value);
  if (viewMode.value === "week") {
    next.setDate(next.getDate() - 7);
  } else {
    next.setMonth(next.getMonth() - 1);
  }
  currentDate.value = next;
}

function goNext() {
  const next = new Date(currentDate.value);
  if (viewMode.value === "week") {
    next.setDate(next.getDate() + 7);
  } else {
    next.setMonth(next.getMonth() + 1);
  }
  currentDate.value = next;
}

// ── YAML helpers ────────────────────────────────────────────────────────────

function yamlStringValue(raw: string): string {
  const needsQuotes = raw === "" || /[:#[\]{},&*?|<>=!%@`]/.test(raw) || /^\s|\s$/.test(raw) || /^(true|false|null|~)$/i.test(raw) || /^\d/.test(raw);
  if (needsQuotes) {
    return `"${raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return raw;
}

function serializeYaml(item: ScheduledItem): string {
  const lines: string[] = [`title: ${yamlStringValue(item.title)}`];
  for (const [key, value] of Object.entries(item.props)) {
    if (value === null) continue;
    if (typeof value === "string") {
      lines.push(`${key}: ${yamlStringValue(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join("\n");
}

function parseYamlValue(raw: string): YamlScalar {
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

watch(items, () => {
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
});

async function applyItemEdit() {
  yamlError.value = "";
  const parsed = parseYaml(yamlText.value);
  if (!parsed) {
    yamlError.value = "Could not parse YAML — ensure 'title' is present";
    return;
  }
  const success = await callApi({
    action: "update",
    id: selectedId.value,
    title: parsed.title,
    props: parsed.props,
  });
  if (success) selectedId.value = null;
}

// ── JSON source editor ───────────────────────────────────────────────────────

function toJson(its: ScheduledItem[]) {
  return JSON.stringify(its, null, 2);
}

const editorText = ref(toJson(items.value));
const parseError = ref("");
// Last POST /api/scheduler failure. Cleared on the next successful call
// so the banner disappears as soon as things recover.
const apiError = ref<string | null>(null);
const isModified = computed(() => editorText.value !== toJson(items.value));

async function callApi(body: Record<string, unknown>): Promise<boolean> {
  const response = await apiPost<{ data?: { items?: ScheduledItem[] } }>(API_ROUTES.scheduler.base, body);
  if (!response.ok) {
    apiError.value = response.error;
    return false;
  }
  apiError.value = null;
  const result = response.data;
  items.value = result.data?.items ?? [];
  if (props.selectedResult) {
    emit("updateResult", {
      ...props.selectedResult,
      ...result,
      uuid: props.selectedResult.uuid,
    });
  }
  return true;
}

async function remove(item: ScheduledItem): Promise<void> {
  if (selectedId.value === item.id) selectedId.value = null;
  await callApi({ action: "delete", id: item.id });
}

async function applyChanges() {
  parseError.value = "";
  let parsed: ScheduledItem[];
  try {
    parsed = JSON.parse(editorText.value);
    if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
  } catch (err) {
    parseError.value = err instanceof Error ? err.message : "Invalid JSON";
    return;
  }
  callApi({ action: "replace", items: parsed });
}
</script>
