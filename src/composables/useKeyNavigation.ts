// Keyboard navigation extracted from App.vue.
// Arrow keys scroll the canvas (main pane) or navigate the sidebar
// result list depending on which pane is active.

import type { Ref, ComputedRef } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { findScrollableChild } from "../utils/dom/scrollable";

const SCROLL_AMOUNT = 60;

export function useKeyNavigation(opts: {
  canvasRef: Ref<HTMLDivElement | null>;
  activePane: Ref<"sidebar" | "main">;
  sidebarResults: ComputedRef<ToolResultComplete[]>;
  selectedResultUuid: ComputedRef<string | null> & {
    value: string | null;
  };
}) {
  const { canvasRef, activePane, sidebarResults, selectedResultUuid } = opts;

  function handleCanvasKeydown(e: KeyboardEvent): void {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    if (!canvasRef.value) return;
    const scrollable = findScrollableChild(canvasRef.value);
    if (!scrollable) return;
    e.preventDefault();
    const delta = e.key === "ArrowDown" ? SCROLL_AMOUNT : -SCROLL_AMOUNT;
    scrollable.scrollBy({ top: delta, behavior: "smooth" });
  }

  function handleKeyNavigation(e: KeyboardEvent): void {
    if (activePane.value !== "sidebar") return;
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const results = sidebarResults.value;
    if (results.length === 0) return;
    const currentIndex = results.findIndex(
      (r) => r.uuid === selectedResultUuid.value,
    );
    if (currentIndex === -1) {
      selectedResultUuid.value =
        e.key === "ArrowDown"
          ? results[0].uuid
          : results[results.length - 1].uuid;
      return;
    }
    const nextIndex =
      e.key === "ArrowUp"
        ? Math.max(0, currentIndex - 1)
        : Math.min(results.length - 1, currentIndex + 1);
    selectedResultUuid.value = results[nextIndex].uuid;
  }

  return { handleCanvasKeydown, handleKeyNavigation };
}
