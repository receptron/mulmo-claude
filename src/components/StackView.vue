<template>
  <div
    ref="containerRef"
    class="h-full overflow-y-auto bg-gray-50 p-4 space-y-3"
  >
    <div
      v-if="toolResults.length === 0"
      class="flex items-center justify-center h-full text-gray-400 text-sm"
    >
      No results yet
    </div>
    <div
      v-for="result in toolResults"
      :key="result.uuid"
      :ref="(el) => setItemRef(result.uuid, el as HTMLElement | null)"
      class="bg-white rounded-lg border transition-colors"
      :class="
        result.uuid === selectedResultUuid
          ? 'border-blue-400 ring-2 ring-blue-200'
          : 'border-gray-200'
      "
    >
      <button
        class="w-full flex items-center gap-2 px-3 py-2 border-b border-gray-100 text-left hover:bg-gray-50"
        :title="result.title || result.toolName"
        @click="emit('select', result.uuid)"
      >
        <span class="material-icons text-sm text-gray-400">{{
          iconFor(result.toolName)
        }}</span>
        <span class="text-sm font-medium text-gray-800 truncate">{{
          result.title || result.toolName
        }}</span>
        <span class="font-mono text-xs text-gray-400 ml-auto shrink-0">{{
          result.toolName
        }}</span>
      </button>
      <!-- text-response: render the message as Markdown via the
           underlying plugin View. The .stack-text-response class below
           collapses the plugin's own card chrome (outer p-6, inner
           rounded/border/shadow box, role header) so only the stack
           card's own border shows. -->
      <div v-if="isTextResponse(result)" class="stack-text-response">
        <TextResponseOriginalView :selected-result="result" />
      </div>
      <!-- Document-like plugins: let the content flow at its natural
           height by overriding the plugin's internal h-full / overflow
           / flex-1 via the .stack-natural scoped styles below. For
           plugins that embed iframes (e.g. presentHtml) we also size
           each iframe to its content after load. -->
      <div
        v-else-if="isStackNatural(result.toolName)"
        :ref="
          (el) => setNaturalWrapperRef(result.uuid, el as HTMLElement | null)
        "
        class="stack-natural"
      >
        <component
          :is="getPlugin(result.toolName)?.viewComponent"
          v-if="getPlugin(result.toolName)?.viewComponent"
          :selected-result="result"
          :send-text-message="sendTextMessage"
          @update-result="(r: ToolResultComplete) => emit('updateResult', r)"
        />
      </div>
      <!-- Other plugins: fixed height wrapper so plugins that rely on
           h-full continue to render properly. -->
      <div v-else :style="{ height: PLUGIN_HEIGHT }">
        <component
          :is="getPlugin(result.toolName)?.viewComponent"
          v-if="getPlugin(result.toolName)?.viewComponent"
          :selected-result="result"
          :send-text-message="sendTextMessage"
          @update-result="(r: ToolResultComplete) => emit('updateResult', r)"
        />
        <pre
          v-else
          class="h-full overflow-auto p-4 text-xs text-gray-500 whitespace-pre-wrap"
          >{{ JSON.stringify(result, null, 2) }}</pre
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from "vue";
import { getPlugin } from "../tools";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { View as TextResponseOriginalView } from "@gui-chat-plugin/text-response/vue";
import type { TextResponseData } from "@gui-chat-plugin/text-response";

// Most plugin viewComponents use h-full internally, so a defined parent
// height is required for them to render. text-response and the
// "stack-natural" plugins below are special-cased.
const PLUGIN_HEIGHT = "min(60vh, 560px)";

// How long to ignore scroll-spy after a programmatic scroll (sidebar
// click, auto-scroll on new result). Keeps the spy from emitting a
// stale uuid while the scroll is still settling.
const SCROLL_SPY_SUPPRESS_MS = 150;

// Plugins that look better flowing at natural height in stack view
// rather than being clipped to PLUGIN_HEIGHT with an inner scrollbar.
const STACK_NATURAL_TOOLS = new Set<string>([
  "presentHtml",
  "presentDocument",
  "presentSpreadsheet",
]);

function isStackNatural(toolName: string): boolean {
  return STACK_NATURAL_TOOLS.has(toolName);
}

const props = defineProps<{
  toolResults: ToolResultComplete[];
  selectedResultUuid: string | null;
  sendTextMessage?: (text: string) => void;
}>();

const emit = defineEmits<{
  select: [uuid: string];
  updateResult: [result: ToolResultComplete];
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const itemRefs = new Map<string, HTMLElement>();
const naturalWrapperRefs = new Map<string, HTMLElement>();

function setItemRef(uuid: string, el: HTMLElement | null): void {
  if (el) itemRefs.set(uuid, el);
  else itemRefs.delete(uuid);
}

function setNaturalWrapperRef(uuid: string, el: HTMLElement | null): void {
  if (el) {
    naturalWrapperRefs.set(uuid, el);
    nextTick(() => sizeIframesIn(el));
  } else {
    naturalWrapperRefs.delete(uuid);
  }
}

// Sandboxed iframes inside stack-natural plugins (e.g. presentHtml)
// have no intrinsic content height, so CSS alone collapses them. Set
// each iframe's height to match its document's scrollHeight on load.
function sizeIframesIn(wrapper: HTMLElement): void {
  const iframes = wrapper.querySelectorAll<HTMLIFrameElement>("iframe");
  for (const iframe of iframes) {
    if (iframe.dataset.stackSized === "true") continue;
    iframe.dataset.stackSized = "true";
    const resize = () => resizeOneIframe(iframe);
    iframe.addEventListener("load", resize);
    // If the iframe already finished loading before we attached the
    // listener, size it now as well.
    try {
      if (iframe.contentDocument?.readyState === "complete") {
        resize();
      }
    } catch {
      // cross-origin — leave default height
    }
  }
}

function resizeOneIframe(iframe: HTMLIFrameElement): void {
  try {
    const doc = iframe.contentDocument;
    if (!doc) return;
    const height = Math.max(
      doc.documentElement?.scrollHeight ?? 0,
      doc.body?.scrollHeight ?? 0,
    );
    if (height > 0) iframe.style.height = `${height}px`;
  } catch {
    // cross-origin sandbox — can't measure, leave default
  }
}

function isTextResponse(
  result: ToolResultComplete,
): result is ToolResultComplete<TextResponseData> {
  if (result.toolName !== "text-response") return false;
  const data = result.data;
  if (typeof data !== "object" || data === null) return false;
  if (!("text" in data)) return false;
  return typeof data.text === "string";
}

function iconFor(toolName: string): string {
  if (toolName === "text-response") return "chat";
  return "extension";
}

// Scroll-spy state: as the user scrolls the stack container we emit
// a `select` for whichever card currently occupies the top, so the
// sidebar selection always tracks what's on screen.
//
// Coordination between scroll and selection:
//   - `suppressScrollSync` is set while the component programmatically
//     scrolls (sidebar click → scrollIntoView, auto-scroll on new
//     result) so the spy doesn't fire on its own scroll.
//   - `scrollSpyEmittedUuid` holds the exact uuid the spy most
//     recently emitted. The watch on `selectedResultUuid` only skips
//     its scrollIntoView when the incoming uuid matches, so a
//     sidebar click that arrives right after a spy emit still gets
//     its normal scroll behaviour.
let suppressScrollSync = false;
let suppressScrollTimeout: ReturnType<typeof setTimeout> | null = null;
let scrollSpyRafId: number | null = null;
let scrollSpyEmittedUuid: string | null = null;

function beginSuppressScrollSync(): void {
  suppressScrollSync = true;
  if (suppressScrollTimeout !== null) clearTimeout(suppressScrollTimeout);
  suppressScrollTimeout = setTimeout(() => {
    suppressScrollSync = false;
    suppressScrollTimeout = null;
  }, SCROLL_SPY_SUPPRESS_MS);
}

function readPaddingTop(el: HTMLElement): number {
  const value = parseFloat(getComputedStyle(el).paddingTop);
  return Number.isFinite(value) ? value : 0;
}

// Walk items in order and return the last one whose top edge is at or
// above the padded content top of the container. Accounting for the
// container's padding-top means the handoff happens at the visual
// start of the cards rather than the invisible border of the
// container itself. Iterating in DOM order lets us break early once
// an item is below the line.
function computeActiveUuidFromScroll(): string | null {
  if (!containerRef.value) return null;
  const container = containerRef.value;
  const paddedTop =
    container.getBoundingClientRect().top + readPaddingTop(container);
  let activeUuid: string | null = null;
  for (const result of props.toolResults) {
    const el = itemRefs.get(result.uuid);
    if (!el) continue;
    if (el.getBoundingClientRect().top <= paddedTop) {
      activeUuid = result.uuid;
    } else {
      break;
    }
  }
  return activeUuid;
}

function onContainerScroll(): void {
  if (suppressScrollSync) return;
  if (scrollSpyRafId !== null) return;
  scrollSpyRafId = requestAnimationFrame(() => {
    scrollSpyRafId = null;
    if (suppressScrollSync) return;
    const activeUuid = computeActiveUuidFromScroll();
    if (activeUuid && activeUuid !== props.selectedResultUuid) {
      scrollSpyEmittedUuid = activeUuid;
      emit("select", activeUuid);
    }
  });
}

// Scroll the selected card to the top whenever the external selection
// changes (sidebar click, initial load). Skip the scroll only when the
// incoming uuid matches the one we just emitted from the spy — that
// means the viewport is already in the right place. Any other change
// (sidebar click, new result) still gets its normal scrollIntoView.
watch(
  () => props.selectedResultUuid,
  (uuid) => {
    if (!uuid) return;
    if (scrollSpyEmittedUuid === uuid) {
      scrollSpyEmittedUuid = null;
      return;
    }
    scrollSpyEmittedUuid = null;
    nextTick(() => {
      const el = itemRefs.get(uuid);
      if (!el) return;
      beginSuppressScrollSync();
      el.scrollIntoView({ block: "start", behavior: "auto" });
    });
  },
);

watch(
  () => props.toolResults.length,
  () => {
    nextTick(() => {
      if (containerRef.value) {
        beginSuppressScrollSync();
        containerRef.value.scrollTop = containerRef.value.scrollHeight;
      }
      // New items may have brought in more iframes to size.
      for (const wrapper of naturalWrapperRefs.values()) {
        sizeIframesIn(wrapper);
      }
    });
  },
);

onMounted(() => {
  containerRef.value?.addEventListener("scroll", onContainerScroll, {
    passive: true,
  });
  // Align the initial scroll position with the externally selected
  // item so the sidebar and stack start in sync on mount.
  nextTick(() => {
    if (!props.selectedResultUuid) return;
    const el = itemRefs.get(props.selectedResultUuid);
    if (!el) return;
    beginSuppressScrollSync();
    el.scrollIntoView({ block: "start", behavior: "auto" });
  });
});

onUnmounted(() => {
  containerRef.value?.removeEventListener("scroll", onContainerScroll);
  if (scrollSpyRafId !== null) cancelAnimationFrame(scrollSpyRafId);
  if (suppressScrollTimeout !== null) clearTimeout(suppressScrollTimeout);
  naturalWrapperRefs.clear();
});
</script>

<style scoped>
/* Force document-like plugin viewComponents (presentHtml,
   presentDocument, presentSpreadsheet) to flow at their natural
   height inside stack view instead of clipping to the wrapper with
   an inner scrollbar. */
.stack-natural :deep(.h-full),
.stack-natural :deep(.min-h-full) {
  height: auto !important;
  min-height: 0 !important;
}
.stack-natural :deep(.overflow-hidden),
.stack-natural :deep(.overflow-auto),
.stack-natural :deep(.overflow-y-auto),
.stack-natural :deep(.overflow-x-auto) {
  overflow: visible !important;
}
.stack-natural :deep(.flex-1) {
  flex: 0 0 auto !important;
}

/* Collapse the nested chrome that @gui-chat-plugin/text-response
   draws around its Markdown output so it reads like plain content
   inside our stack card instead of creating a second border/shadow
   "card" inside ours. */
.stack-text-response :deep(.text-response-content-wrapper > .p-6) {
  padding: 0.5rem 0.75rem;
}
.stack-text-response :deep(.text-response-container .max-w-3xl) {
  max-width: none;
  margin-left: 0;
  margin-right: 0;
}
.stack-text-response :deep(.text-response-container .mb-2) {
  display: none; /* redundant role header — stack card header shows it already */
}
.stack-text-response :deep(.text-response-container .shadow-sm) {
  border: 0;
  box-shadow: none;
  padding: 0;
  background: transparent;
  border-radius: 0;
}
</style>
