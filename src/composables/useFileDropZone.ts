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
  /** Called when the user releases one or more files over the zone.
   *  All files in `dataTransfer.files` are passed through; the caller
   *  is responsible for accepting / rejecting individual entries. */
  onFiles: (files: File[]) => void;
}

// Module-scope so the install-once contract holds across multiple
// `useFileDropZone` consumers. The handler reference is retained
// so `_resetFileDropZoneForTests` can actually remove the listeners
// (a naive reset that only flipped the flag would leak handlers
// across test runs — Sourcery review on PR #1331).
let windowGuardHandler: ((event: DragEvent) => void) | null = null;

function isFileDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
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
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) opts.onFiles(files);
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

/** Test-only reset. Removes the window listeners installed by
 *  `installWindowDefaultGuard` so a test can verify the install-once
 *  contract without leaking handlers across cases. */
export function _resetFileDropZoneForTests(): void {
  if (windowGuardHandler !== null && typeof window !== "undefined") {
    window.removeEventListener("dragover", windowGuardHandler);
    window.removeEventListener("drop", windowGuardHandler);
  }
  windowGuardHandler = null;
}
