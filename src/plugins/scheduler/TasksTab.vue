<template>
  <div class="flex-1 overflow-y-auto min-h-0 p-4">
    <div v-if="mutationError" class="mb-3 px-4 py-2 bg-red-50 text-red-700 rounded text-sm" data-testid="scheduler-task-error">
      {{ mutationError }}
    </div>

    <div v-if="loading" class="flex items-center justify-center h-32 text-gray-400">{{ t("common.loading") }}</div>

    <div v-else-if="error" class="px-4 py-2 bg-red-50 text-red-700 rounded text-sm">
      {{ error }}
    </div>

    <div v-else>
      <details class="mb-4 border border-gray-200 rounded-lg text-sm" data-testid="scheduler-frequency-hints">
        <summary class="px-3 py-2 cursor-pointer text-gray-600 font-medium select-none hover:bg-gray-50 rounded-lg">
          {{ t("pluginSchedulerTasks.recommendedFrequencies") }}
        </summary>
        <table class="w-full mt-1 mb-2 text-xs text-gray-500">
          <thead>
            <tr class="border-b border-gray-100">
              <th class="px-3 py-1 text-left font-medium text-gray-600">{{ t("pluginSchedulerTasks.tableTaskType") }}</th>
              <th class="px-3 py-1 text-left font-medium text-gray-600">{{ t("pluginSchedulerTasks.tableSuggestedSchedule") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="hint in FREQUENCY_HINTS" :key="hint.labelKey" class="border-b border-gray-50 last:border-0">
              <td class="px-3 py-1">{{ t(hint.labelKey) }}</td>
              <td class="px-3 py-1 font-mono text-gray-700">{{ formatSchedule(hint.schedule) }}</td>
            </tr>
          </tbody>
        </table>
      </details>

      <div v-if="tasks.length === 0" class="flex items-center justify-center h-32 text-gray-400">{{ t("pluginSchedulerTasks.noTasks") }}</div>

      <div v-else class="space-y-2">
        <div
          v-for="task in tasks"
          :key="task.id"
          :data-testid="`scheduler-task-${task.id}`"
          class="border border-gray-200 rounded-lg p-3 hover:bg-gray-50"
          :class="{ 'opacity-50': task.enabled === false }"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-xs px-1.5 py-0.5 rounded font-medium shrink-0" :class="originClass(task.origin)">
                {{ originLabel(task.origin) }}
              </span>
              <span class="font-medium text-gray-800 truncate">
                {{ task.name }}
              </span>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button
                v-if="task.origin !== 'system'"
                class="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
                :title="t('pluginSchedulerTasks.runNow')"
                :aria-label="t('pluginSchedulerTasks.runNow')"
                data-testid="scheduler-task-run"
                @click="runTask(task.id)"
              >
                <span class="material-icons text-sm">play_arrow</span>
              </button>
              <button
                v-if="task.origin === 'user'"
                class="px-2 py-1 text-xs rounded"
                :class="task.enabled !== false ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'"
                :title="task.enabled !== false ? t('pluginSchedulerTasks.disable') : t('pluginSchedulerTasks.enable')"
                @click="toggleEnabled(task)"
              >
                <span class="material-icons text-sm">
                  {{ task.enabled !== false ? "toggle_on" : "toggle_off" }}
                </span>
              </button>
              <button
                v-if="task.origin === 'user'"
                class="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded"
                :title="t('pluginSchedulerTasks.delete')"
                :aria-label="t('pluginSchedulerTasks.delete')"
                data-testid="scheduler-task-delete"
                @click="deleteTask(task.id)"
              >
                <span class="material-icons text-sm">delete</span>
              </button>
            </div>
          </div>

          <div class="mt-1 flex items-center gap-3 text-xs text-gray-500">
            <span>{{ formatSchedule(task.schedule) }}</span>
            <span v-if="task.state?.lastRunResult" class="flex items-center gap-1">
              <span class="inline-block w-2 h-2 rounded-full" :class="resultDotClass(task.state.lastRunResult)"></span>
              {{ task.state.lastRunResult }}
            </span>
            <span v-if="task.state?.nextScheduledAt">{{ t("pluginSchedulerTasks.nextRun", { time: formatShortTime(task.state.nextScheduledAt) }) }}</span>
          </div>

          <!-- Full (not truncated): users need to know what each task does. -->
          <div v-if="task.description" class="mt-1 text-xs text-gray-500 whitespace-pre-line">
            {{ task.description }}
          </div>

          <!-- Collapsed prompt + role for user/skill tasks; system tasks have neither. -->
          <details v-if="task.prompt" class="mt-2" :data-testid="`scheduler-task-details-${task.id}`">
            <summary class="text-xs text-gray-500 cursor-pointer select-none hover:text-gray-700">
              {{ t("pluginSchedulerTasks.detailsToggle") }}
            </summary>
            <div class="mt-1.5 space-y-1.5 ml-4">
              <div v-if="task.roleId" class="text-xs text-gray-600">
                <span class="font-medium">{{ t("pluginSchedulerTasks.roleLabel") }}:</span>
                <code class="ml-1 px-1 py-0.5 rounded bg-gray-100 text-gray-700">{{ task.roleId }}</code>
              </div>
              <div class="text-xs text-gray-600">
                <div class="font-medium mb-0.5">{{ t("pluginSchedulerTasks.promptLabel") }}:</div>
                <pre
                  class="px-2 py-1.5 rounded bg-gray-50 border border-gray-200 text-gray-700 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed"
                  :data-testid="`scheduler-task-prompt-${task.id}`"
                  >{{ task.prompt }}</pre>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { apiGet, apiPost, apiPut, apiDelete } from "../../utils/api";
import { pluginEndpoints } from "../api";
import { buildRouteUrl } from "../meta-types";
import type { SchedulerEndpoints } from "./automationsDefinition";
import { formatShortTime } from "../../utils/format/date";
import { formatSchedule as formatTaskSchedule, type TaskSchedule as FormatterTaskSchedule } from "./formatSchedule";
import { originKind, resultDotKind, nextEnabledState, type TaskOriginKind, type ResultDotKind } from "./taskDisplay";
import { scrollIntoViewByTestId } from "../../utils/dom/scrollIntoViewByTestId";
import { confirmItemDelete } from "../../utils/confirmDelete";

const { t } = useI18n();

interface TaskSchedule {
  type: string;
  intervalMs?: number;
  time?: string;
}

interface TaskState {
  lastRunAt?: string | null;
  lastRunResult?: string | null;
  nextScheduledAt?: string | null;
}

interface SchedulerTask {
  id: string;
  name: string;
  description?: string;
  schedule: TaskSchedule;
  origin: string;
  enabled?: boolean;
  state?: TaskState;
  // user / skill tasks carry prompt + role; system tasks omit them (their semantics are baked into the source).
  prompt?: string;
  roleId?: string;
  missedRunPolicy?: string;
}

// Structured (not pre-rendered) so daily rows route through formatTaskSchedule and pick up the viewer's local timezone. Labels are i18n keys (8-locale lockstep).
const FREQUENCY_HINTS: { labelKey: string; schedule: FormatterTaskSchedule }[] = [
  { labelKey: "pluginSchedulerTasks.hintNewsRss", schedule: { type: "interval", intervalMs: 3_600_000 } },
  { labelKey: "pluginSchedulerTasks.hintJournal", schedule: { type: "daily", time: "23:00" } },
  { labelKey: "pluginSchedulerTasks.hintWiki", schedule: { type: "daily", time: "02:00" } },
  { labelKey: "pluginSchedulerTasks.hintMemory", schedule: { type: "daily", time: "00:00" } },
  { labelKey: "pluginSchedulerTasks.hintCalendar", schedule: { type: "interval", intervalMs: 14_400_000 } },
];

const tasks = ref<SchedulerTask[]>([]);
const loading = ref(true);
const error = ref("");
const mutationError = ref("");

const endpoints = pluginEndpoints<SchedulerEndpoints>("scheduler");

// Monotonic id so a slow list GET issued before a mutation can't land after
// a newer one and overwrite the fresh snapshot with a stale row set.
let fetchSeq = 0;

async function fetchTasks(): Promise<void> {
  const seq = ++fetchSeq;
  // Full-screen loader only on the initial load. A refetch after a mutation
  // keeps the list mounted, or the whole list would unmount and reset scroll
  // position + every expanded <details> on each toggle/run/delete.
  if (tasks.value.length === 0) loading.value = true;
  error.value = "";
  const result = await apiGet<{ tasks: SchedulerTask[] }>(endpoints.tasksList.url);
  if (seq !== fetchSeq) return;
  loading.value = false;
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  tasks.value = result.data.tasks;
}

const ORIGIN_LABEL_KEY: Record<TaskOriginKind, string> = {
  system: "pluginSchedulerTasks.originSystem",
  user: "pluginSchedulerTasks.originUser",
  skill: "pluginSchedulerTasks.originSkill",
};

const ORIGIN_CLASS: Record<TaskOriginKind, string> = {
  system: "bg-gray-100 text-gray-600",
  user: "bg-blue-100 text-blue-700",
  skill: "bg-purple-100 text-purple-700",
};

const RESULT_DOT_CLASS: Record<ResultDotKind, string> = {
  success: "bg-green-500",
  error: "bg-red-500",
  other: "bg-gray-400",
};

function originLabel(origin: string): string {
  return t(ORIGIN_LABEL_KEY[originKind(origin)]);
}

function originClass(origin: string): string {
  return ORIGIN_CLASS[originKind(origin)];
}

function resultDotClass(result: string): string {
  return RESULT_DOT_CLASS[resultDotKind(result)];
}

function formatSchedule(schedule: TaskSchedule): string {
  return formatTaskSchedule(schedule as FormatterTaskSchedule);
}

async function runTask(taskId: string): Promise<void> {
  mutationError.value = "";
  const url = buildRouteUrl(endpoints.taskRun, { id: taskId });
  const result = await apiPost(url, {});
  if (!result.ok) {
    mutationError.value = t("pluginSchedulerTasks.runFailed", { error: result.error });
    return;
  }
  await fetchTasks();
}

async function toggleEnabled(task: SchedulerTask): Promise<void> {
  mutationError.value = "";
  const url = buildRouteUrl(endpoints.taskUpdate, { id: task.id });
  const result = await apiPut(url, { enabled: nextEnabledState(task.enabled) });
  if (!result.ok) {
    mutationError.value = t("pluginSchedulerTasks.toggleFailed", { error: result.error });
    return;
  }
  await fetchTasks();
}

async function deleteTask(taskId: string): Promise<void> {
  const name = tasks.value.find((task) => task.id === taskId)?.name ?? taskId;
  if (!confirmItemDelete(t("pluginSchedulerTasks.confirmDelete", { name }))) return;
  mutationError.value = "";
  const url = buildRouteUrl(endpoints.taskDelete, { id: taskId });
  const result = await apiDelete(url);
  if (!result.ok) {
    mutationError.value = t("pluginSchedulerTasks.deleteFailed", { error: result.error });
    return;
  }
  await fetchTasks();
}

// /automations/:taskId (e.g. from a notification) scrolls + flashes the matching row; unknown IDs are a no-op.
const route = useRoute();

async function focusUrlTask(taskId: string): Promise<void> {
  await nextTick();
  scrollIntoViewByTestId(`scheduler-task-${taskId}`);
}

onMounted(async () => {
  await fetchTasks();
  const urlTaskId = route.params.taskId;
  if (typeof urlTaskId === "string" && urlTaskId) {
    await focusUrlTask(urlTaskId);
  }
});

// Re-fire when the URL changes without unmounting — clicking a second notification while already on /automations.
watch(
  () => route.params.taskId,
  (taskId) => {
    if (typeof taskId === "string" && taskId) {
      void focusUrlTask(taskId);
    }
  },
);
</script>
