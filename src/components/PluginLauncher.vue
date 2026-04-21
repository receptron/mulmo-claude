<template>
  <div ref="rootRef" class="flex border border-gray-300 rounded overflow-hidden text-xs" data-testid="plugin-launcher">
    <template v-for="(target, idx) in TARGETS" :key="target.key">
      <!-- Visual separator between data plugins and management plugins -->
      <div v-if="idx === SEPARATOR_AFTER_INDEX" class="w-px bg-gray-300 my-0.5" />
      <button
        :class="[
          'px-2.5 py-1 flex items-center gap-1 border-r border-gray-200 last:border-r-0 transition-colors',
          isActive(target) ? 'bg-blue-50 text-blue-600 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50',
        ]"
        :title="target.title"
        :data-testid="`plugin-launcher-${target.key}`"
        @click="emit('navigate', target)"
      >
        <span class="material-icons text-sm">{{ target.icon }}</span>
        <span v-if="!compact">{{ target.label }}</span>
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

// Quick-access toolbar sitting above the canvas. Each button
// switches the canvas to a dedicated view mode via URL
// (?view=todos, ?view=wiki, etc.). The "invoke" kind is kept in
// the union for future use but currently all targets use "view".
//
// First slice of issue #253. The list of targets is declared here so
// the launcher can be swapped for a customisable per-role palette
// later without touching the App.vue wiring.

const props = defineProps<{
  /** Current canvas view mode — the matching button lights up. */
  activeViewMode?: string | null;
}>();

export type PluginLauncherKind = "view"; // Switch the canvas to a dedicated view mode

export interface PluginLauncherTarget {
  /** Stable key for testid + dispatch in App.vue. */
  key: "todos" | "scheduler" | "skills" | "wiki" | "roles" | "files";
  kind: PluginLauncherKind;
  /** Material-icons glyph. */
  icon: string;
  /** Visible label next to the icon. */
  label: string;
  /** Tooltip on hover. */
  title: string;
}

const TARGETS: PluginLauncherTarget[] = [
  // ─── Data plugins ───
  {
    key: "todos",
    kind: "view",
    icon: "checklist",
    label: "Todos",
    title: "Open todos (⌘4)",
  },
  {
    key: "scheduler",
    kind: "view",
    icon: "event",
    label: "Schedule",
    title: "Open schedule (⌘5)",
  },
  {
    key: "wiki",
    kind: "view",
    icon: "menu_book",
    label: "Wiki",
    title: "Open wiki (⌘6)",
  },
  // ─── Management / navigation ───
  {
    key: "skills",
    kind: "view",
    icon: "psychology",
    label: "Skills",
    title: "Open skills (⌘7)",
  },
  {
    key: "roles",
    kind: "view",
    icon: "manage_accounts",
    label: "Roles",
    title: "Open roles (⌘8)",
  },
  {
    key: "files",
    kind: "view",
    icon: "folder",
    label: "Files",
    title: "Open workspace files (⌘3)",
  },
];

// Index AFTER which the visual separator is inserted (between wiki
// and skills — data plugins on the left, management on the right).
const SEPARATOR_AFTER_INDEX = 3;

function isActive(target: PluginLauncherTarget): boolean {
  return props.activeViewMode === target.key;
}

const emit = defineEmits<{
  navigate: [target: PluginLauncherTarget];
}>();

// Compact mode (icons only) kicks in when the toolbar's parent row
// is narrower than this threshold. Tuned against the six labelled
// buttons + the canvas-view toggle sharing one row.
const COMPACT_BREAKPOINT_PX = 640;

const rootRef = ref<HTMLElement | null>(null);
const compact = ref(false);
let observer: ResizeObserver | null = null;

onMounted(() => {
  const parent = rootRef.value?.parentElement;
  if (!parent) return;
  const update = (width: number) => {
    compact.value = width < COMPACT_BREAKPOINT_PX;
  };
  update(parent.clientWidth);
  observer = new ResizeObserver((entries) => {
    for (const entry of entries) update(entry.contentRect.width);
  });
  observer.observe(parent);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});
</script>
