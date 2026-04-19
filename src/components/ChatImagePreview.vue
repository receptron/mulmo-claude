<template>
  <div
    data-testid="chat-image-preview"
    class="relative inline-block border border-gray-300 rounded overflow-hidden"
  >
    <img
      :src="src"
      alt="Attached image"
      class="max-h-20 max-w-40 object-contain"
    />
    <button
      data-testid="chat-image-remove"
      class="absolute top-0 right-0 bg-black/60 text-white rounded-bl px-1 text-xs leading-tight hover:bg-black/80"
      @click="emit('remove')"
    >
      ✕
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ src: string }>();
const emit = defineEmits<{ remove: [] }>();
</script>
