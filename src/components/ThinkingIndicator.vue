<template>
  <div class="px-2 py-1 text-sm" role="status" aria-live="polite" data-testid="thinking-indicator">
    <div class="flex items-center gap-2 text-gray-500">
      <span class="text-xs">{{ statusMessage }}</span>
      <span class="flex gap-1" aria-hidden="true">
        <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style="animation-delay: 0ms" />
        <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style="animation-delay: 150ms" />
        <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style="animation-delay: 300ms" />
      </span>
      <span v-if="runElapsedMs !== null && runElapsedMs >= 1000" class="text-xs text-gray-400 tabular-nums" data-testid="run-elapsed">
        · {{ formatElapsed(runElapsedMs) }}
      </span>
    </div>
    <div v-if="pendingCalls && pendingCalls.length > 0" class="mt-1 space-y-0.5">
      <div v-for="call in pendingCalls" :key="call.toolUseId" class="flex items-center gap-1.5 text-xs text-gray-400">
        <span class="w-1.5 h-1.5 rounded-full bg-blue-300 shrink-0 animate-pulse" aria-hidden="true" />
        <span class="font-mono truncate">{{ call.toolName }}</span>
        <span class="text-xs text-gray-300 tabular-nums shrink-0">· {{ formatElapsed(call.elapsedMs) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatElapsed } from "../utils/agent/formatElapsed";

interface PendingCall {
  toolUseId: string;
  toolName: string;
  elapsedMs: number;
}

withDefaults(
  defineProps<{
    statusMessage: string;
    runElapsedMs?: number | null;
    pendingCalls?: PendingCall[];
  }>(),
  { runElapsedMs: null, pendingCalls: () => [] },
);
</script>
