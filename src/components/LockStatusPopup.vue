<template>
  <div class="relative">
    <button
      ref="button"
      data-testid="sandbox-lock-button"
      :class="sandboxEnabled ? 'text-gray-400 hover:text-gray-700' : 'text-amber-400 hover:text-amber-500'"
      :title="sandboxEnabled ? t('lockStatusPopup.sandboxEnabledTooltip') : t('lockStatusPopup.noSandboxTooltip')"
      @click="emit('update:open', !open)"
    >
      <span class="material-icons">{{ sandboxEnabled ? "lock" : "lock_open" }}</span>
    </button>
    <div v-if="open" ref="popup" class="absolute left-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-3 text-xs">
      <p class="mb-2" :class="sandboxEnabled ? 'text-green-800' : 'text-amber-500'">
        <template v-if="sandboxEnabled">
          <span class="material-icons text-xs align-middle mr-1">lock</span>
          <strong>{{ t("lockStatusPopup.sandboxEnabledLabel") }}</strong> {{ t("lockStatusPopup.sandboxEnabledBody") }}
        </template>
        <template v-else>
          <span class="material-icons text-xs align-middle mr-1">warning</span>
          <strong>{{ t("lockStatusPopup.noSandboxLabel") }}</strong> {{ t("lockStatusPopup.noSandboxBodyPrefix") }}
          <a href="https://www.docker.com/products/docker-desktop/" target="_blank" class="underline">{{ t("lockStatusPopup.dockerDesktop") }}</a>
          {{ t("lockStatusPopup.noSandboxBodySuffix") }}
        </template>
      </p>
      <div v-if="sandboxEnabled" data-testid="sandbox-credentials-block" class="mb-2 border-t border-gray-100 pt-2">
        <p class="text-gray-400 mb-1">{{ t("lockStatusPopup.hostCredentials") }}</p>
        <p v-if="sandboxStatus === null" class="text-gray-400 italic" data-testid="sandbox-credentials-loading">{{ t("lockStatusPopup.credsLoading") }}</p>
        <template v-else>
          <p data-testid="sandbox-credentials-ssh">
            <span class="mr-1">🔑</span>
            <span class="text-gray-500">{{ t("lockStatusPopup.sshAgent") }}</span>
            <span :class="sandboxStatus.sshAgent ? 'text-green-700' : 'text-gray-400'" class="ml-1">
              {{ sandboxStatus.sshAgent ? t("lockStatusPopup.forwarded") : t("lockStatusPopup.notForwarded") }}
            </span>
          </p>
          <p data-testid="sandbox-credentials-mounts">
            <span class="mr-1">📁</span>
            <span class="text-gray-500">{{ t("lockStatusPopup.mountedConfigs") }}</span>
            <span :class="sandboxStatus.mounts.length > 0 ? 'text-green-700' : 'text-gray-400'" class="ml-1">
              {{ sandboxStatus.mounts.length > 0 ? sandboxStatus.mounts.join(", ") : t("lockStatusPopup.none") }}
            </span>
          </p>
        </template>
      </div>
      <p class="text-gray-400 mb-1">{{ t("lockStatusPopup.testIsolation") }}</p>
      <div class="flex flex-col gap-1">
        <button
          v-for="q in SANDBOX_TEST_QUERIES"
          :key="q"
          data-testid="sandbox-test-query"
          class="text-left rounded px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
          @click="onTestQuery(q)"
        >
          {{ q }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSandboxStatus } from "../composables/useSandboxStatus";

const { t } = useI18n();

const props = defineProps<{
  sandboxEnabled: boolean;
  open: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  testQuery: [query: string];
}>();

// Canned queries that demonstrate what the sandbox does / doesn't
// allow. Kept here (not passed as a prop) because they are specific
// to this popup and nothing else in the app needs them.
//
// The last entry is intentionally broader than the others: after #327
// shipped opt-in credential forwarding, users need a way to ask what's
// actually attached to *their* container, not just read the generic
// docs. Claude answers by reading config/helps/sandbox.md and
// inspecting the live state via built-in tools.
const SANDBOX_TEST_QUERIES = [
  "Run `whoami` and show the result",
  "Run `hostname` and show the result",
  "Try to list files in ~/Library",
  "Read config/helps/sandbox.md and explain how the sandbox works",
  "Explain my current sandbox and credential setup",
];

const button = ref<HTMLButtonElement | null>(null);
const popup = ref<HTMLDivElement | null>(null);
defineExpose({ button, popup });

// Lazy-load the sandbox credential state the first time the popup
// opens (and only when the sandbox is actually enabled — /api/sandbox
// returns `{}` otherwise and the UI block is hidden).
const { status: sandboxStatus, ensureLoaded } = useSandboxStatus();
watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen && props.sandboxEnabled) await ensureLoaded();
  },
);

function onTestQuery(query: string): void {
  emit("update:open", false);
  emit("testQuery", query);
}
</script>
