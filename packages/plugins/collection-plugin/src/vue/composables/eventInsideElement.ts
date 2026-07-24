/** True when `event` landed inside `element`, shadow-DOM-safe via
 *  `composedPath()`: a plugin mounted in MulmoTerminal's PluginFrame lives in a
 *  shadow root, where a document-level listener sees `event.target` retargeted
 *  to the shadow host. `composedPath()` lists the wrapper for open shadow trees
 *  and the light DOM alike, so one predicate serves both hosts. */
export function eventInsideElement(event: Event, element: HTMLElement | null): boolean {
  return element !== null && event.composedPath().includes(element);
}
