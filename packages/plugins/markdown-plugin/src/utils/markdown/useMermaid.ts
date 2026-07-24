// Duplicate of the host's `src/utils/markdown/useMermaid.ts` — kept
// separate so the plugin doesn't pull the host Vue tree into its
// bundle. Behavior is identical.

import { onMounted, watch, nextTick, type Ref } from "vue";
import { renderMermaidNodes, type MermaidRenderLabels } from "@mulmoclaude/markdown-utils/markdown/mermaidRender";
import { useT } from "../../lang";

export function useMermaidRenderer(containerRef: Ref<HTMLElement | null | undefined>, sourceRef: Ref<unknown>): void {
  const t = useT();
  // Same locale-aware label wiring as the host — the plugin's own
  // `useT` resolves against the plugin's bundled Messages so the
  // strings stay in lockstep across host locale changes.
  const labels: MermaidRenderLabels = {
    loadFailed: (error) => t("mermaidLoadFailed", { error }),
    renderFailed: (error) => t("mermaidRenderFailed", { error }),
  };
  const run = async (): Promise<void> => {
    await nextTick();
    await renderMermaidNodes(containerRef.value ?? null, labels, "mulmo-mermaid-plugin");
  };
  onMounted(() => {
    void run();
  });
  watch(sourceRef, () => void run(), { flush: "post" });
}
