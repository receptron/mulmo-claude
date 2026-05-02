<template>
  <!-- One row in the AccountsModal list. Read-only display +
       Edit / Deactivate (or Reactivate) buttons. The editor itself
       is AccountEditor.vue, mounted in place of this row by the
       parent when editing. -->
  <div
    :class="['flex items-center gap-2 px-2 py-2 text-sm border-b border-gray-100', inactive ? 'opacity-60' : '']"
    :data-testid="`accounting-accounts-row-${account.code}`"
  >
    <span class="font-mono text-xs text-gray-500 w-16 shrink-0">{{ account.code }}</span>
    <span :class="['grow min-w-0 truncate', inactive ? 'italic' : '']">{{ account.name }}</span>
    <span
      v-if="inactive"
      class="text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 shrink-0"
      :data-testid="`accounting-accounts-inactive-${account.code}`"
    >
      {{ t("pluginAccounting.accounts.inactiveBadge") }}
    </span>
    <span v-if="account.note" class="text-xs text-gray-400 truncate max-w-[8rem]" :title="account.note">{{ account.note }}</span>
    <button
      type="button"
      class="h-8 px-2.5 rounded text-sm text-blue-600 hover:bg-blue-50"
      :data-testid="`accounting-accounts-edit-${account.code}`"
      @click="emit('edit')"
    >
      {{ t("pluginAccounting.accounts.edit") }}
    </button>
    <button
      type="button"
      :class="['h-8 px-2.5 rounded text-sm', inactive ? 'text-green-600 hover:bg-green-50' : 'text-amber-600 hover:bg-amber-50']"
      :data-testid="`accounting-accounts-toggle-${account.code}`"
      @click="emit('toggleActive')"
    >
      {{ inactive ? t("pluginAccounting.accounts.reactivate") : t("pluginAccounting.accounts.deactivate") }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { Account } from "../api";

const { t } = useI18n();

const props = defineProps<{ account: Account }>();
const emit = defineEmits<{ edit: []; toggleActive: [] }>();

const inactive = computed(() => props.account.active === false);
</script>
