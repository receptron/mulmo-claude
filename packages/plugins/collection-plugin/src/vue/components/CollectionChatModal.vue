<template>
  <!-- Chat modal — collect a message and start a new general-role chat
       seeded with the collection's skill command (`/<slug> <message>`). -->
  <div
    class="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 transition-all duration-300"
    role="dialog"
    aria-modal="true"
    aria-labelledby="collections-chat-title"
    data-testid="collections-chat-modal"
    @click.self="emit('close')"
    @keydown.esc="emit('close')"
  >
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col border border-slate-200 overflow-hidden">
      <header class="px-6 py-4 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
        <div class="h-9 w-9 flex items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100/50">
          <span class="material-icons text-lg">forum</span>
        </div>
        <div class="flex-1">
          <h2 id="collections-chat-title" class="text-sm font-bold text-slate-800 uppercase tracking-wide">{{ t("collectionsView.chatTitle") }}</h2>
          <span class="text-xs text-slate-400 font-semibold">{{ collectionTitle }}</span>
        </div>
        <button
          type="button"
          class="h-8 w-8 flex items-center justify-center rounded text-slate-400 hover:bg-slate-200/50 hover:text-slate-600 transition-colors"
          :aria-label="t('common.close')"
          data-testid="collections-chat-close"
          @click="emit('close')"
        >
          <span class="material-icons text-lg">close</span>
        </button>
      </header>

      <div class="px-6 py-5">
        <textarea
          ref="inputEl"
          v-model="message"
          rows="4"
          :placeholder="t('collectionsView.chatPlaceholder')"
          class="w-full bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all resize-none"
          data-testid="collections-chat-input"
          @keydown.meta.enter="submit"
          @keydown.ctrl.enter="submit"
        ></textarea>
      </div>

      <footer class="px-6 py-3.5 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50/50">
        <button
          type="button"
          class="h-8 px-2.5 rounded text-xs font-bold text-slate-500 hover:bg-slate-200/50 transition-colors"
          data-testid="collections-chat-cancel"
          @click="emit('close')"
        >
          {{ t("common.cancel") }}
        </button>
        <button
          type="button"
          class="h-8 px-2.5 rounded bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-sm shadow-indigo-600/10"
          :disabled="!message.trim()"
          data-testid="collections-chat-send"
          @click="submit"
        >
          {{ t("collectionsView.chatStart") }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useCollectionI18n } from "../lang";

defineProps<{
  /** Title of the collection this chat is scoped to (header subtitle). */
  collectionTitle: string;
}>();

const emit = defineEmits<{
  close: [];
  /** Raw textarea text; the parent trims it and builds the seed. */
  submit: [message: string];
}>();

const { t } = useCollectionI18n();

// Owned here so a fresh open (the parent's `v-if` remounts this) always
// starts with a blank draft and a focused input — no parent-side reset.
const message = ref("");
const inputEl = ref<HTMLTextAreaElement | null>(null);

onMounted(() => inputEl.value?.focus());

function submit(): void {
  if (!message.value.trim()) return;
  emit("submit", message.value);
}
</script>
