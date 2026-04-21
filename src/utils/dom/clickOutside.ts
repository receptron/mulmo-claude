// Pure helper for "did this click happen outside both the trigger
// button and the popup body?" — used by every dismiss-on-outside
// popup. Lifted out so the boolean rule can be unit-tested without
// a real DOM.

export function isClickOutside(target: Node | null, buttonEl: HTMLElement | null, popupEl: HTMLElement | null): boolean {
  if (!target) return false;
  const insideButton = buttonEl?.contains(target) ?? false;
  const insidePopup = popupEl?.contains(target) ?? false;
  return !insideButton && !insidePopup;
}
