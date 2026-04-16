<template>
  <div class="relative">
    <button
      ref="button"
      data-testid="sandbox-lock-button"
      :class="
        sandboxEnabled
          ? 'text-gray-400 hover:text-gray-700'
          : 'text-amber-400 hover:text-amber-500'
      "
      :title="
        sandboxEnabled
          ? 'Sandbox enabled (Docker)'
          : 'No sandbox (Docker not found)'
      "
      @click="emit('update:open', !open)"
    >
      <span class="material-icons">{{
        sandboxEnabled ? "lock" : "lock_open"
      }}</span>
    </button>
    <div
      v-if="open"
      ref="popup"
      class="absolute right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-3 text-xs"
    >
      <p
        class="mb-2"
        :class="sandboxEnabled ? 'text-green-800' : 'text-amber-500'"
      >
        <template v-if="sandboxEnabled">
          <span class="material-icons text-xs align-middle mr-1">lock</span>
          <strong>Sandbox enabled:</strong> Docker is running. Filesystem access
          is isolated.
        </template>
        <template v-else>
          <span class="material-icons text-xs align-middle mr-1">warning</span>
          <strong>No sandbox:</strong> Claude can access all files on your
          machine. Install
          <a
            href="https://www.docker.com/products/docker-desktop/"
            target="_blank"
            class="underline"
            >Docker Desktop</a
          >
          to enable filesystem isolation.
        </template>
      </p>
      <p class="text-gray-400 mb-1">Test sandbox isolation:</p>
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
import { ref } from "vue";

defineProps<{
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
const SANDBOX_TEST_QUERIES = [
  "Run `whoami` and show the result",
  "Run `hostname` and show the result",
  "Try to list files in ~/Library",
  "Read helps/sandbox.md and explain how the sandbox works",
];

const button = ref<HTMLButtonElement | null>(null);
const popup = ref<HTMLDivElement | null>(null);
defineExpose({ button, popup });

function onTestQuery(q: string): void {
  emit("update:open", false);
  emit("testQuery", q);
}
</script>
