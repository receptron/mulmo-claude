// File drag-and-drop zone helper (#1289 Step 2).
//
// Returns DOM-event handlers a caller binds onto the target element
// plus an `isDragging` ref the caller uses to render visual feedback.
// Also installs (once, lazily) a window-level guard that
// `preventDefault`s `dragover` / `drop` on file drags so the browser
// never navigates to a dropped file when the user misses the zone —
// losing the in-progress conversation was the original UX bug.
//
// Why "Files"-only: text-selection drags inside the page set
// `text/plain` on `dataTransfer.types` but never include `"Files"`.
// Gating on Files keeps the overlay hidden for those, both at the
// composable level and the window-guard level.
//
// Why a counter: real browsers fire `dragenter` / `dragleave` on
// every child the pointer crosses inside the target. A naive boolean
// toggles off as the pointer moves from the panel into the textarea,
// then on again, flickering the overlay. The counter ratchets up on
// each enter and only releases the overlay once it hits zero.

import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

export interface FileDropHandlers {
  onDragenter: (event: DragEvent) => void;
  onDragover: (event: DragEvent) => void;
  onDragleave: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}

export interface UseFileDropZoneResult extends FileDropHandlers {
  isDragging: Readonly<Ref<boolean>>;
}

export interface UseFileDropZoneOptions {
  onFiles: (files: File[]) => void;
}

// Module-scope so the install-once contract holds across multiple
// `useFileDropZone` consumers. The handler reference is retained so the
// listeners it installs can be removed again (a flag-only guard would leak
// handlers — Sourcery review on PR #1331).
let windowGuardHandler: ((event: DragEvent) => void) | null = null;

function isFileDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

/** Install the window-level `preventDefault` guard on its own, for callers that
 *  roll their own per-element handlers (the File Explorer attaches a drop zone
 *  to every folder row, so one `useFileDropZone` per row would mean one window
 *  listener per row). Idempotent — the module-scope handle makes it install-once. */
export function installFileDropWindowGuard(): void {
  installWindowDefaultGuard();
}

// Bumped whenever a drag terminates anywhere on the window. Hand-rolled drop
// zones watch it so a drag that ends WITHOUT a matching `dragleave` — released
// outside any row, or cancelled with Escape — still clears their highlight.
// `useFileDropZone` gets this from its own per-instance listeners; per-row
// callers can't afford one listener each, so they share this pulse instead.
const dragSessionEnded = ref(0);
let windowResetHandler: (() => void) | null = null;

function installWindowResetPulse(): void {
  if (windowResetHandler !== null) return;
  if (typeof window === "undefined") return;
  const handler = (): void => {
    dragSessionEnded.value += 1;
  };
  window.addEventListener("drop", handler);
  window.addEventListener("dragend", handler);
  windowResetHandler = handler;
}

/** Shared "a drag just ended" counter for callers with hand-rolled handlers.
 *  Watch it and reset local drag state. Installs the window guard + pulse once. */
export function useDragSessionEnd(): Readonly<Ref<number>> {
  installWindowDefaultGuard();
  installWindowResetPulse();
  return dragSessionEnded;
}

function installWindowDefaultGuard(): void {
  if (windowGuardHandler !== null) return;
  if (typeof window === "undefined") return;
  const handler = (event: DragEvent): void => {
    if (isFileDrag(event)) event.preventDefault();
  };
  // Capture-phase isn't needed: `preventDefault` from a bubbling
  // handler still suppresses the default action.
  window.addEventListener("dragover", handler);
  window.addEventListener("drop", handler);
  windowGuardHandler = handler;
}

export function useFileDropZone(opts: UseFileDropZoneOptions): UseFileDropZoneResult {
  installWindowDefaultGuard();

  const isDragging = ref(false);
  let dragEnterCount = 0;

  function onDragenter(event: DragEvent): void {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragEnterCount += 1;
    isDragging.value = true;
  }

  function onDragover(event: DragEvent): void {
    // Some browsers (notably WebKit) suppress the subsequent `drop`
    // if `dragover` doesn't preventDefault — even when the prior
    // `dragenter` did. Re-prevent here.
    if (isFileDrag(event)) event.preventDefault();
  }

  function onDragleave(): void {
    // The `isFileDrag` guard is intentionally NOT applied here. Some
    // browsers strip `Files` from `dataTransfer.types` when the
    // dragleave event crosses a window boundary, which would leave
    // the overlay stuck (counter never decremented, `isDragging`
    // stays `true` until the next drop). The enter handler already
    // filters out non-file drags, so anything reaching this point
    // with a positive counter is a file drag we entered earlier.
    // (Codex review on PR #1327, ported into the composable on PR
    // #1331.)
    if (dragEnterCount === 0) return;
    dragEnterCount -= 1;
    if (dragEnterCount <= 0) resetTerminal();
  }

  function onDrop(event: DragEvent): void {
    // Non-file drops (e.g. dropping selected text from elsewhere on
    // the page into the textarea) need to keep their default
    // behaviour. Suppressing the default for those would break a
    // legitimate browser action. Sourcery review on PR #1331.
    if (!isFileDrag(event)) return;
    event.preventDefault();
    resetTerminal();
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) opts.onFiles(Array.from(files));
  }

  function resetTerminal(): void {
    dragEnterCount = 0;
    isDragging.value = false;
  }

  // Belt-and-suspenders escape hatch: if a half-observed drag
  // sequence would otherwise strand the UI in `isDragging=true`
  // (e.g. the user releases the file on an inert part of the page
  // outside the target, or hits Escape mid-drag), the window-level
  // `drop` / `dragend` listeners force-reset. Cross-window file
  // drags from the desktop never fire `dragend` inside the page
  // but DO fire `drop` at the window — that's the case we mainly
  // want to catch. (Codex review on PR #1327.)
  onMounted(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("drop", resetTerminal);
    window.addEventListener("dragend", resetTerminal);
  });
  onBeforeUnmount(() => {
    if (typeof window === "undefined") return;
    window.removeEventListener("drop", resetTerminal);
    window.removeEventListener("dragend", resetTerminal);
  });

  return { isDragging, onDragenter, onDragover, onDragleave, onDrop };
}
