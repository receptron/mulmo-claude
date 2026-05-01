<template>
  <div class="flex flex-col gap-4" data-testid="accounting-settings">
    <section class="border border-gray-200 rounded p-3 flex flex-col gap-2">
      <h4 class="text-sm font-semibold">{{ t("pluginAccounting.settings.rebuild") }}</h4>
      <p class="text-xs text-gray-500">{{ t("pluginAccounting.settings.rebuildExplain") }}</p>
      <p v-if="rebuildOk" class="text-xs text-green-600" data-testid="accounting-settings-rebuild-ok">{{ rebuildOk }}</p>
      <p v-if="rebuildError" class="text-xs text-red-500" data-testid="accounting-settings-rebuild-error">{{ rebuildError }}</p>
      <div>
        <button
          class="h-8 px-3 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50"
          :disabled="rebuilding"
          data-testid="accounting-settings-rebuild"
          @click="onRebuild"
        >
          {{ rebuilding ? t("pluginAccounting.common.loading") : t("pluginAccounting.settings.rebuild") }}
        </button>
      </div>
    </section>
    <section class="border border-red-300 rounded p-3 flex flex-col gap-2">
      <h4 class="text-sm font-semibold text-red-700">{{ t("pluginAccounting.settings.deleteBook") }}</h4>
      <p class="text-xs text-gray-500">{{ t("pluginAccounting.settings.deleteBookExplain") }}</p>
      <p v-if="deleteError" class="text-xs text-red-500" data-testid="accounting-settings-delete-error">{{ deleteError }}</p>
      <p v-if="isLastBook" class="text-xs text-gray-500" data-testid="accounting-settings-delete-blocked">
        {{ t("pluginAccounting.settings.cannotDeleteLastBook") }}
      </p>
      <template v-else>
        <label class="text-xs text-gray-500 flex flex-col gap-1">
          {{ t("pluginAccounting.settings.deleteBookConfirm", { bookName: bookName }) }}
          <input v-model="confirmName" class="h-8 px-2 rounded border border-gray-300 text-sm" data-testid="accounting-settings-delete-confirm" />
        </label>
        <div>
          <button
            class="h-8 px-3 rounded bg-red-600 hover:bg-red-700 text-white text-sm disabled:opacity-50"
            :disabled="confirmName !== bookName || deleting"
            data-testid="accounting-settings-delete"
            @click="onDelete"
          >
            {{ deleting ? t("pluginAccounting.common.loading") : t("pluginAccounting.settings.deleteBookButton") }}
          </button>
        </div>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { deleteBook, rebuildSnapshots } from "../api";

const { t } = useI18n();

const props = defineProps<{ bookId: string; bookName: string; isLastBook: boolean }>();
const emit = defineEmits<{ deleted: []; "books-changed": [] }>();

const rebuilding = ref(false);
const rebuildOk = ref<string | null>(null);
const rebuildError = ref<string | null>(null);
const deleting = ref(false);
const deleteError = ref<string | null>(null);
const confirmName = ref("");

async function onRebuild(): Promise<void> {
  rebuilding.value = true;
  rebuildOk.value = null;
  rebuildError.value = null;
  try {
    const result = await rebuildSnapshots(props.bookId);
    if (!result.ok) {
      rebuildError.value = result.error;
      return;
    }
    rebuildOk.value = t("pluginAccounting.settings.rebuildOk", { count: result.data.rebuilt.length });
  } finally {
    rebuilding.value = false;
  }
}

async function onDelete(): Promise<void> {
  if (deleting.value) return;
  deleting.value = true;
  deleteError.value = null;
  try {
    const result = await deleteBook(props.bookId);
    if (!result.ok) {
      deleteError.value = result.error;
      return;
    }
    emit("deleted");
    emit("books-changed");
  } finally {
    deleting.value = false;
  }
}

// Reset feedback / confirmation when the user navigates between
// books while this tab is open.
watch(
  () => props.bookId,
  () => {
    rebuildOk.value = null;
    rebuildError.value = null;
    deleteError.value = null;
    confirmName.value = "";
  },
);
</script>
