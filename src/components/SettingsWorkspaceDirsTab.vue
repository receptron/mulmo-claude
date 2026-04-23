<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { apiGet, apiPut } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

const { t } = useI18n();

interface DirEntry {
  path: string;
  description: string;
  structure: "flat" | "by-name" | "by-date";
}

// Append + remove only — every mutation persists immediately. No
// draft/save split: there was nothing to edit in place, so the old
// Save button just risked silent data loss when a user added an
// entry and forgot to confirm.
const dirs = ref<DirEntry[]>([]);
const loading = ref(true);
const error = ref("");
const persistError = ref("");

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

async function persist(previous: DirEntry[]): Promise<boolean> {
  const result = await apiPut<{ dirs: DirEntry[] }>(API_ROUTES.config.workspaceDirs, { dirs: dirs.value });
  if (!result.ok) {
    dirs.value = previous;
    persistError.value = result.error;
    return false;
  }
  dirs.value = result.data.dirs;
  persistError.value = "";
  return true;
}

async function addEntry(): Promise<void> {
  draftError.value = "";
  const path = draftPath.value.trim();
  if (!path) {
    draftError.value = t("settingsWorkspaceDirs.errPathRequired");
    return;
  }
  if (!path.startsWith("data/") && !path.startsWith("artifacts/")) {
    draftError.value = t("settingsWorkspaceDirs.errMustStartWith");
    return;
  }
  if (dirs.value.some((dir) => dir.path === path)) {
    draftError.value = t("settingsWorkspaceDirs.errAlreadyExists");
    return;
  }
  const previous = dirs.value.slice();
  dirs.value = [
    ...previous,
    {
      path,
      description: draftDescription.value.trim(),
      structure: draftStructure.value,
    },
  ];
  const ok = await persist(previous);
  if (ok) {
    draftPath.value = "";
    draftDescription.value = "";
    draftStructure.value = "flat";
  }
}

async function removeEntry(index: number): Promise<void> {
  const previous = dirs.value.slice();
  dirs.value = previous.filter((_, i) => i !== index);
  await persist(previous);
}

onMounted(load);
</script>

<template>
  <div class="space-y-3">
    <i18n-t keypath="settingsWorkspaceDirs.explanation" tag="p" class="text-xs text-gray-600 leading-relaxed">
      <template #dataDir><code class="bg-gray-100 px-1 rounded">data/</code></template>
      <template #artifactsDir><code class="bg-gray-100 px-1 rounded">artifacts/</code></template>
    </i18n-t>

    <!-- Loading -->
    <div v-if="loading" class="text-sm text-gray-400">{{ t("common.loading") }}</div>
    <div v-else-if="error" class="text-sm text-red-600 bg-red-50 rounded px-3 py-2">
      {{ error }}
    </div>

    <template v-else>
      <!-- Existing entries -->
      <div v-if="dirs.length === 0" class="text-sm text-gray-400">{{ t("settingsWorkspaceDirs.noEntries") }}</div>
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
          <button class="text-gray-300 hover:text-red-500 shrink-0" :title="t('common.remove')" @click="removeEntry(i)">
            <span class="material-icons text-sm">close</span>
          </button>
        </div>
      </div>

      <!-- Add new -->
      <div class="border border-gray-200 rounded p-2 space-y-2">
        <div class="text-xs font-semibold text-gray-600">{{ t("settingsWorkspaceDirs.addDirTitle") }}</div>
        <div class="flex gap-2">
          <input
            v-model="draftPath"
            class="flex-1 px-2 py-1 text-xs font-mono border border-gray-300 rounded focus:outline-none focus:border-blue-400"
            :placeholder="t('settingsWorkspaceDirs.pathPlaceholder')"
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
          :placeholder="t('settingsWorkspaceDirs.descPlaceholder')"
          data-testid="workspace-dir-desc-input"
          @keydown.enter="addEntry"
          @keydown.stop
        />
        <div class="flex items-center gap-2">
          <button class="px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600" data-testid="workspace-dir-add-btn" @click="addEntry">
            {{ t("common.add") }}
          </button>
          <span v-if="draftError" class="text-xs text-red-500">{{ draftError }}</span>
        </div>
      </div>

      <!-- Persist error (from the most recent add/remove PUT) -->
      <div v-if="persistError" class="text-xs text-red-600 bg-red-50 rounded px-3 py-1.5" data-testid="workspace-dirs-persist-error">
        {{ persistError }}
      </div>
    </template>
  </div>
</template>
