<template>
  <!-- Shared role + origin glyph used by SessionTabBar and
       SessionHistoryPanel. Visual rules:
       - Running → yellow with a slow spin (the one place we keep
         colour because the state is load-bearing)
       - Unread (not running) → darker gray so the row reads as
         "something to look at"
       - Default → light gray
       - Origin (scheduler / skill / bridge) → tiny B&W badge on the
         top-right. Human / unknown origin → no badge. -->
  <span class="relative shrink-0 inline-flex items-center leading-none">
    <span class="material-icons leading-none" :class="[iconSizeClass, stateClass, spinClass]">{{ glyph }}</span>
    <span
      v-if="originGlyph"
      role="img"
      class="absolute -top-[3px] -right-[5px] w-3.5 h-3.5 rounded-full bg-white ring-1 ring-gray-300 flex items-center justify-center"
      :title="originTooltip"
      :aria-label="originTooltip"
    >
      <span class="material-icons !text-[10px] leading-none text-gray-500" aria-hidden="true">{{ originGlyph }}</span>
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { Role } from "../config/roles";
import { SESSION_ORIGINS, type SessionSummary } from "../types/session";
import { roleIcon } from "../utils/role/icon";

const { t } = useI18n();

interface Props {
  session: SessionSummary;
  roles: Role[];
  // `base` matches the SessionTabBar tab glyph; `sm` matches the
  // compact metadata line in SessionHistoryPanel. Adjust only the
  // role icon itself — the origin badge stays the same size so it
  // remains legible at both densities.
  size?: "base" | "sm";
}

const props = withDefaults(defineProps<Props>(), { size: "base" });

const iconSizeClass = computed(() => (props.size === "sm" ? "text-sm" : "text-base"));

const stateClass = computed(() => {
  if (props.session.isRunning) return "text-yellow-400";
  if (props.session.hasUnread) return "text-gray-900";
  return "text-gray-400";
});

const spinClass = computed(() => (props.session.isRunning ? "animate-spin [animation-duration:3s]" : ""));

const glyph = computed(() => roleIcon(props.roles, props.session.roleId));

const originGlyph = computed(() => {
  const origin = props.session.origin;
  if (!origin || origin === SESSION_ORIGINS.human) return "";
  if (origin === SESSION_ORIGINS.scheduler) return "schedule";
  if (origin === SESSION_ORIGINS.skill) return "build";
  if (origin === SESSION_ORIGINS.bridge) return "sync_alt";
  return "";
});

const originTooltip = computed(() => {
  const origin = props.session.origin;
  if (!origin || origin === SESSION_ORIGINS.human) return "";
  return t(`sessionTabBar.origin.${origin}`);
});
</script>
