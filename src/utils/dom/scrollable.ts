// Small DOM helpers shared across components.

// Walk a container's descendants and return the first one that
// has both more vertical content than its visible height AND a
// CSS overflow that allows scrolling. Used so canvas-level arrow
// keys can scroll whichever inner element actually owns the
// scrollbar (e.g. a plugin's view component).
//
// Pure in the "no Vue / no module state" sense — it does touch the
// DOM, so its tests use a synthetic element graph rather than the
// real DOM.
export function findScrollableChild(container: HTMLElement): HTMLElement | null {
  const children = container.querySelectorAll("*");
  for (const elem of children) {
    const html = elem as HTMLElement;
    if (html.scrollHeight > html.clientHeight) {
      const style = getComputedStyle(html);
      if (style.overflowY === "auto" || style.overflowY === "scroll" || style.overflow === "auto" || style.overflow === "scroll") {
        return html;
      }
    }
  }
  return null;
}
