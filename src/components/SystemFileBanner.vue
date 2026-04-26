<template>
  <div class="m-4 mb-0 rounded border border-blue-200 bg-blue-50 text-sm" data-testid="system-file-banner">
    <div class="flex items-start gap-2 px-3 py-2">
      <span class="text-blue-600 shrink-0" aria-hidden="true">{{ INFO_ICON }}</span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-semibold text-blue-900">{{ t(`systemFiles.${descriptor.id}.title`) }}</span>
          <span :class="['text-xs px-1.5 py-0.5 rounded shrink-0', policyChipClass]">
            {{ t(`systemFiles.editPolicy.${descriptor.editPolicy}`) }}
          </span>
        </div>
        <p v-if="!collapsed" class="mt-1 text-gray-700 leading-snug whitespace-pre-line">
          {{ t(`systemFiles.${descriptor.id}.summary`) }}
        </p>
        <p v-if="!collapsed && descriptor.schemaRef" class="mt-1 text-xs text-gray-500">
          {{ t("systemFiles.schemaLabel") }}:
          <a :href="schemaUrl" target="_blank" rel="noopener noreferrer" class="font-mono text-blue-700 hover:underline break-all">
            {{ descriptor.schemaRef }}
          </a>
        </p>
      </div>
      <button
        type="button"
        class="shrink-0 text-xs text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded px-1"
        :aria-label="collapsed ? t('systemFiles.showDetails') : t('systemFiles.hideDetails')"
        :data-testid="`system-file-banner-toggle`"
        @click="toggle"
      >
        {{ collapsed ? t("systemFiles.showDetails") : t("systemFiles.hideDetails") }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { SystemFileDescriptor, EditPolicy } from "../config/systemFileDescriptors";

const { t } = useI18n();

const props = defineProps<{
  descriptor: SystemFileDescriptor;
  path: string;
}>();

// Per-path collapse state. Persisted to localStorage so a user who
// dismissed the banner once doesn't see it expanded again on reload.
// Key includes the descriptor id (not the path) so all roles share
// one collapse decision — we want "I read the roles banner, hide it
// for every role file" rather than asking per-file.
const STORAGE_PREFIX = "systemFileBanner.collapsed.";

const INFO_ICON = "ℹ️";

function storageKey(descriptorId: string): string {
  return STORAGE_PREFIX + descriptorId;
}

function loadCollapsed(descriptorId: string): boolean {
  try {
    return localStorage.getItem(storageKey(descriptorId)) === "1";
  } catch {
    return false;
  }
}

function saveCollapsed(descriptorId: string, value: boolean): void {
  try {
    if (value) localStorage.setItem(storageKey(descriptorId), "1");
    else localStorage.removeItem(storageKey(descriptorId));
  } catch {
    // localStorage may throw in private browsing / quota-exceeded;
    // banner state degrades to in-memory only, no user-visible error.
  }
}

const collapsed = ref(loadCollapsed(props.descriptor.id));

// Re-load when the descriptor changes (different file selected).
watch(
  () => props.descriptor.id,
  (descriptorId) => {
    collapsed.value = loadCollapsed(descriptorId);
  },
);

function toggle(): void {
  collapsed.value = !collapsed.value;
  saveCollapsed(props.descriptor.id, collapsed.value);
}

const POLICY_CHIP_CLASSES: Record<EditPolicy, string> = {
  "agent-managed-but-hand-editable": "bg-emerald-100 text-emerald-800",
  "user-editable": "bg-blue-100 text-blue-800",
  "agent-managed": "bg-amber-100 text-amber-800",
  "fragile-format": "bg-orange-100 text-orange-800",
  ephemeral: "bg-gray-200 text-gray-700",
};

const policyChipClass = computed(() => POLICY_CHIP_CLASSES[props.descriptor.editPolicy]);

const GITHUB_REPO_URL = "https://github.com/receptron/mulmoclaude/blob/main/";

const schemaUrl = computed(() => (props.descriptor.schemaRef ? GITHUB_REPO_URL + props.descriptor.schemaRef : ""));
</script>
