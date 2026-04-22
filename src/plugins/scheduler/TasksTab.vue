<template>
  <div class="flex-1 overflow-y-auto min-h-0 p-4">
    <!-- Mutation error banner -->
    <div v-if="mutationError" class="mb-3 px-4 py-2 bg-red-50 text-red-700 rounded text-sm" data-testid="scheduler-task-error">
      {{ mutationError }}
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center h-32 text-gray-400">{{ t("common.loading") }}</div>

    <!-- Error -->
    <div v-else-if="error" class="px-4 py-2 bg-red-50 text-red-700 rounded text-sm">
      {{ error }}
    </div>

    <!-- Task list + frequency hints -->
    <div v-else>
      <!-- Frequency hints reference -->
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
            <tr v-for="hint in FREQUENCY_HINTS" :key="hint.label" class="border-b border-gray-50 last:border-0">
              <td class="px-3 py-1">{{ hint.label }}</td>
              <td class="px-3 py-1 font-mono text-gray-700">{{ hint.schedule }}</td>
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
              <!-- Origin badge -->
              <span class="text-xs px-1.5 py-0.5 rounded font-medium shrink-0" :class="originClass(task.origin)">
                {{ originLabel(task.origin) }}
              </span>
              <span class="font-medium text-gray-800 truncate">
                {{ task.name }}
              </span>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <!-- Run now -->
              <button
                v-if="task.origin === 'user'"
                class="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
                :title="t('pluginSchedulerTasks.runNow')"
                :aria-label="t('pluginSchedulerTasks.runNow')"
                data-testid="scheduler-task-run"
                @click="runTask(task.id)"
              >
                <span class="material-icons text-sm">play_arrow</span>
              </button>
              <!-- Enable/disable toggle -->
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
              <!-- Delete -->
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

          <!-- Details row -->
          <div class="mt-1 flex items-center gap-3 text-xs text-gray-500">
            <span>{{ formatSchedule(task.schedule) }}</span>
            <span v-if="task.state?.lastRunResult" class="flex items-center gap-1">
              <span class="inline-block w-2 h-2 rounded-full" :class="resultDotClass(task.state.lastRunResult)"></span>
              {{ task.state.lastRunResult }}
            </span>
            <span v-if="task.state?.nextScheduledAt">{{ t("pluginSchedulerTasks.nextRun", { time: formatShortTime(task.state.nextScheduledAt) }) }}</span>
          </div>

          <!-- Description -->
          <div v-if="task.description" class="mt-1 text-xs text-gray-400 truncate">
            {{ task.description }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { apiGet, apiPost, apiPut, apiDelete } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import { formatShortTime } from "../../utils/format/date";

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
}

const FREQUENCY_HINTS = [
  { label: "News / RSS fetch", schedule: "Every 1h" },
  { label: "Journal daily pass", schedule: "Daily 23:00 UTC" },
  { label: "Wiki maintenance", schedule: "Daily 02:00 UTC" },
  { label: "Memory extraction", schedule: "Daily 00:00 UTC" },
  { label: "Calendar / contact sync", schedule: "Every 4h" },
] as const;

const tasks = ref<SchedulerTask[]>([]);
const loading = ref(true);
const error = ref("");
const mutationError = ref("");

async function fetchTasks(): Promise<void> {
  loading.value = true;
  error.value = "";
  const result = await apiGet<{ tasks: SchedulerTask[] }>(API_ROUTES.scheduler.tasks);
  loading.value = false;
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  tasks.value = result.data.tasks;
}

function originLabel(origin: string): string {
  if (origin === "system") return t("pluginSchedulerTasks.originSystem");
  if (origin === "user") return t("pluginSchedulerTasks.originUser");
  return t("pluginSchedulerTasks.originSkill");
}

function originClass(origin: string): string {
  if (origin === "system") return "bg-gray-100 text-gray-600";
  if (origin === "user") return "bg-blue-100 text-blue-700";
  return "bg-purple-100 text-purple-700";
}

function resultDotClass(result: string): string {
  if (result === "success") return "bg-green-500";
  if (result === "error") return "bg-red-500";
  return "bg-gray-400";
}

function formatSchedule(schedule: TaskSchedule): string {
  if (schedule.type === "interval" && schedule.intervalMs) {
    const mins = Math.round(schedule.intervalMs / 60000);
    if (mins >= 60) return `Every ${Math.round(mins / 60)}h`;
    return `Every ${mins}m`;
  }
  if (schedule.type === "daily" && schedule.time) {
    return `Daily ${schedule.time} UTC`;
  }
  return JSON.stringify(schedule);
}

async function runTask(taskId: string): Promise<void> {
  mutationError.value = "";
  const url = API_ROUTES.scheduler.taskRun.replace(":id", taskId);
  const result = await apiPost(url, {});
  if (!result.ok) {
    mutationError.value = t("pluginSchedulerTasks.runFailed", { error: result.error });
    return;
  }
  await fetchTasks();
}

async function toggleEnabled(task: SchedulerTask): Promise<void> {
  mutationError.value = "";
  const url = API_ROUTES.scheduler.task.replace(":id", task.id);
  const result = await apiPut(url, { enabled: task.enabled === false });
  if (!result.ok) {
    mutationError.value = t("pluginSchedulerTasks.toggleFailed", { error: result.error });
    return;
  }
  await fetchTasks();
}

async function deleteTask(taskId: string): Promise<void> {
  mutationError.value = "";
  const url = API_ROUTES.scheduler.task.replace(":id", taskId);
  const result = await apiDelete(url);
  if (!result.ok) {
    mutationError.value = t("pluginSchedulerTasks.deleteFailed", { error: result.error });
    return;
  }
  await fetchTasks();
}

onMounted(fetchTasks);
</script>
