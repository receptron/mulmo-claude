<template>
  <div class="text-sm">
    <div class="flex items-center gap-1 font-medium text-gray-700 mb-1">
      <span class="material-icons" style="font-size: 14px">auto_awesome</span>
      <span>{{ skills.length }} skill{{ skills.length !== 1 ? "s" : "" }}</span>
    </div>
    <div
      v-for="skill in skills.slice(0, 6)"
      :key="skill.name"
      class="text-xs text-gray-600 truncate"
    >
      {{ skill.name }}
    </div>
    <div v-if="skills.length > 6" class="text-xs text-gray-400 italic">
      +{{ skills.length - 6 }} more
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ManageSkillsData } from "./index";

const props = defineProps<{ result: ToolResultComplete<ManageSkillsData> }>();
const skills = computed(() => props.result.data?.skills ?? []);
</script>
