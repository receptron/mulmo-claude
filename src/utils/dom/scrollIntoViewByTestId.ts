// Scroll an element identified by `data-testid` into view and flash
// a subtle ring around it so the user's eye tracks to the row that
// a notification / deep-link just surfaced.
//
// Used by the notification permalink flow (#762): Automations,
// Sources, and Todos pages call this after their list renders with
// a :itemId / :taskId / :slug from the URL.

// How long the flash outline stays on. Long enough to register, short
// enough that a second click isn't visibly "double-flashing".
const FLASH_DURATION_MS = 1600;

// Tailwind-ish ring-2 ring-blue-400 equivalent, expressed as inline
// style so we don't add a one-shot utility class to src/index.css.
const FLASH_BOX_SHADOW = "0 0 0 2px rgba(96, 165, 250, 0.9)";

export function scrollIntoViewByTestId(testId: string): boolean {
  const element = document.querySelector(`[data-testid="${CSS.escape(testId)}"]`);
  if (!(element instanceof HTMLElement)) return false;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  flash(element);
  return true;
}

function flash(element: HTMLElement): void {
  const previousBoxShadow = element.style.boxShadow;
  const previousTransition = element.style.transition;
  element.style.transition = "box-shadow 160ms ease-out";
  element.style.boxShadow = FLASH_BOX_SHADOW;
  window.setTimeout(() => {
    element.style.boxShadow = previousBoxShadow;
    // Restore the transition after the fade has started, not after
    // it ends — matches the element's original rendering pipeline.
    window.setTimeout(() => {
      element.style.transition = previousTransition;
    }, 200);
  }, FLASH_DURATION_MS);
}
