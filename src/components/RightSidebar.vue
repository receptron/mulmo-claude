<template>
  <div class="w-80 flex-shrink-0 border-l border-gray-200 flex flex-col bg-white text-gray-900">
    <div ref="historyContainer" class="flex-1 overflow-y-auto min-h-0">
      <div v-if="permalink" class="bg-white border-b border-gray-200 p-4 space-y-2">
        <span id="permalink-label" class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ t("rightSidebar.permalink") }}</span>
        <div class="flex items-center gap-2">
          <input
            :value="permalink"
            readonly
            class="flex-1 min-w-0 text-xs font-mono bg-gray-50 border border-gray-200 rounded px-2 py-1 text-gray-700"
            data-testid="permalink-input"
            aria-labelledby="permalink-label"
            @focus="selectAllOnFocus"
          />
          <button
            type="button"
            class="h-8 w-8 flex-shrink-0 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            :class="{ '!text-green-600': permalinkCopied }"
            data-testid="copy-permalink"
            :title="permalinkCopied ? t('rightSidebar.copiedPermalink') : t('rightSidebar.copyPermalink')"
            :aria-label="permalinkCopied ? t('rightSidebar.copiedPermalink') : t('rightSidebar.copyPermalink')"
            @click="onCopyPermalink"
          >
            <span class="material-icons text-lg" aria-hidden="true">{{ permalinkCopied ? "check" : "content_copy" }}</span>
          </button>
        </div>
      </div>

      <div class="bg-white border-b border-gray-200">
        <button
          class="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50"
          :title="t('rightSidebar.toggleSystemPrompt')"
          @click="showSystemPrompt = !showSystemPrompt"
        >
          <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ t("rightSidebar.systemPrompt") }}</span>
          <span class="text-gray-400 text-xs">{{ showSystemPrompt ? "▲" : "▼" }}</span>
        </button>
        <div v-if="showSystemPrompt" class="px-4 pb-4">
          <div class="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">
            {{ rolePrompt }}
          </div>
        </div>
      </div>

      <div class="bg-white border-b border-gray-200">
        <div class="p-4 pb-0">
          <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ t("rightSidebar.availableTools") }}</span>
        </div>
        <div class="px-4 py-3 space-y-1">
          <div v-for="tool in availableTools" :key="tool" class="text-xs">
            <button class="flex items-center gap-1 w-full text-left" :title="t('rightSidebar.toggleToolDescription')" @click="toggleTool(tool)">
              <span class="bg-gray-100 text-gray-700 rounded px-2 py-0.5 border border-gray-200 font-mono">{{ tool }}</span>
              <span v-if="toolDescriptions[tool]" class="text-gray-400">{{ expandedTools.has(tool) ? "▲" : "▼" }}</span>
            </button>
            <div v-if="toolDescriptions[tool] && expandedTools.has(tool)" class="text-gray-500 mt-0.5 pl-1 leading-snug whitespace-pre-wrap">
              {{ toolDescriptions[tool] }}
            </div>
          </div>
        </div>
      </div>

      <div class="p-4 border-b border-gray-200 bg-white flex items-center justify-between gap-2">
        <h2 class="text-lg font-semibold">{{ t("rightSidebar.toolCallHistory") }}</h2>
        <button
          type="button"
          class="h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          :class="{ '!text-green-600': copied }"
          data-testid="copy-tool-call-history"
          :disabled="toolCallHistory.length === 0"
          :title="copied ? t('rightSidebar.copiedHistory') : t('rightSidebar.copyHistory')"
          :aria-label="copied ? t('rightSidebar.copiedHistory') : t('rightSidebar.copyHistory')"
          @click="onCopyHistory"
        >
          <span class="material-icons text-lg" aria-hidden="true">{{ copied ? "check" : "content_copy" }}</span>
        </button>
      </div>

      <div class="p-2 space-y-2 bg-gray-100">
        <div v-if="toolCallHistory.length === 0" class="text-gray-400 text-sm text-center py-4">{{ t("rightSidebar.noToolCalls") }}</div>
        <div v-for="(call, index) in toolCallHistory" :key="index" class="border border-gray-300 rounded p-3 bg-white text-xs space-y-1">
          <div class="flex justify-between items-start gap-2">
            <span class="font-semibold text-blue-600 break-all">{{ call.toolName }}</span>
            <span class="text-gray-400 flex-shrink-0">{{ formatTime(call.timestamp) }}</span>
          </div>
          <div>
            <div class="font-medium text-gray-500 mb-1">{{ t("rightSidebar.arguments") }}</div>
            <pre class="bg-gray-50 p-2 rounded overflow-x-auto text-gray-700">{{ formatJson(call.args) }}</pre>
          </div>
          <div v-if="call.error">
            <div class="font-medium text-gray-500 mb-1">{{ t("rightSidebar.error") }}</div>
            <div class="bg-red-50 p-2 rounded text-red-700">
              {{ call.error }}
            </div>
            <!--
              Catalog-derived hint chip for MCP tool errors (#1354).
              Shown only when `mcpHint` was attached at event-dispatch
              time (= the failing tool's server is in the catalog).
              Non-MCP / custom-server errors fall through to the plain
              red chip above.
            -->
            <div v-if="call.mcpHint" class="mt-2 bg-amber-50 border border-amber-200 p-2 rounded text-amber-900">
              <div class="font-medium mb-1">{{ t("rightSidebar.mcpHint.title", { server: t(call.mcpHint.displayNameKey) }) }}</div>
              <div v-if="call.mcpHint.requiredKeys.length > 0" class="text-xs mb-1">
                {{ t("rightSidebar.mcpHint.requiredKeys") }}:
                <code class="bg-amber-100 px-1 rounded">{{ call.mcpHint.requiredKeys.join(", ") }}</code>
              </div>
              <div v-if="call.mcpHint.setupGuideUrl" class="text-xs">
                <a :href="call.mcpHint.setupGuideUrl" target="_blank" rel="noopener noreferrer" class="underline text-amber-800 hover:text-amber-900">{{
                  t("rightSidebar.mcpHint.setupGuide")
                }}</a>
              </div>
            </div>
          </div>
          <div v-else-if="call.result !== undefined">
            <div class="font-medium text-gray-500 mb-1">{{ t("rightSidebar.result") }}</div>
            <pre class="bg-green-50 p-2 rounded overflow-x-auto text-gray-700">{{ call.result }}</pre>
          </div>
          <div v-else>
            <div class="text-gray-400 italic">{{ t("rightSidebar.running") }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolCallHistoryItem } from "../types/toolCallHistory";
import { formatTime } from "../utils/format/date";
import { buildMessagePermalink } from "../utils/chat/permalink";
import { useClipboardCopy } from "@mulmoclaude/core/plugin-vue";

const { t } = useI18n();

const props = defineProps<{
  toolCallHistory: ToolCallHistoryItem[];
  availableTools: string[];
  rolePrompt: string;
  toolDescriptions: Record<string, string>;
  sessionId: string | null;
  selectedResultUuid: string | null;
}>();

const { copied, copy } = useClipboardCopy();

// Permalink to the currently-selected message. Build via the pure
// helper so the URL shape stays unit-testable; the section hides
// entirely when the helper returns null (no session or no selection).
const permalink = computed<string | null>(() => buildMessagePermalink(window.location.origin, props.sessionId, props.selectedResultUuid));

const { copied: permalinkCopied, copy: copyPermalink } = useClipboardCopy();

// Reset the "Copied" indicator when the permalink target changes —
// otherwise the checkmark sticks around after the user clicks a
// different message and misleadingly suggests the new URL is what
// landed on the clipboard.
watch(permalink, () => {
  permalinkCopied.value = false;
});

async function onCopyPermalink(): Promise<void> {
  if (permalink.value) await copyPermalink(permalink.value);
}

function selectAllOnFocus(event: FocusEvent): void {
  const { target } = event;
  if (target instanceof HTMLInputElement) target.select();
}

async function onCopyHistory(): Promise<void> {
  await copy(formatJson(props.toolCallHistory));
}

const showSystemPrompt = ref(false);
const expandedTools = ref(new Set<string>());
const historyContainer = ref<HTMLDivElement | null>(null);

function toggleTool(tool: string): void {
  if (expandedTools.value.has(tool)) {
    expandedTools.value.delete(tool);
  } else {
    expandedTools.value.add(tool);
  }
  expandedTools.value = new Set(expandedTools.value);
}

function formatJson(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function scrollToBottom(): void {
  nextTick(() => {
    if (historyContainer.value) {
      historyContainer.value.scrollTop = historyContainer.value.scrollHeight;
    }
  });
}

defineExpose({ scrollToBottom });
</script>
