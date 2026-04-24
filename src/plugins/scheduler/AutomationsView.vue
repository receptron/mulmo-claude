<template>
  <!-- Standalone Automations page (#758). Surfaces the scheduler's
       Tasks tab as a peer page to Calendar. Same delegation pattern
       as CalendarView: forces the tab, hides the bar. The underlying
       TasksTab renders user-registered cron/interval/daily tasks,
       skill-scheduled runs, and source-watcher pipeline runs — i.e.
       every task the task-manager knows about. -->
  <SchedulerView :force-tab="SCHEDULER_TAB.tasks" />
</template>

<script setup lang="ts">
import SchedulerView from "./View.vue";
import { SCHEDULER_TAB } from "./viewModes";
</script>
