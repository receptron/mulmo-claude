<script setup lang="ts">
import { ref, onMounted } from "vue";
import { apiGet, apiPut } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

interface RefDirEntry {
  hostPath: string;
  label: string;
}

const dirs = ref<RefDirEntry[]>([]);
const loading = ref(true);
const error = ref("");
const saving = ref(false);
const saveStatus = ref("");

const draftPath = ref("");
const draftLabel = ref("");
const draftError = ref("");

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  const result = await apiGet<{ dirs: RefDirEntry[] }>(API_ROUTES.config.referenceDirs);
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
  const result = await apiPut<{ dirs: RefDirEntry[] }>(API_ROUTES.config.referenceDirs, { dirs: dirs.value });
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
  const path = draftPath.value.trim();
  if (!path) {
    draftError.value = "Path required";
    return;
  }
  if (!path.startsWith("/") && !path.startsWith("~/")) {
    draftError.value = "Must be an absolute path or start with ~/";
    return;
  }
  // Normalize: trim trailing slashes for consistent comparison
  let normalized = path;
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  const stripSlash = (str: string): string => {
    let cleaned = str;
    while (cleaned.length > 1 && cleaned.endsWith("/")) cleaned = cleaned.slice(0, -1);
    return cleaned;
  };
  if (dirs.value.some((dir) => stripSlash(dir.hostPath) === normalized)) {
    draftError.value = "Already exists";
    return;
  }
  const lastSeg = normalized.split("/").pop();
  const label = draftLabel.value.trim() || lastSeg || normalized;
  // Reject duplicate labels — @ref/<label> routing requires uniqueness
  if (dirs.value.some((dir) => dir.label === label)) {
    draftError.value = `Label "${label}" already exists`;
    return;
  }
  dirs.value.push({ hostPath: normalized, label });
  draftPath.value = "";
  draftLabel.value = "";
}

function removeEntry(index: number): void {
  dirs.value.splice(index, 1);
}

onMounted(load);
</script>

<template>
  <div class="space-y-3">
    <p class="text-xs text-gray-600 leading-relaxed">
      External directories Claude can read but not modify. In Docker mode, these are mounted read-only. Useful for referencing Obsidian vaults, project code, or
      document folders.
    </p>

    <!-- Loading -->
    <div v-if="loading" class="text-sm text-gray-400">Loading...</div>
    <div v-else-if="error" class="text-sm text-red-600 bg-red-50 rounded px-3 py-2">
      {{ error }}
    </div>

    <template v-else>
      <!-- Existing entries -->
      <div v-if="dirs.length === 0" class="text-sm text-gray-400">No reference directories configured.</div>
      <div v-else class="space-y-1.5">
        <div
          v-for="(dir, i) in dirs"
          :key="dir.hostPath"
          class="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded text-sm"
          :data-testid="`reference-dir-${i}`"
        >
          <span class="material-icons text-sm text-gray-400 shrink-0">folder_open</span>
          <div class="flex-1 min-w-0">
            <div class="font-mono text-xs text-gray-800 truncate">
              {{ dir.hostPath }}
            </div>
            <div v-if="dir.label" class="text-xs text-gray-500 truncate">
              {{ dir.label }}
            </div>
          </div>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 shrink-0"> read-only </span>
          <button class="text-gray-300 hover:text-red-500 shrink-0" title="Remove" data-testid="reference-dir-remove-btn" @click="removeEntry(i)">
            <span class="material-icons text-sm">close</span>
          </button>
        </div>
      </div>

      <!-- Add new -->
      <div class="border border-gray-200 rounded p-2 space-y-2">
        <div class="text-xs font-semibold text-gray-600">Add reference directory</div>
        <input
          v-model="draftPath"
          class="w-full px-2 py-1 text-xs font-mono border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          placeholder="/Users/me/ObsidianVault or ~/Documents/notes"
          data-testid="reference-dir-path-input"
          @keydown.enter="addEntry"
          @keydown.stop
        />
        <input
          v-model="draftLabel"
          class="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          placeholder="Label (optional — defaults to folder name)"
          data-testid="reference-dir-label-input"
          @keydown.enter="addEntry"
          @keydown.stop
        />
        <div class="flex items-center gap-2">
          <button class="px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600" data-testid="reference-dir-add-btn" @click="addEntry">Add</button>
          <span v-if="draftError" class="text-xs text-red-500">{{ draftError }}</span>
        </div>
      </div>

      <!-- Save -->
      <div class="flex items-center gap-2">
        <button
          class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300"
          :disabled="saving"
          data-testid="reference-dirs-save-btn"
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
