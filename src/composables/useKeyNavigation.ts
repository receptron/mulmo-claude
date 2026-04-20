// Keyboard navigation extracted from App.vue.
// Arrow keys scroll the canvas (main pane) or navigate the sidebar
// result list depending on which pane is active.

import type { Ref, ComputedRef } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { findScrollableChild } from "../utils/dom/scrollable";

const SCROLL_AMOUNT = 60;

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  );
}

function isVerticalArrow(key: string): key is "ArrowUp" | "ArrowDown" {
  return key === "ArrowUp" || key === "ArrowDown";
}

function resolveNextUuid(
  results: ToolResultComplete[],
  currentUuid: string | null,
  direction: "ArrowUp" | "ArrowDown",
): string | null {
  if (results.length === 0) return null;
  const idx = results.findIndex((r) => r.uuid === currentUuid);
  if (idx === -1) {
    return direction === "ArrowDown"
      ? results[0].uuid
      : results[results.length - 1].uuid;
  }
  const next =
    direction === "ArrowUp"
      ? Math.max(0, idx - 1)
      : Math.min(results.length - 1, idx + 1);
  return results[next].uuid;
}

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
    if (!isVerticalArrow(e.key)) return;
    if (isEditableTarget(e.target)) return;
    if (!canvasRef.value) return;
    const scrollable = findScrollableChild(canvasRef.value);
    if (!scrollable) return;
    e.preventDefault();
    const delta = e.key === "ArrowDown" ? SCROLL_AMOUNT : -SCROLL_AMOUNT;
    scrollable.scrollBy({ top: delta, behavior: "smooth" });
  }

  function handleKeyNavigation(e: KeyboardEvent): void {
    if (activePane.value !== "sidebar") return;
    if (isEditableTarget(e.target)) return;
    if (!isVerticalArrow(e.key)) return;
    e.preventDefault();
    const nextUuid = resolveNextUuid(
      sidebarResults.value,
      selectedResultUuid.value,
      e.key,
    );
    if (nextUuid) selectedResultUuid.value = nextUuid;
  }

  return { handleCanvasKeydown, handleKeyNavigation };
}
