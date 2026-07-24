<template>
  <div class="h-full flex flex-col bg-gray-50">
    <div class="shrink-0 flex items-center gap-1 text-xs text-gray-400 px-4 pt-3 pb-2" data-testid="stack-role-header">
      <span v-if="sessionRoleIcon" class="material-icons text-xs leading-none">{{ sessionRoleIcon }}</span>
      <span v-if="sessionRoleName">{{ sessionRoleName }}</span>
      <div class="ml-auto flex items-center gap-0.5">
        <CopyChatButton :results="toolResults" :result-timestamps="resultTimestamps" :session-role-name="sessionRoleName" />
        <button
          type="button"
          class="h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          :class="{ '!text-blue-500': showRightSidebar }"
          :title="t('sidebarHeader.toolCallHistory')"
          :aria-label="t('sidebarHeader.toolCallHistory')"
          :aria-pressed="showRightSidebar"
          @click="emit('toggle-right-sidebar')"
        >
          <span class="material-icons text-lg" aria-hidden="true">build</span>
        </button>
        <CanvasViewToggle :model-value="layoutMode" @update:model-value="(mode) => emit('update:layoutMode', mode)" />
      </div>
    </div>
    <!-- Empty state pulled out of the scroll container so `h-full` +
         the container's `pb-4` padding can't combine into a stray
         scrollbar. A sibling `flex-1` slot centers cleanly. -->
    <!-- Mirror App.vue's single-layout empty state (role icon + name +
         pill-shaped query suggestions) so switching canvas modes
         doesn't change what a fresh chat looks like. -->
    <div v-if="toolResults.length === 0" class="flex-1 flex flex-col items-center justify-center h-full px-6 text-center" data-testid="stack-empty">
      <span v-if="sessionRoleIcon" class="material-icons text-5xl text-gray-400 mb-2" aria-hidden="true">{{ sessionRoleIcon }}</span>
      <p v-if="sessionRoleName" class="text-lg font-medium text-gray-700 mb-4">{{ sessionRoleName }}</p>
      <div v-if="queries && queries.length > 0 && sendTextMessage" class="flex flex-wrap gap-2 justify-center max-w-xl">
        <button
          v-for="(query, queryIdx) in queries"
          :key="`${queryIdx}-${query}`"
          type="button"
          class="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full px-4 py-2 border border-gray-300 transition-colors"
          data-testid="stack-empty-query"
          @click="sendTextMessage(query)"
        >
          {{ query }}
        </button>
      </div>
      <p v-else class="text-sm text-gray-500">{{ t("app.startConversation") }}</p>
    </div>
    <div v-else ref="containerRef" class="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-3" data-testid="stack-scroll">
      <div
        v-for="item in displayItems"
        :key="item.key"
        :ref="(element) => setItemRefForMembers(item.members, element as HTMLElement | null)"
        class="bg-white rounded-lg border transition-colors"
        :class="item.members.some((m) => m.uuid === selectedResultUuid) ? 'border-blue-400 ring-2 ring-blue-200' : 'border-gray-200'"
      >
        <button
          class="w-full flex items-center gap-2 px-3 py-2 border-b border-gray-100 text-left hover:bg-gray-50"
          :title="item.head.title || item.head.toolName"
          @click="emit('select', item.head.uuid)"
        >
          <span class="material-icons text-sm text-gray-400">{{ iconFor(item.head.toolName) }}</span>
          <span class="text-sm font-medium text-gray-800 truncate">{{ item.head.title || item.head.toolName }}</span>
          <span v-if="item.isGroup && item.members.length > 1" class="text-[10px] text-gray-400 shrink-0">{{ `${item.members.length}×` }}</span>
          <span v-if="resultTimestamps.get(item.head.uuid)" class="text-[10px] text-gray-400 shrink-0">{{
            formatSmartTime(resultTimestamps.get(item.head.uuid)!)
          }}</span>
          <span class="font-mono text-xs text-gray-400 shrink-0">{{ item.head.toolName }}</span>
        </button>
        <!-- text-response: render the message as Markdown via the
           underlying plugin View. The .stack-text-response class below
           collapses the plugin's own card chrome (outer p-6, inner
           rounded/border/shadow box, role header) so only the stack
           card's own border shows.

           The upstream OriginalView already owns the external-link +
           workspace-path click handling (its own @click.capture), so we must
           NOT add another here — a second capture-phase handler on this
           wrapper fired first and opened every external link in TWO tabs.
           `@update-result` is wired so edits made in the card's editor
           actually persist instead of vanishing. -->
        <div v-if="isTextResponse(item.head)" class="stack-text-response">
          <TextResponseOriginalView :selected-result="item.head" @update-result="forwardResultUpdate" />
        </div>
        <!-- Document-like plugins: let the content flow at its natural
           height by overriding the plugin's internal h-full / overflow
           / flex-1 via the .stack-natural scoped styles below. For
           plugins that embed iframes (e.g. presentHtml) we also size
           each iframe to its content after load. -->
        <div
          v-else-if="isStackNatural(item.head.toolName)"
          :ref="(element) => setNaturalWrapperRef(item.head.uuid, element as HTMLElement | null)"
          class="stack-natural"
        >
          <component
            :is="getPlugin(item.head.toolName)?.viewComponent"
            v-if="getPlugin(item.head.toolName)?.viewComponent"
            :key="`${item.key}-${googleMapKeyFor(item.head.toolName) ?? ''}`"
            :selected-result="item.head"
            :send-text-message="sendTextMessage"
            :google-map-key="googleMapKeyFor(item.head.toolName)"
            @update-result="forwardResultUpdate"
          />
        </div>
        <!-- Other plugins: fixed height wrapper so plugins that rely on
           h-full continue to render properly. Map groups pass the
           ordered `results` so the View replays the whole group onto
           one map; everything else uses the single `selected-result`. -->
        <div v-else :style="{ height: pluginHeightFor(item.head.toolName) }">
          <component
            :is="getPlugin(item.head.toolName)?.viewComponent"
            v-if="getPlugin(item.head.toolName)?.viewComponent"
            :key="`${item.key}-${googleMapKeyFor(item.head.toolName) ?? ''}`"
            :selected-result="item.head"
            :results="item.isGroup ? item.members : undefined"
            :send-text-message="sendTextMessage"
            :google-map-key="googleMapKeyFor(item.head.toolName)"
            @update-result="forwardResultUpdate"
          />
          <pre v-else class="h-full overflow-auto p-4 text-xs text-gray-500 whitespace-pre-wrap">{{ JSON.stringify(item.head, null, 2) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { getPlugin } from "../tools";
import { TOOL_NAMES, type ToolName } from "../config/toolNames";
import type { ToolResult, ToolResultComplete } from "gui-chat-protocol/vue";
import { View as TextResponseOriginalView } from "../plugins/textResponse/index";
import { clampIframeHeight } from "../utils/dom/iframeHeightClamp";
import { isNearBottom } from "../utils/dom/scrollable";
import type { TextResponseData } from "../plugins/textResponse/types";
import { formatSmartTime } from "../utils/format/date";
import { isRecord } from "../utils/types";
import { buildStackDisplayItems, pickActiveCardUuid, resolveLatestScrollTarget } from "../utils/canvas/stackGrouping";
import CanvasViewToggle from "./CanvasViewToggle.vue";
import CopyChatButton from "./CopyChatButton.vue";
import type { LayoutMode } from "../utils/canvas/layoutMode";

const { t } = useI18n();

// Most plugin viewComponents use h-full internally, so a defined parent
// height is required for them to render. text-response and the
// "stack-natural" plugins below are special-cased.
const DEFAULT_PLUGIN_HEIGHT = "min(60vh, 560px)";

// Per-tool height overrides. presentMulmoScript's deck-editor renders
// a 16:9 slide preview inside an iframe; at the default 560px cap, the
// chrome above (header + toolbar + script-source summary) leaves the
// preview shorter than what a 16:9 slide needs to fit, and the bottom
// of the rendered slide ends up clipped. A taller cap lets the slide
// render in full without letterboxing.
// `satisfies Partial<Record<ToolName, string>>` keys this off the
// canonical `TOOL_NAMES` union so a typo'd or stale tool name fails at
// compile time instead of silently falling through to the default.
const PLUGIN_HEIGHT_OVERRIDES = {
  [TOOL_NAMES.presentMulmoScript]: "min(85vh, 820px)",
} satisfies Partial<Record<ToolName, string>>;

function pluginHeightFor(toolName: string): string {
  // Indexed lookup is wide-string-keyed; the `satisfies` constraint
  // above already ensures the literal's keys are valid `ToolName`s.
  const overrides: Record<string, string | undefined> = PLUGIN_HEIGHT_OVERRIDES;
  return overrides[toolName] ?? DEFAULT_PLUGIN_HEIGHT;
}

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
  "manageWiki",
  // presentChart documents can hold multiple charts; fixed-height
  // clipping forces an inner scrollbar per result. Letting them flow
  // keeps everything visible in one scroll.
  "presentChart",
  // Skill (#1218) — collapsed card is ~80px tall, expanded body
  // flows at natural height. The default `min(60vh, 560px)` frame
  // would leave a 480px void below the collapsed card; letting it
  // flow puts the card flush against its stack header with no
  // empty pane. Auto-scrolling the OUTER stack handles overflow
  // when the user expands the body, same as the document-like
  // plugins above.
  "skill",
]);

function isStackNatural(toolName: string): boolean {
  return STACK_NATURAL_TOOLS.has(toolName);
}

const props = defineProps<{
  toolResults: ToolResultComplete[];
  selectedResultUuid: string | null;
  resultTimestamps: Map<string, number>;
  sendTextMessage?: (text: string) => void;
  /** Role's sample queries (already translated). Rendered as
   *  click-to-send suggestions in the empty state so a fresh stack
   *  chat matches the single-layout PageChatComposer experience. */
  queries?: readonly string[];
  sessionRoleName?: string;
  sessionRoleIcon?: string;
  layoutMode: LayoutMode;
  showRightSidebar: boolean;
  /** Google Maps JS API key forwarded from `App.vue` to plugin Views
   *  that consume it (today: `@gui-chat-plugin/google-map`'s View).
   *  Other plugins ignore the fallthrough. The single-layout
   *  branch in App.vue forwards the same prop on its own
   *  `<component :is>` mount. */
  googleMapKey?: string | null;
}>();

// Scope `googleMapKey` to the `mapControl` plugin only — without
// this gate, every plugin View in the stack receives the Google
// Maps API key as a prop and a hostile third-party plugin could
// declare a matching prop to exfiltrate the key. Codex security
// review on PR #1241 caught this.
function googleMapKeyFor(toolName: string): string | null {
  return toolName === TOOL_NAMES.mapControl ? (props.googleMapKey ?? null) : null;
}

const emit = defineEmits<{
  select: [uuid: string];
  updateResult: [result: ToolResultComplete];
  "update:layoutMode": [mode: LayoutMode];
  "toggle-right-sidebar": [];
}>();

const containerRef = ref<HTMLDivElement | null>(null);
// Auto-follow gate: true while the reader is at the bottom. Updated from the
// container's scroll handler (#2179).
const stickToBottom = ref(true);
const itemRefs = new Map<string, HTMLElement>();
const naturalWrapperRefs = new Map<string, HTMLElement>();

// A plugin view emits `ToolResult`, whose `toolName` is optional; the parent
// only accepts a complete result. Check at runtime instead of asserting the
// narrower type in the template — an edit from a result that somehow lost its
// toolName has nothing to update and is dropped rather than forwarded.
function forwardResultUpdate(result: ToolResult): void {
  const { toolName, uuid } = result;
  if (typeof toolName !== "string" || typeof uuid !== "string") return;
  emit("updateResult", { ...result, toolName, uuid });
}

function setItemRef(uuid: string, element: HTMLElement | null): void {
  if (element) itemRefs.set(uuid, element);
  else itemRefs.delete(uuid);
}

function setNaturalWrapperRef(uuid: string, element: HTMLElement | null): void {
  if (element) {
    naturalWrapperRefs.set(uuid, element);
    nextTick(() => sizeIframesIn(element));
  } else {
    naturalWrapperRefs.delete(uuid);
  }
}

// `mapControl` results carrying a `groupId` collapse into one card
// (the View accumulates markers / routes). Grouping is session-wide,
// so `displayItems` is the rendered card order — scroll-spy below
// iterates THIS, not the flat `toolResults`. See stackGrouping.ts.
function groupIdOf(result: ToolResultComplete): string | null {
  if (result.toolName !== TOOL_NAMES.mapControl) return null;
  const { data } = result;
  if (!isRecord(data)) return null;
  const { groupId } = data;
  return typeof groupId === "string" && groupId.length > 0 ? groupId : null;
}

const displayItems = computed(() => buildStackDisplayItems(props.toolResults, groupIdOf, (result) => result.uuid));

// Register the group card element under EVERY member uuid so the
// scroll-spy and scroll-to-selection logic (which key on individual
// result uuids) resolve any member to this one card.
function setItemRefForMembers(members: ToolResultComplete[], element: HTMLElement | null): void {
  for (const member of members) setItemRef(member.uuid, element);
}

// Sandboxed iframes inside stack-natural plugins (e.g. presentHtml)
// have no intrinsic content height, so CSS alone collapses them. The
// in-iframe reporter script (`iframeHeightReporterScript.ts`) posts
// scrollHeight updates which `handleIframeHeightMessage` below applies
// — that path's feedback-loop guard (slop heuristic + viewport cap +
// `dataset.stackHeightPx`) is the canonical sizing channel.
//
// `sizeIframesIn` / `resizeOneIframe` are a fallback for the rare
// non-sandboxed case (same-origin iframe whose document is reachable
// from the parent) and reuse the same safeguards.
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

// Iframe height clamp moved to a pure helper so the regression case
// (#1268 — viewport-relative content climbing indefinitely through
// the parent's height-setting feedback) can be unit-tested without
// mounting Vue or a real iframe. See `iframeHeightClamp.ts` for both
// caps (`MAX_REPORTED_IFRAME_HEIGHT_PX` absolute + `MAX_IFRAME_VH`
// viewport-relative).

// Cache `contentWindow → iframe` so message-driven sizing is O(1) per
// message. Without this, every postMessage would force a full DOM walk
// over `naturalWrapperRefs * querySelectorAll("iframe")` — turning a
// flood of messages from an untrusted (sandboxed but script-enabled)
// iframe into parent-thread DoS. WeakMap key keeps the contentWindow
// reference weak so it doesn't pin removed iframes.
const iframesByContentWindow = new WeakMap<Window, HTMLIFrameElement>();
const pendingIframeHeightsPx = new Map<HTMLIFrameElement, number>();
let pendingHeightFlushRafId: number | null = null;

function findIframeForSourceWindow(source: Window): HTMLIFrameElement | null {
  const cached = iframesByContentWindow.get(source);
  if (cached && cached.isConnected) return cached;
  for (const wrapper of naturalWrapperRefs.values()) {
    for (const iframe of wrapper.querySelectorAll<HTMLIFrameElement>("iframe")) {
      const win = iframe.contentWindow;
      if (!win) continue;
      iframesByContentWindow.set(win, iframe);
      if (win === source) return iframe;
    }
  }
  return null;
}

// !important defeats the stack-natural `:deep(.h-full)` rule which
// forces `height: auto !important` to make plugin views flow at
// natural height. For this specific iframe we WANT the explicit pixel
// height back.
function flushPendingIframeHeights(): void {
  pendingHeightFlushRafId = null;
  for (const [iframe, heightPx] of pendingIframeHeightsPx) {
    if (!iframe.isConnected) continue;
    iframe.style.setProperty("height", `${heightPx}px`, "important");
  }
  pendingIframeHeightsPx.clear();
}

// Listen for iframe-height reports posted by the in-iframe reporter
// script (`src/utils/html/iframeHeightReporterScript.ts` injected by
// the server's `readAndInjectHtmlArtifact`). Cross-origin sandboxed
// iframes can't have their `scrollHeight` read from the parent, so the
// iframe self-reports via postMessage and we set its height here.
//
// Coalesces via rAF: a hostile iframe spamming postMessage can store
// at most one pending height per iframe per frame; we apply the latest
// one when the next animation frame fires.
function handleIframeHeightMessage(event: MessageEvent): void {
  const { data } = event;
  if (!data || typeof data !== "object") return;
  if ((data as { type?: unknown }).type !== "mc-iframe-height") return;
  const reported = (data as { height?: unknown }).height;
  if (typeof reported !== "number") return;
  const { source } = event;
  if (!source || typeof source !== "object" || !("postMessage" in source)) return;
  const iframe = findIframeForSourceWindow(source as Window);
  if (!iframe) return;
  const heightPx = clampIframeHeight(reported, window.innerHeight);
  if (heightPx <= 0) return;
  pendingIframeHeightsPx.set(iframe, heightPx);
  if (pendingHeightFlushRafId === null) {
    pendingHeightFlushRafId = requestAnimationFrame(flushPendingIframeHeights);
  }
}

function resizeOneIframe(iframe: HTMLIFrameElement): void {
  try {
    const doc = iframe.contentDocument;
    if (!doc) return;
    const measured = Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0);
    const heightPx = clampIframeHeight(measured, window.innerHeight);
    if (heightPx <= 0) return;
    iframe.style.height = `${heightPx}px`;
  } catch {
    // cross-origin sandbox — can't measure, leave default
  }
}

function isTextResponse(result: ToolResultComplete): result is ToolResultComplete<TextResponseData> {
  if (result.toolName !== "text-response") return false;
  const { data } = result;
  if (!isRecord(data)) return false;
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

function readPaddingTop(element: HTMLElement): number {
  const value = parseFloat(getComputedStyle(element).paddingTop);
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
  const paddedTopPx = container.getBoundingClientRect().top + readPaddingTop(container);
  const topOfCardPx = (headUuid: string): number | null => {
    const element = itemRefs.get(headUuid);
    return element ? element.getBoundingClientRect().top : null;
  };
  return pickActiveCardUuid(displayItems.value, (result) => result.uuid, topOfCardPx, paddedTopPx);
}

function onContainerScroll(): void {
  if (suppressScrollSync) return;
  // Only a genuine user scroll moves the auto-follow gate. Programmatic
  // scrolls are suppressed above — otherwise following would cancel itself:
  // the newest-card jump lands away from the bottom, which would read as
  // "the user scrolled up" and stop the next chunk from arriving.
  if (containerRef.value) stickToBottom.value = isNearBottom(containerRef.value);
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
      const element = itemRefs.get(uuid);
      if (!element) return;
      beginSuppressScrollSync();
      element.scrollIntoView({ block: "start", behavior: "auto" });
    });
  },
);

// Key that changes both on new results AND on streaming updates to
// the last text card (which appends in place, leaving length stable).
const latestResultScrollKey = computed(() => {
  const list = props.toolResults;
  const last = list[list.length - 1];
  return `${list.length}:${last?.uuid ?? ""}:${last?.message?.length ?? 0}`;
});

watch(latestResultScrollKey, () => {
  nextTick(() => {
    // Streaming fires this on every chunk — only follow while the reader is
    // still parked at the bottom, so scrolling up to read stays put (#2179).
    if (containerRef.value && stickToBottom.value) {
      beginSuppressScrollSync();
      const newest = props.toolResults[props.toolResults.length - 1];
      const target = resolveLatestScrollTarget(displayItems.value, newest, (result) => result.uuid);
      if (target.kind === "bottom") {
        containerRef.value.scrollTop = containerRef.value.scrollHeight;
      } else if (target.kind === "card") {
        const element = itemRefs.get(target.headUuid);
        if (element) element.scrollIntoView({ block: "nearest", behavior: "auto" });
      }
    }
    // New items may have brought in more iframes to size.
    for (const wrapper of naturalWrapperRefs.values()) {
      sizeIframesIn(wrapper);
    }
  });
});

// The scroll container lives in the `v-else` branch (rendered only once
// `toolResults` is non-empty). Sessions mount empty — the transcript /
// stream populates them after mount — so binding the scroll-spy listener
// in `onMounted` would attach it to a null ref and never fire. Watch the
// ref instead so the listener (re)binds whenever the container appears
// or is replaced.
watch(
  containerRef,
  (element, previous) => {
    previous?.removeEventListener("scroll", onContainerScroll);
    element?.addEventListener("scroll", onContainerScroll, { passive: true });
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener("message", handleIframeHeightMessage);
  // Align the initial scroll position with the externally selected
  // item so the sidebar and stack start in sync on mount.
  nextTick(() => {
    if (!props.selectedResultUuid) return;
    const element = itemRefs.get(props.selectedResultUuid);
    if (!element) return;
    beginSuppressScrollSync();
    element.scrollIntoView({ block: "start", behavior: "auto" });
  });
});

onUnmounted(() => {
  containerRef.value?.removeEventListener("scroll", onContainerScroll);
  window.removeEventListener("message", handleIframeHeightMessage);
  if (scrollSpyRafId !== null) cancelAnimationFrame(scrollSpyRafId);
  if (suppressScrollTimeout !== null) clearTimeout(suppressScrollTimeout);
  if (pendingHeightFlushRafId !== null) cancelAnimationFrame(pendingHeightFlushRafId);
  pendingIframeHeightsPx.clear();
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
/* Scope the flex-1 neutralisation to VERTICAL flex contexts only
   (#1277). The intent was always "don't let a column child's
   flex-1 collapse the natural content height in stack mode". The
   old bare `:deep(.flex-1)` also hit `.flex-1` children of ROW
   containers (e.g. a plugin `<summary>`'s description wrapper),
   freezing them at `flex: 0 0 auto` so they stopped growing /
   wrapping horizontally (PR #1276 had to work around this
   plugin-side). Restricting to `.flex-col > .flex-1` keeps the
   column fix and leaves row layouts alone. */
.stack-natural :deep(.flex-col > .flex-1) {
  flex: 0 0 auto !important;
}
/* presentHtml's View.vue uses CSS-defined (not Tailwind class)
   `overflow: hidden` + `flex: 1` on its wrapper/container to keep the
   iframe inside a fixed-height canvas in non-stack mode. In stack mode
   we need them to flow at the iframe's natural height (the value the
   postMessage height reporter sets via JS). The class-based
   `.overflow-hidden` / `.flex-1` overrides above don't catch CSS-named
   selectors, so spell them out here. */
.stack-natural :deep(.iframe-wrapper),
.stack-natural :deep(.html-container) {
  flex: 0 0 auto !important;
  overflow: visible !important;
}

/* Collapse the nested chrome that text-response draws around its
   Markdown output so it reads like plain content inside our stack card
   instead of creating a second border/shadow "card" inside ours. */
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
