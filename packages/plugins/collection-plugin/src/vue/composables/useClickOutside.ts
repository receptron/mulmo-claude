// Close-on-outside-click for a single-wrapper dropdown (the wrapper `<div>`
// holds both the trigger and the popup). Three menus in CollectionView (flag
// filter / related-collections / "+" add-view) share this exact pattern.
//
// A plugin-local copy on purpose: the host's `src/composables/useClickOutside`
// can't be imported across the package boundary (plugins never reach into host
// `src/`), and it differs anyway — the host takes separate button/popup refs
// and tests with `element.contains()`, while a plugin mounted in MulmoTerminal's
// PluginFrame lives in a shadow root, where a document-level listener sees
// `event.target` retargeted to the shadow host. The `eventInsideElement`
// predicate uses `composedPath()`, which lists the wrapper for open shadow
// trees and the light DOM alike, so both hosts share one test.

import { onUnmounted, ref, watch, type Ref } from "vue";
import { eventInsideElement } from "./eventInsideElement";

/** Reactive open state plus the wrapper ref to bind in the template. A
 *  document `mousedown` listener is registered only while open and torn down
 *  on close and on unmount. */
export function useClickOutside(): { open: Ref<boolean>; menuRef: Ref<HTMLElement | null> } {
  const open = ref<boolean>(false);
  const menuRef = ref<HTMLElement | null>(null);

  function onOutsideClick(event: MouseEvent): void {
    if (!eventInsideElement(event, menuRef.value)) open.value = false;
  }

  watch(open, (isOpen) => {
    if (isOpen) document.addEventListener("mousedown", onOutsideClick);
    else document.removeEventListener("mousedown", onOutsideClick);
  });
  onUnmounted(() => document.removeEventListener("mousedown", onOutsideClick));

  return { open, menuRef };
}
