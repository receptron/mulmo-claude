<template>
  <!-- Copies the current chat session to the clipboard as Markdown.
       Lives in both <SessionSidebar> (single layout) and <StackView>
       (stack layout) so the affordance is in the same visual slot
       regardless of which layout the user is in.

       Success feedback is local: the icon swaps to a check for ~1.5s.
       No global toast composable yet (#TODO once one exists), and a
       transient icon swap is enough since the user's hand is already
       on the button. -->
  <button
    type="button"
    class="h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    :class="{ '!text-green-600': justCopied }"
    data-testid="copy-chat-md"
    :disabled="results.length === 0"
    :title="justCopied ? t('sidebarHeader.copiedMarkdown') : t('sidebarHeader.copyMarkdown')"
    :aria-label="justCopied ? t('sidebarHeader.copiedMarkdown') : t('sidebarHeader.copyMarkdown')"
    @click="onCopy"
  >
    <span class="material-icons text-lg" aria-hidden="true">{{ justCopied ? "check" : "content_copy" }}</span>
  </button>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { exportChatToMarkdown } from "../utils/chat/exportMarkdown";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

const COPIED_FEEDBACK_MS = 1500;

const { t } = useI18n();

const props = defineProps<{
  results: ToolResultComplete[];
  resultTimestamps: Map<string, number>;
  sessionRoleName?: string;
}>();

const justCopied = ref(false);
let resetTimeout: ReturnType<typeof setTimeout> | null = null;

async function readWorkspaceFile(path: string): Promise<string | null> {
  const result = await apiGet<{ content?: string }>(API_ROUTES.files.content, { path });
  if (!result.ok) return null;
  return result.data.content ?? null;
}

async function onCopy(): Promise<void> {
  const markdown = await exportChatToMarkdown(props.results, {
    sessionRoleName: props.sessionRoleName,
    resultTimestamps: props.resultTimestamps,
    readFile: readWorkspaceFile,
  });
  try {
    await navigator.clipboard.writeText(markdown);
    justCopied.value = true;
    if (resetTimeout !== null) clearTimeout(resetTimeout);
    resetTimeout = setTimeout(() => {
      justCopied.value = false;
      resetTimeout = null;
    }, COPIED_FEEDBACK_MS);
  } catch {
    // Clipboard write can reject when the document isn't focused or
    // permission is denied. The missing visual confirmation is itself
    // the user-facing signal; logging would only spam the console.
  }
}

onUnmounted(() => {
  if (resetTimeout !== null) clearTimeout(resetTimeout);
});
</script>
