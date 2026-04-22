<template>
  <div class="p-2 text-sm">
    <div class="flex items-center gap-1 font-medium text-gray-700 mb-1">
      <span class="material-icons" style="font-size: 14px">auto_awesome</span>
      <span>{{ t("pluginManageSkills.previewCount", skills.length, { named: { count: skills.length } }) }}</span>
    </div>
    <div v-for="skill in skills.slice(0, 6)" :key="skill.name" class="text-xs text-gray-600 truncate">
      {{ skill.name }}
    </div>
    <div v-if="skills.length > 6" class="text-xs text-gray-400 italic">
      {{ t("pluginManageSkills.previewMore", { count: skills.length - 6 }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ManageSkillsData } from "./index";

const { t } = useI18n();

const props = defineProps<{ result: ToolResultComplete<ManageSkillsData> }>();
const skills = computed(() => props.result.data?.skills ?? []);
</script>
