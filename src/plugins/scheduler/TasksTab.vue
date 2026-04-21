<template>
  <div class="flex-1 overflow-y-auto min-h-0 p-4">
    <!-- Mutation error banner -->
    <div v-if="mutationError" class="mb-3 px-4 py-2 bg-red-50 text-red-700 rounded text-sm" data-testid="scheduler-task-error">
      {{ mutationError }}
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center h-32 text-gray-400">Loading...</div>

    <!-- Error -->
    <div v-else-if="error" class="px-4 py-2 bg-red-50 text-red-700 rounded text-sm">
      {{ error }}
    </div>

    <!-- Task list -->
    <div v-else>
      <div v-if="tasks.length === 0" class="flex items-center justify-center h-32 text-gray-400">No scheduled tasks</div>

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
                title="Run now"
                aria-label="Run now"
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
                :title="task.enabled !== false ? 'Disable' : 'Enable'"
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
                title="Delete"
                aria-label="Delete"
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
            <span v-if="task.state?.nextScheduledAt"> Next: {{ formatShortTime(task.state.nextScheduledAt) }} </span>
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
import { apiGet, apiPost, apiPut, apiDelete } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import { formatShortTime } from "../../utils/format/date";

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
  if (origin === "system") return "System";
  if (origin === "user") return "User";
  return "Skill";
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

async function runTask(id: string): Promise<void> {
  mutationError.value = "";
  const url = API_ROUTES.scheduler.taskRun.replace(":id", id);
  const result = await apiPost(url, {});
  if (!result.ok) {
    mutationError.value = `Run failed: ${result.error}`;
    return;
  }
  await fetchTasks();
}

async function toggleEnabled(task: SchedulerTask): Promise<void> {
  mutationError.value = "";
  const url = API_ROUTES.scheduler.task.replace(":id", task.id);
  const result = await apiPut(url, { enabled: task.enabled === false });
  if (!result.ok) {
    mutationError.value = `Toggle failed: ${result.error}`;
    return;
  }
  await fetchTasks();
}

async function deleteTask(id: string): Promise<void> {
  mutationError.value = "";
  const url = API_ROUTES.scheduler.task.replace(":id", id);
  const result = await apiDelete(url);
  if (!result.ok) {
    mutationError.value = `Delete failed: ${result.error}`;
    return;
  }
  await fetchTasks();
}

onMounted(fetchTasks);
</script>
