<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { apiGet, apiPut } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

const { t } = useI18n();

interface RefDirEntry {
  hostPath: string;
  label: string;
}

// The tab supports only append + remove — no in-place edit — so each
// mutation persists to the server immediately instead of batching
// behind a Save button. `persistError` surfaces the most recent PUT
// failure near the add form; next user action (another add or
// remove) clears it.
const dirs = ref<RefDirEntry[]>([]);
const loading = ref(true);
const error = ref("");
const persistError = ref("");

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

// Concurrency: user can click Add then Remove (or two Adds) before
// the first PUT returns. If we just rolled back to a captured
// `previous` on failure, a stale response would clobber newer local
// state. Instead:
//  - Queue PUTs through a Promise chain (`inflight`) so they run in
//    the same order the user triggered them and can't overlap.
//  - Each task only applies the server echo if it's the LAST one
//    still pending — intermediate echoes might be stale relative
//    to subsequent optimistic mutations.
//  - On failure with nothing else pending, reload from the server
//    (authoritative) instead of rolling back to a snapshot that
//    may itself be obsolete.
let inflight: Promise<unknown> = Promise.resolve();
let pendingCount = 0;

async function persist(nextState: RefDirEntry[]): Promise<boolean> {
  dirs.value = nextState;
  pendingCount++;
  const task: Promise<boolean> = inflight
    .catch(() => undefined)
    .then(async () => {
      const result = await apiPut<{ dirs: RefDirEntry[] }>(API_ROUTES.config.referenceDirs, { dirs: nextState });
      pendingCount--;
      if (!result.ok) {
        persistError.value = result.error;
        if (pendingCount === 0) await load();
        return false;
      }
      persistError.value = "";
      if (pendingCount === 0) dirs.value = result.data.dirs;
      return true;
    });
  inflight = task;
  return task;
}

async function addEntry(): Promise<void> {
  draftError.value = "";
  const path = draftPath.value.trim();
  if (!path) {
    draftError.value = t("settingsReferenceDirs.errPathRequired");
    return;
  }
  if (!path.startsWith("/") && !path.startsWith("~/")) {
    draftError.value = t("settingsReferenceDirs.errMustBeAbsolute");
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
    draftError.value = t("settingsReferenceDirs.errAlreadyExists");
    return;
  }
  const lastSeg = normalized.split("/").pop();
  const label = draftLabel.value.trim() || lastSeg || normalized;
  // Reject duplicate labels — @ref/<label> routing requires uniqueness
  if (dirs.value.some((dir) => dir.label === label)) {
    draftError.value = t("settingsReferenceDirs.errLabelConflict", { label });
    return;
  }
  const ok = await persist([...dirs.value, { hostPath: normalized, label }]);
  if (ok) {
    draftPath.value = "";
    draftLabel.value = "";
  }
}

async function removeEntry(index: number): Promise<void> {
  await persist(dirs.value.filter((_, i) => i !== index));
}

onMounted(load);
</script>

<template>
  <div class="space-y-3">
    <p class="text-xs text-gray-600 leading-relaxed">{{ t("settingsReferenceDirs.explanation") }}</p>

    <!-- Loading -->
    <div v-if="loading" class="text-sm text-gray-400">{{ t("common.loading") }}</div>
    <div v-else-if="error" class="text-sm text-red-600 bg-red-50 rounded px-3 py-2">
      {{ error }}
    </div>

    <template v-else>
      <!-- Existing entries -->
      <div v-if="dirs.length === 0" class="text-sm text-gray-400">{{ t("settingsReferenceDirs.noEntries") }}</div>
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
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 shrink-0">{{ t("settingsReferenceDirs.readOnlyBadge") }}</span>
          <button class="text-gray-300 hover:text-red-500 shrink-0" :title="t('common.remove')" data-testid="reference-dir-remove-btn" @click="removeEntry(i)">
            <span class="material-icons text-sm">close</span>
          </button>
        </div>
      </div>

      <!-- Add new -->
      <div class="border border-gray-200 rounded p-2 space-y-2">
        <div class="text-xs font-semibold text-gray-600">{{ t("settingsReferenceDirs.addDirTitle") }}</div>
        <input
          v-model="draftPath"
          class="w-full px-2 py-1 text-xs font-mono border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          :placeholder="t('settingsReferenceDirs.pathPlaceholder')"
          data-testid="reference-dir-path-input"
          @keydown.enter="addEntry"
          @keydown.stop
        />
        <input
          v-model="draftLabel"
          class="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          :placeholder="t('settingsReferenceDirs.labelPlaceholder')"
          data-testid="reference-dir-label-input"
          @keydown.enter="addEntry"
          @keydown.stop
        />
        <div class="flex items-center gap-2">
          <button class="px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600" data-testid="reference-dir-add-btn" @click="addEntry">
            {{ t("common.add") }}
          </button>
          <span v-if="draftError" class="text-xs text-red-500">{{ draftError }}</span>
        </div>
      </div>

      <!-- Persist error (from the most recent add/remove PUT) -->
      <div v-if="persistError" class="text-xs text-red-600 bg-red-50 rounded px-3 py-1.5" data-testid="reference-dirs-persist-error">
        {{ persistError }}
      </div>
    </template>
  </div>
</template>
