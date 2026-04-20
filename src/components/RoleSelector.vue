<template>
  <div class="p-4 border-b border-gray-200 flex items-center gap-2 relative">
    <span class="text-sm text-gray-500 shrink-0">Role</span>
    <button
      ref="button"
      class="flex-1 flex items-center gap-2 bg-white border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 text-left"
      data-testid="role-selector-btn"
      @click="open = !open"
    >
      <span class="material-icons text-base text-gray-500">{{
        roleIcon(roles, currentRoleId)
      }}</span>
      <span class="flex-1 truncate">{{ currentRoleName }}</span>
      <span class="material-icons text-sm text-gray-400">expand_more</span>
    </button>
    <div
      v-if="open"
      ref="dropdown"
      class="absolute left-4 right-4 top-full z-50 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
    >
      <button
        v-for="role in roles"
        :key="role.id"
        :data-testid="`role-option-${role.id}`"
        class="w-full flex items-center gap-1.5 px-3 py-1 text-sm text-gray-900 hover:bg-gray-50 text-left"
        @click="selectRole(role.id)"
      >
        <span class="material-icons text-base text-gray-400">{{
          roleIcon(roles, role.id)
        }}</span>
        {{ role.name }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { Role } from "../config/roles";
import { roleIcon, roleName } from "../utils/role/icon";
import { useClickOutside } from "../composables/useClickOutside";

const props = defineProps<{
  roles: Role[];
  currentRoleId: string;
}>();

const emit = defineEmits<{
  "update:currentRoleId": [id: string];
  change: [];
}>();

const open = ref(false);
const button = ref<HTMLButtonElement | null>(null);
const dropdown = ref<HTMLDivElement | null>(null);

const currentRoleName = computed(() =>
  roleName(props.roles, props.currentRoleId),
);

function selectRole(id: string): void {
  emit("update:currentRoleId", id);
  open.value = false;
  emit("change");
}

const { handler } = useClickOutside({
  isOpen: open,
  buttonRef: button,
  popupRef: dropdown,
});

onMounted(() => document.addEventListener("mousedown", handler));
onBeforeUnmount(() => document.removeEventListener("mousedown", handler));
</script>
