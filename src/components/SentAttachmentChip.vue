<template>
  <img v-if="isImage" :src="rawUrl" :alt="basename" :title="basename" :class="imgClass" data-testid="sent-attachment-chip" :data-variant="variant" />
  <div v-else :title="basename" :class="fileChipClass" data-testid="sent-attachment-chip" :data-variant="variant">
    <span class="material-icons" :class="[iconColor, fileIconSize]">{{ icon }}</span>
    <span class="truncate">{{ basename }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { API_ROUTES } from "../config/apiRoutes";

// "thumb" — small, used by the sidebar Preview (single-mode chat list).
// "block" — fills the canvas content width, used by the in-bubble
// View on the canvas (stack and single mode).
type Variant = "thumb" | "block";

const props = withDefaults(
  defineProps<{
    /** Workspace-relative path (e.g. `data/attachments/2026/04/<id>.png`). */
    path: string;
    variant?: Variant;
  }>(),
  { variant: "thumb" },
);

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

const ext = computed(() => {
  const dot = props.path.lastIndexOf(".");
  return dot >= 0 ? props.path.slice(dot).toLowerCase() : "";
});

const basename = computed(() => {
  const slash = props.path.lastIndexOf("/");
  return slash >= 0 ? props.path.slice(slash + 1) : props.path;
});

const isImage = computed(() => IMAGE_EXTS.has(ext.value));

// `/api/files/raw` is auth-exempt for `<img src>` use (see
// server/index.ts:114) so the path round-trips without a bearer token.
const rawUrl = computed(() => `${API_ROUTES.files.raw}?path=${encodeURIComponent(props.path)}`);

const imgClass = computed(() =>
  props.variant === "block"
    ? // Canvas: stretch to the bubble's content width, cap height so
      // tall images don't dominate. `object-contain` preserves aspect
      // ratio when the natural ratio would push past max-h.
      "block w-full max-h-[60vh] object-contain rounded-lg border border-gray-200 bg-gray-50"
    : // Sidebar preview: small thumbnail.
      "block max-h-16 max-w-24 object-contain rounded border border-gray-300 bg-white",
);

const fileChipClass = computed(() => {
  const base = "inline-flex items-center gap-1.5 border border-gray-300 bg-white rounded text-gray-700";
  return props.variant === "block" ? `${base} px-3 py-2 text-sm max-w-full` : `${base} px-2 py-1 text-xs`;
});

const fileIconSize = computed(() => (props.variant === "block" ? "text-xl" : "text-base"));

const icon = computed(() => {
  switch (ext.value) {
    case ".pdf":
      return "picture_as_pdf";
    case ".docx":
      return "description";
    case ".xlsx":
    case ".csv":
      return "table_chart";
    case ".pptx":
      return "slideshow";
    case ".txt":
    case ".md":
      return "article";
    case ".json":
    case ".xml":
    case ".yaml":
    case ".yml":
    case ".toml":
      return "data_object";
    default:
      return "insert_drive_file";
  }
});

const iconColor = computed(() => {
  switch (ext.value) {
    case ".pdf":
      return "text-red-500";
    case ".docx":
      return "text-blue-500";
    case ".xlsx":
    case ".csv":
      return "text-green-600";
    case ".pptx":
      return "text-orange-500";
    default:
      return "text-gray-500";
  }
});
</script>
