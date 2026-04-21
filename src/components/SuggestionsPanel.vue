<template>
  <div v-if="queries.length > 0" class="border-t border-gray-200">
    <div v-if="expanded" ref="listRef" class="px-4 pt-2 max-h-64 overflow-y-auto flex flex-col gap-1">
      <button
        v-for="query in queries"
        :key="query"
        class="text-left text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded px-3 py-1.5 border border-gray-300 transition-colors"
        @click="onClick($event, query)"
      >
        {{ query }}
      </button>
      <p class="text-center text-[10px] text-gray-400 py-0.5">click to send · shift+click to edit</p>
    </div>
    <button
      class="w-full flex items-center justify-between px-4 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
      @click="expanded = !expanded"
    >
      <span class="flex items-center gap-1">
        <span class="material-icons text-sm">lightbulb</span>
        Suggestions
      </span>
      <span class="material-icons text-sm transition-transform" :class="{ 'rotate-180': !expanded }">expand_less</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

defineProps<{
  queries: string[];
}>();

const emit = defineEmits<{
  send: [query: string];
  edit: [query: string];
}>();

const expanded = ref(false);
const listRef = ref<HTMLDivElement | null>(null);

watch(expanded, (isExpanded) => {
  if (!isExpanded) return;
  nextTick(() => {
    if (listRef.value) {
      listRef.value.scrollTop = listRef.value.scrollHeight;
    }
  });
});

function onClick(e: MouseEvent, query: string): void {
  expanded.value = false;
  if (e.shiftKey) {
    emit("edit", query);
    return;
  }
  emit("send", query);
}

function collapse(): void {
  expanded.value = false;
}

defineExpose({ collapse });
</script>
