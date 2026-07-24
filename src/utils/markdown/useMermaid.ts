// Vue composable that keeps every markdown viewer in sync with the
// mermaid runner. The viewer passes its `<div v-html="renderedHtml">`
// container ref and the reactive source; this hook schedules a
// `nextTick` → `renderMermaidNodes` on mount and whenever the source
// changes, so newly-injected placeholders become SVG diagrams without
// each viewer re-implementing the plumbing.

import { onMounted, watch, nextTick, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { renderMermaidNodes, type MermaidRenderLabels } from "@mulmoclaude/markdown-utils/markdown/mermaidRender";

export function useMermaidRenderer(containerRef: Ref<HTMLElement | null | undefined>, sourceRef: Ref<unknown>): void {
  const { t } = useI18n();
  // Resolve the two error-surface keys through the live i18n
  // instance so the messages track locale changes. `t` is stable
  // across the composable's lifetime, so building the labels once
  // here (rather than re-building on every render) is safe.
  const labels: MermaidRenderLabels = {
    loadFailed: (error) => t("markdownMermaid.loadFailed", { error }),
    renderFailed: (error) => t("markdownMermaid.renderFailed", { error }),
  };
  const run = async (): Promise<void> => {
    await nextTick();
    await renderMermaidNodes(containerRef.value ?? null, labels);
  };
  onMounted(() => {
    void run();
  });
  // `immediate: false` — `onMounted` already covers the initial
  // render. `flush: "post"` fires after Vue applies the DOM patch that
  // v-html triggers, so placeholder nodes exist when we scan for them.
  watch(sourceRef, () => void run(), { flush: "post" });
}
