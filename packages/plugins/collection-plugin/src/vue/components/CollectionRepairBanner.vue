<template>
  <!-- Repair banner: the server flagged record files that won't load /
       violate the schema and are silently skipped. The button reports
       them back to the LLM (same path presentCollection uses) so it
       fixes the files. View-independent, so it sits above the body. -->
  <div
    class="mx-6 mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-900 shadow-sm flex items-center gap-3"
    data-testid="collections-data-issues"
  >
    <span class="material-icons text-amber-600">warning</span>
    <span class="flex-1">{{ t("collectionsView.dataIssuesDetected", { count }) }}</span>
    <button
      type="button"
      class="h-8 px-2.5 flex items-center gap-1 rounded border border-amber-300 bg-white hover:bg-amber-100 text-amber-700 font-bold text-xs transition-colors"
      data-testid="collections-repair"
      @click="emit('repair')"
    >
      <span class="material-icons text-sm">build</span>
      <span>{{ t("collectionsView.repair") }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useCollectionI18n } from "../lang";

defineProps<{
  /** Number of flagged record files, shown in the banner message. */
  count: number;
}>();

const emit = defineEmits<{
  repair: [];
}>();

const { t } = useCollectionI18n();
</script>
