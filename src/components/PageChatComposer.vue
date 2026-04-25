<template>
  <div class="border-t border-gray-200 px-4 py-3 shrink-0 bg-gray-50">
    <div class="flex gap-2">
      <textarea
        v-model="draft"
        :data-testid="`${testIdPrefix}-input`"
        :placeholder="placeholder"
        rows="2"
        class="flex-1 bg-white border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-none"
        @compositionstart="imeEnter.onCompositionStart"
        @compositionend="imeEnter.onCompositionEnd"
        @keydown="imeEnter.onKeydown"
        @blur="imeEnter.onBlur"
      />
      <button
        :data-testid="`${testIdPrefix}-send`"
        class="bg-blue-600 hover:bg-blue-700 text-white rounded w-8 h-8 flex items-center justify-center shrink-0 disabled:opacity-50 disabled:cursor-not-allowed self-start"
        :title="t('common.sendChat')"
        :disabled="!canSend"
        @click="submit"
      >
        <span class="material-icons text-base leading-none">send</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAppApi } from "../composables/useAppApi";
import { useImeAwareEnter } from "../composables/useImeAwareEnter";

const props = withDefaults(
  defineProps<{
    placeholder: string;
    prependText: string;
    disabled?: boolean;
    testIdPrefix?: string;
    allowEmpty?: boolean;
  }>(),
  { disabled: false, testIdPrefix: "page-chat", allowEmpty: false },
);

const { t } = useI18n();
const appApi = useAppApi();
const draft = ref("");

const canSend = computed(() => !props.disabled && (props.allowEmpty || draft.value.trim().length > 0));

function submit() {
  if (props.disabled) return;
  const text = draft.value.trim();
  if (!text && !props.allowEmpty) return;
  const prompt = text ? `${props.prependText}\n\n${text}` : props.prependText;
  draft.value = "";
  appApi.startNewChat(prompt);
}

const imeEnter = useImeAwareEnter(submit);
</script>
