<template>
  <!-- Standalone Calendar page (#758). Delegates to the shared
       SchedulerView with the tab locked to calendar and the tab bar
       hidden. Mounted by App.vue on route /calendar. -->
  <SchedulerView :force-tab="SCHEDULER_TAB.calendar" />
</template>

<script setup lang="ts">
import SchedulerView from "./View.vue";
import { SCHEDULER_TAB } from "./viewModes";
</script>
