<template>
  <SourcesManager mode="plugin" :initial-data="props.selectedResult.data ?? null" />
</template>

<script setup lang="ts">
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ManageSourceData } from "./index";
import SourcesManager from "../../components/SourcesManager.vue";

const props = defineProps<{
  selectedResult: ToolResultComplete<ManageSourceData>;
}>();
</script>
