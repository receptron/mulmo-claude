<script setup lang="ts">
import { ref, onMounted } from "vue";
import { apiGet, apiPut } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

interface DirEntry {
  path: string;
  description: string;
  structure: "flat" | "by-name" | "by-date";
}

const dirs = ref<DirEntry[]>([]);
const loading = ref(true);
const error = ref("");
const saving = ref(false);
const saveStatus = ref("");

// Draft for new entry
const draftPath = ref("");
const draftDescription = ref("");
const draftStructure = ref<DirEntry["structure"]>("flat");
const draftError = ref("");

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  const result = await apiGet<{ dirs: DirEntry[] }>(API_ROUTES.config.workspaceDirs);
  loading.value = false;
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  dirs.value = result.data.dirs;
}

async function save(): Promise<void> {
  saving.value = true;
  saveStatus.value = "";
  const result = await apiPut<{ dirs: DirEntry[] }>(API_ROUTES.config.workspaceDirs, { dirs: dirs.value });
  saving.value = false;
  if (!result.ok) {
    saveStatus.value = result.error;
    return;
  }
  dirs.value = result.data.dirs;
  saveStatus.value = "Saved";
  setTimeout(() => {
    saveStatus.value = "";
  }, 2000);
}

function addEntry(): void {
  draftError.value = "";
  const p = draftPath.value.trim();
  if (!p) {
    draftError.value = "Path required";
    return;
  }
  if (!p.startsWith("data/") && !p.startsWith("artifacts/")) {
    draftError.value = "Must start with data/ or artifacts/";
    return;
  }
  if (dirs.value.some((d) => d.path === p)) {
    draftError.value = "Already exists";
    return;
  }
  dirs.value.push({
    path: p,
    description: draftDescription.value.trim(),
    structure: draftStructure.value,
  });
  draftPath.value = "";
  draftDescription.value = "";
  draftStructure.value = "flat";
}

function removeEntry(index: number): void {
  dirs.value.splice(index, 1);
}

onMounted(load);
</script>

<template>
  <div class="space-y-3">
    <p class="text-xs text-gray-600 leading-relaxed">
      Custom directories for organizing files under
      <code class="bg-gray-100 px-1 rounded">data/</code> and <code class="bg-gray-100 px-1 rounded">artifacts/</code>. Claude uses these to route file saves.
    </p>

    <!-- Loading -->
    <div v-if="loading" class="text-sm text-gray-400">Loading...</div>
    <div v-else-if="error" class="text-sm text-red-600 bg-red-50 rounded px-3 py-2">
      {{ error }}
    </div>

    <template v-else>
      <!-- Existing entries -->
      <div v-if="dirs.length === 0" class="text-sm text-gray-400">No custom directories configured.</div>
      <div v-else class="space-y-1.5">
        <div
          v-for="(dir, i) in dirs"
          :key="dir.path"
          class="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded text-sm"
          :data-testid="`workspace-dir-${i}`"
        >
          <div class="flex-1 min-w-0">
            <div class="font-mono text-xs text-gray-800">{{ dir.path }}/</div>
            <div v-if="dir.description" class="text-xs text-gray-500 truncate">
              {{ dir.description }}
            </div>
          </div>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 shrink-0">
            {{ dir.structure }}
          </span>
          <button class="text-gray-300 hover:text-red-500 shrink-0" title="Remove" @click="removeEntry(i)">
            <span class="material-icons text-sm">close</span>
          </button>
        </div>
      </div>

      <!-- Add new -->
      <div class="border border-gray-200 rounded p-2 space-y-2">
        <div class="text-xs font-semibold text-gray-600">Add directory</div>
        <div class="flex gap-2">
          <input
            v-model="draftPath"
            class="flex-1 px-2 py-1 text-xs font-mono border border-gray-300 rounded focus:outline-none focus:border-blue-400"
            placeholder="data/clients or artifacts/reports"
            data-testid="workspace-dir-path-input"
            @keydown.enter="addEntry"
            @keydown.stop
          />
          <select
            v-model="draftStructure"
            class="text-xs border border-gray-300 rounded px-1 py-1 focus:outline-none"
            data-testid="workspace-dir-structure-select"
          >
            <option value="flat">flat</option>
            <option value="by-name">by-name</option>
            <option value="by-date">by-date</option>
          </select>
        </div>
        <input
          v-model="draftDescription"
          class="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          placeholder="Description (what goes in this folder)"
          data-testid="workspace-dir-desc-input"
          @keydown.enter="addEntry"
          @keydown.stop
        />
        <div class="flex items-center gap-2">
          <button class="px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600" data-testid="workspace-dir-add-btn" @click="addEntry">Add</button>
          <span v-if="draftError" class="text-xs text-red-500">{{ draftError }}</span>
        </div>
      </div>

      <!-- Save -->
      <div class="flex items-center gap-2">
        <button
          class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300"
          :disabled="saving"
          data-testid="workspace-dirs-save-btn"
          @click="save"
        >
          {{ saving ? "Saving..." : "Save" }}
        </button>
        <span v-if="saveStatus" class="text-xs" :class="saveStatus === 'Saved' ? 'text-green-600' : 'text-red-600'">
          {{ saveStatus }}
        </span>
      </div>
    </template>
  </div>
</template>
