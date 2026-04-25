<script setup lang="ts">
defineProps<{
  active: boolean;
  label: string;
  count?: number;
}>();
defineEmits<{ click: [] }>();
</script>

<template>
  <button
    type="button"
    :aria-pressed="active"
    :class="[
      'inline-flex items-center px-2 py-0.5 text-xs leading-4 rounded-full border transition-colors cursor-pointer',
      active ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200',
    ]"
    @click="$emit('click')"
  >
    {{ label }}<template v-if="count !== undefined"> ({{ count }})</template>
  </button>
</template>
