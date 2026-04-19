<template>
  <div
    data-testid="chat-attachment-preview"
    class="relative inline-flex items-center gap-2 border border-gray-300 rounded overflow-hidden px-2 py-1"
  >
    <img
      v-if="isImage"
      :src="dataUrl"
      alt="Attached image"
      class="max-h-20 max-w-40 object-contain"
    />
    <div v-else class="flex items-center gap-1.5 text-xs text-gray-700">
      <span class="material-icons text-base" :class="iconColor">{{
        icon
      }}</span>
      <span class="max-w-40 truncate">{{ filename || "attachment" }}</span>
    </div>
    <button
      data-testid="chat-attachment-remove"
      class="absolute top-0 right-0 bg-black/60 text-white rounded-bl px-1 text-xs leading-tight hover:bg-black/80"
      @click="emit('remove')"
    >
      ✕
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  dataUrl: string;
  filename: string;
  mime: string;
}>();
const emit = defineEmits<{ remove: [] }>();

const isImage = computed(() => props.mime.startsWith("image/"));

const icon = computed(() => {
  if (props.mime === "application/pdf") return "picture_as_pdf";
  if (props.mime.includes("wordprocessingml")) return "description";
  if (props.mime.includes("spreadsheetml")) return "table_chart";
  if (props.mime.includes("presentationml")) return "slideshow";
  return "insert_drive_file";
});

const iconColor = computed(() => {
  if (props.mime === "application/pdf") return "text-red-500";
  if (props.mime.includes("wordprocessingml")) return "text-blue-500";
  if (props.mime.includes("spreadsheetml")) return "text-green-600";
  if (props.mime.includes("presentationml")) return "text-orange-500";
  return "text-gray-500";
});
</script>
